import { z } from 'zod';
import { pool, query, one } from '../db.js';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import { parse, optStr, reqStr, money, dateStr, IFSC_RE } from '../lib/validate.js';
import { audit, diff, type Ctx } from './audit.js';
import { checkSod, hasRole, userPermissions, type SessionUser } from './access.js';
import { resolvePlan, type ApprovalPlan } from './matrix.js';
import { notify } from './notifications.js';
import {
  lockPayment, setStatus, snapshotPayment, writeVersion, beneficiarySnapshot, findDuplicates, controlChecklist, computeNet, paymentSchema, validateRefs,
  MATERIAL_FIELDS, type PaymentRow,
} from './payments.js';
import { C_DOC_CHECKLIST, D_CHECKLIST, A_EDITABLE } from '../constants.js';
import { formatINR, fmtDate, fmtDateTime, isoDate, round2 } from '../lib/format.js';
import { maskAccount } from '../lib/crypto.js';

const brief = (p: PaymentRow) => p as any;
const actor = (u: SessionUser) => u.name;
const requireText = (v: string | null | undefined, msg: string) => { if (!v || !v.trim()) throw badRequest(msg); return v.trim(); };

async function assertAccess(user: SessionUser, p: PaymentRow, opts: { bank?: boolean } = {}) {
  if (hasRole(user, 'ADMIN') && !user.companyIds.length) return;
  if (!user.companyIds.includes(p.company_id)) throw forbidden('You do not have access to this company.');
  if (opts.bank && user.bankAccountIds && !user.bankAccountIds.includes(p.bank_account_id)) throw forbidden('You do not have access to this bank account.');
}
async function needPerm(user: SessionUser, perm: string) {
  if (!(await userPermissions(user)).includes(perm)) throw forbidden();
}
function assertStatus(p: PaymentRow, allowed: string[], what: string) {
  if (!allowed.includes(p.status)) throw badRequest(`${what} is not possible while the payment is "${p.status.replace(/_/g, ' ')}".`);
}

// ======================================================================= duplicate control
async function duplicateGate(ctx: Ctx, user: SessionUser, p: { id: number; company_id: number; vendor_id: number; invoice_number: string; invoice_date: string; gross_amount: number }, overrideReason?: string | null) {
  const dups = await findDuplicates(ctx.db, p, p.id);
  if (!dups.length) return null;
  const first = dups[0];
  const msg = first.kind === 'EXACT'
    ? `Possible duplicate payment detected. Existing Payment Advice: ${first.pa_number} (same vendor, invoice number, invoice date, amount and company).`
    : `Duplicate invoice detected: invoice ${first.invoice_number} already exists for this vendor in ${first.pa_number}.`;
  if (!overrideReason || !overrideReason.trim()) throw conflict(msg, { code: 'DUPLICATE', duplicates: dups, can_override: user.canOverrideDuplicate });
  if (!user.canOverrideDuplicate) throw forbidden(`${msg} You are not authorised to override duplicate warnings – ask an authorised user.`);
  await audit(ctx, { action: 'DUPLICATE_OVERRIDE', entityType: 'payment', entityId: p.id, paymentId: p.id, new: { duplicates: dups.map((d) => d.pa_number), justification: overrideReason.trim() },
    remarks: `${user.name} overrode duplicate warning: ${overrideReason.trim()}` });
  return { of: dups.map((d) => d.pa_number).join(', '), reason: overrideReason.trim(), by: user.id };
}

async function modeChecks(db: import('../db.js').Db, p: PaymentRow) {
  const mode = await one<any>('SELECT * FROM payment_modes WHERE code=$1', [p.payment_mode], db);
  if (!mode || !mode.is_active) throw badRequest('The selected payment mode is not available.');
  if (mode.min_amount != null && p.net_payable < mode.min_amount) throw badRequest(`${mode.name} requires a minimum payment of ${formatINR(mode.min_amount)}.`);
  if (mode.max_amount != null && p.net_payable > mode.max_amount) throw badRequest(`${mode.name} allows a maximum payment of ${formatINR(mode.max_amount)}. Choose another payment mode.`);
  return mode;
}

// ======================================================================= A : submit / resubmit / amend
export async function submitPayment(ctx: Ctx, user: SessionUser, idv: number, body: { override_reason?: string }) {
  await needPerm(user, 'payment.create');
  const p = await lockPayment(ctx.db, idv);
  if (p.created_by !== user.id) throw forbidden('Only the maker who created this Payment Advice can submit it.');
  if (!['DRAFT', 'B_REJECTED'].includes(p.status)) throw badRequest('This Payment Advice has already been submitted.');
  const mode = await modeChecks(ctx.db, p);
  const ben = await beneficiarySnapshot(ctx.db, p.vendor_id);
  if (mode.requires_beneficiary_bank) {
    if (!ben.enc) throw badRequest('Vendor bank account is missing.');
    if (!ben.authorised) throw badRequest('Vendor bank details are awaiting authorisation. Payments cannot be submitted until the bank account is authorised.');
  }
  const docs = await one<{ n: number }>(`SELECT count(*)::int n FROM payment_documents WHERE payment_id=$1 AND status='ACTIVE'`, [p.id], ctx.db);
  if (!docs || docs.n === 0) throw badRequest('Please upload at least one supporting document (for example the invoice copy) before submitting.');
  const override = await duplicateGate(ctx, user, p, body.override_reason);
  const plan: ApprovalPlan = await resolvePlan({ company_id: p.company_id, department: p.department, bank_account_id: p.bank_account_id, payment_type: p.payment_type, net_payable: p.net_payable }, ctx.db);
  const isResub = p.status === 'B_REJECTED';
  const patch: Record<string, any> = {
    approval_plan: JSON.stringify(plan), matrix_id: plan.matrix_id, pending_b_level: 1, pending_b_senior: !!plan.b_levels[0]?.senior, return_to_stage: null,
    beneficiary_name: ben.name, beneficiary_bank_name: ben.bank_name, beneficiary_account_enc: ben.enc, beneficiary_account_last4: ben.last4, beneficiary_ifsc: ben.ifsc,
    submitted_at: p.submitted_at ?? ctx.now,
    ...(isResub ? { version_no: p.version_no + 1, approval_round: p.approval_round + 1 } : {}),
    ...(override ? { duplicate_of: override.of, duplicate_override_reason: override.reason, duplicate_override_by: override.by } : {}),
  };
  const fromVersion = p.version_no;
  await setStatus(ctx, p, 'SUBMITTED', isResub ? 'Resubmitted by A after correction' : 'Submitted by A', patch);
  p.approval_plan = plan;
  await writeVersion(ctx, p, isResub ? 'RESUBMITTED' : 'SUBMITTED');
  if (isResub) {
    const q = await one<any>(`SELECT id FROM payment_queries WHERE payment_id=$1 AND raised_by_stage='B' AND status='OPEN' ORDER BY id DESC LIMIT 1`, [p.id], ctx.db);
    await ctx.db.query(`UPDATE payment_queries SET status='RESOLVED', resolved_by=$2, resolved_at=$3, resolution_remarks=$4 WHERE payment_id=$1 AND status='OPEN' AND raised_by_stage='B'`, [p.id, user.id, ctx.now, 'Corrected and resubmitted']);
    await ctx.db.query('INSERT INTO payment_resubmissions(payment_id,query_id,from_version,to_version,submitted_by,to_stage,remarks,submitted_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
      [p.id, q?.id ?? null, fromVersion, p.version_no, user.id, 'B', 'Resubmitted to B for approval', ctx.now]);
  }
  await setStatus(ctx, p, 'PENDING_B_APPROVAL', `Awaiting approval – ${plan.matrix_name}`);
  await audit(ctx, { action: isResub ? 'A_RESUBMITTED_TO_B' : 'PAYMENT_SUBMITTED', entityType: 'payment', entityId: p.id, paymentId: p.id, old: { status: isResub ? 'B_REJECTED' : 'DRAFT' }, new: { status: 'PENDING_B_APPROVAL', version: p.version_no, approval_matrix: plan.matrix_name, b_levels: plan.b_levels.length, d_count: plan.d_count },
    remarks: `${actor(user)} (A) ${isResub ? 'resubmitted' : 'submitted'} payment advice ${p.pa_number} for approval.` });
  await notify(ctx, 'B_APPROVAL_PENDING', brief(p));
  return p;
}

const resubmitSchema = z.object({ remarks: reqStr('Please describe how the query was resolved.', 2000) });
export async function resubmitToC(ctx: Ctx, user: SessionUser, idv: number, body: unknown) {
  await needPerm(user, 'payment.create');
  const b = parse(resubmitSchema, body);
  const p = await lockPayment(ctx.db, idv);
  if (p.created_by !== user.id) throw forbidden('Only the maker who created this Payment Advice can resubmit it.');
  if (!(p.status === 'C_QUERY' || (p.status === 'D_REJECTED' && p.return_to_stage === 'A'))) throw badRequest('There is no open query to resubmit for this Payment Advice.');
  const open = await query<any>(`SELECT * FROM payment_queries WHERE payment_id=$1 AND status='OPEN' ORDER BY id`, [p.id], ctx.db);
  for (const q of open) {
    if (q.required_document) {
      const newer = await one('SELECT 1 x FROM payment_documents WHERE payment_id=$1 AND status=$2 AND uploaded_at > $3', [p.id, 'ACTIVE', q.raised_at], ctx.db);
      if (!newer) throw badRequest(`Please upload the required document before resubmitting: ${q.required_document}.`);
    }
  }
  const from = p.version_no;
  await ctx.db.query(`UPDATE payment_queries SET status='RESOLVED', resolved_by=$2, resolved_at=$3, resolution_remarks=$4 WHERE payment_id=$1 AND status='OPEN'`, [p.id, user.id, ctx.now, b.remarks]);
  await setStatus(ctx, p, 'A_RESUBMITTED', b.remarks, { version_no: p.version_no + 1, return_to_stage: null });
  await writeVersion(ctx, p, 'RESUBMITTED');
  await ctx.db.query('INSERT INTO payment_resubmissions(payment_id,query_id,from_version,to_version,submitted_by,to_stage,remarks,submitted_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
    [p.id, open[open.length - 1]?.id ?? null, from, p.version_no, user.id, 'C', b.remarks, ctx.now]);
  await audit(ctx, { action: 'A_RESUBMITTED_TO_C', entityType: 'payment', entityId: p.id, paymentId: p.id, old: { status: 'C_QUERY', version: from }, new: { status: 'A_RESUBMITTED', version: p.version_no }, remarks: `${actor(user)} (A) resubmitted payment advice ${p.pa_number}: ${b.remarks}` });
  await notify(ctx, 'A_RESUBMITTED', brief(p), { remarks: b.remarks });
  return p;
}

const amendSchema = paymentSchema.extend({ amendment_reason: reqStr('Please state the reason for the amendment.', 1000), override_reason: optStr(1000) });
export async function amendPayment(ctx: Ctx, user: SessionUser, idv: number, body: unknown) {
  await needPerm(user, 'payment.create');
  const i = parse(amendSchema, body);
  const p = await lockPayment(ctx.db, idv);
  if (p.created_by !== user.id) throw forbidden('Only the maker who created this Payment Advice can raise an amendment.');
  if (['PAYMENT_INITIATED', 'PENDING_D_APPROVAL'].includes(p.status)) throw badRequest('The payment has already been initiated on the bank portal. C or D must reject it (or it must be cancelled) before an amendment can be raised.');
  if (!['PENDING_C_VERIFICATION', 'A_RESUBMITTED', 'C_QUERY', 'C_VERIFIED', 'ACCOUNTING_VERIFIED', 'D_REJECTED'].includes(p.status)) throw badRequest('An amendment can only be raised after B approval and before the payment is initiated.');
  await validateRefs(user, ctx, i);
  const net = computeNet(i);
  const next: Record<string, any> = { ...i, net_payable: net };
  const d = diff(p as any, next, [...MATERIAL_FIELDS, 'priority', 'due_date', 'purpose', 'remarks', 'po_number', 'grn_reference', 'net_payable']);
  const changedMaterial = d.changed.filter((k) => (MATERIAL_FIELDS as readonly string[]).includes(k));
  if (!changedMaterial.length) throw badRequest('No material change was made. Use "Resolve & resubmit" for non-material corrections.');
  const merged = { ...p, ...next } as PaymentRow;
  const override = await duplicateGate(ctx, user, merged, i.override_reason);
  const plan = await resolvePlan({ company_id: merged.company_id, department: merged.department, bank_account_id: merged.bank_account_id, payment_type: merged.payment_type, net_payable: net }, ctx.db);
  const ben = await beneficiarySnapshot(ctx.db, i.vendor_id);
  const fromVersion = p.version_no; const fromStatus = p.status;
  const patch: Record<string, any> = {};
  for (const k of d.changed) patch[k] = next[k];
  Object.assign(patch, {
    beneficiary_name: ben.name, beneficiary_bank_name: ben.bank_name, beneficiary_account_enc: ben.enc, beneficiary_account_last4: ben.last4, beneficiary_ifsc: ben.ifsc,
    approval_plan: JSON.stringify(plan), matrix_id: plan.matrix_id, pending_b_level: 1, pending_b_senior: !!plan.b_levels[0]?.senior, version_no: p.version_no + 1,
    approval_round: p.approval_round + 1, is_amendment: true, return_to_stage: null,
    ...(override ? { duplicate_of: override.of, duplicate_override_reason: override.reason, duplicate_override_by: override.by } : {}),
  });
  await ctx.db.query(`UPDATE payment_queries SET status='RESOLVED', resolved_by=$2, resolved_at=$3, resolution_remarks=$4 WHERE payment_id=$1 AND status='OPEN'`, [p.id, user.id, ctx.now, `Superseded by amendment: ${i.amendment_reason}`]);
  await ctx.db.query(`UPDATE accounting_entries SET verified=false, verified_by=NULL, verified_at=NULL, updated_at=$2 WHERE payment_id=$1`, [p.id, ctx.now]);
  await setStatus(ctx, p, 'SUBMITTED', `Amendment request: ${i.amendment_reason}`, patch);
  p.approval_plan = plan;
  if (i.items) {
    await ctx.db.query('DELETE FROM payment_items WHERE payment_id=$1', [p.id]);
    let n = 1; for (const it of i.items) await ctx.db.query('INSERT INTO payment_items(payment_id,line_no,description,hsn_sac,quantity,rate,amount,gst_rate) VALUES($1,$2,$3,$4,$5,$6,$7,$8)', [p.id, n++, it.description, it.hsn_sac, it.quantity, it.rate, it.amount, it.gst_rate]);
  }
  await writeVersion(ctx, p, 'AMENDMENT');
  await ctx.db.query('INSERT INTO payment_resubmissions(payment_id,from_version,to_version,submitted_by,to_stage,is_amendment,remarks,changes,submitted_at) VALUES($1,$2,$3,$4,$5,true,$6,$7,$8)',
    [p.id, fromVersion, p.version_no, user.id, 'B', i.amendment_reason, JSON.stringify({ old: d.old, new: d.new }), ctx.now]);
  await setStatus(ctx, p, 'PENDING_B_APPROVAL', `Approval restarted after amendment – ${plan.matrix_name}`);
  await audit(ctx, { action: 'AMENDMENT_REQUESTED', entityType: 'payment', entityId: p.id, paymentId: p.id, old: { ...d.old, status: fromStatus, version: fromVersion }, new: { ...d.new, status: 'PENDING_B_APPROVAL', version: p.version_no }, remarks: `${actor(user)} (A) raised an amendment: ${i.amendment_reason}. Approval process restarted.` });
  await notify(ctx, 'B_APPROVAL_PENDING', brief(p), { reason: `Amendment: ${i.amendment_reason}` });
  return p;
}

// ======================================================================= B : approve / reject / return
const bSchema = z.object({
  decision: z.enum(['APPROVE', 'REJECT', 'RETURN'], { errorMap: () => ({ message: 'Choose Approve, Reject or Return for clarification.' }) }),
  reason: optStr(1000), remarks: optStr(2000), required_document: optStr(300),
});
export async function bDecision(ctx: Ctx, user: SessionUser, idv: number, body: unknown) {
  await needPerm(user, 'payment.approve_b');
  const b = parse(bSchema, body);
  const p = await lockPayment(ctx.db, idv);
  assertStatus(p, ['PENDING_B_APPROVAL'], 'Approval');
  await assertAccess(user, p);
  await checkSod(ctx.db, p.id, user, 'B');
  const plan: ApprovalPlan = p.approval_plan ?? { matrix_id: null, matrix_name: 'Default', b_levels: [{ label: 'Payment Approver', senior: false, count: 1 }], d_count: 1 };
  const done = await query<any>(`SELECT level_no, approver_id FROM payment_approvals WHERE payment_id=$1 AND stage='B' AND round_no=$2 AND decision='APPROVED'`, [p.id, p.approval_round], ctx.db);
  if (done.some((d) => d.approver_id === user.id)) throw forbidden('You have already approved this payment; another approver is required.');
  let idx = plan.b_levels.findIndex((l, i) => done.filter((d) => d.level_no === i + 1).length < l.count);
  if (idx < 0) idx = plan.b_levels.length - 1;
  const level = plan.b_levels[idx];
  if (level.senior && !user.isSeniorApprover) throw forbidden('This approval level requires a Senior Approver.');

  if (b.decision !== 'APPROVE') {
    const reason = requireText(b.reason, 'Rejection reason is mandatory.');
    const decision = b.decision === 'REJECT' ? 'REJECTED' : 'RETURNED';
    await ctx.db.query(`INSERT INTO payment_approvals(payment_id,stage,round_no,level_no,level_label,approver_id,decision,reason,remarks,return_to_stage,decided_at) VALUES($1,'B',$2,$3,$4,$5,$6,$7,$8,'A',$9)`,
      [p.id, p.approval_round, idx + 1, level.label, user.id, decision, reason, b.remarks, ctx.now]);
    await ctx.db.query(`INSERT INTO payment_queries(payment_id,version_no,raised_by_stage,raised_by,category,reason,remarks,required_document,return_to_stage,raised_at) VALUES($1,$2,'B',$3,$4,$5,$6,$7,'A',$8)`,
      [p.id, p.version_no, user.id, b.decision === 'REJECT' ? 'REJECTION' : 'RETURN', reason, b.remarks, b.required_document, ctx.now]);
    await setStatus(ctx, p, 'B_REJECTED', reason, { return_to_stage: 'A', pending_b_level: null, pending_b_senior: false });
    await audit(ctx, { action: b.decision === 'REJECT' ? 'B_REJECTED' : 'B_RETURNED', entityType: 'payment', entityId: p.id, paymentId: p.id, old: { status: 'PENDING_B_APPROVAL' }, new: { status: 'B_REJECTED', reason, required_document: b.required_document }, remarks: `${actor(user)} (B) ${b.decision === 'REJECT' ? 'rejected' : 'returned'} payment advice ${p.pa_number}: ${reason}` });
    await notify(ctx, 'B_REJECTED', brief(p), { reason, remarks: b.remarks ?? undefined });
    return p;
  }

  await ctx.db.query(`INSERT INTO payment_approvals(payment_id,stage,round_no,level_no,level_label,approver_id,decision,remarks,decided_at) VALUES($1,'B',$2,$3,$4,$5,'APPROVED',$6,$7)`,
    [p.id, p.approval_round, idx + 1, level.label, user.id, b.remarks, ctx.now]);
  const doneNow = [...done, { level_no: idx + 1 }];
  const nextIdx = plan.b_levels.findIndex((l, i) => doneNow.filter((d) => d.level_no === i + 1).length < l.count);
  await audit(ctx, { action: 'B_APPROVED', entityType: 'payment', entityId: p.id, paymentId: p.id, new: { level: idx + 1, level_label: level.label, remarks: b.remarks }, remarks: `${actor(user)} (B – ${level.label}) approved payment advice ${p.pa_number}.` });
  if (nextIdx >= 0) {
    p.pending_b_level = nextIdx + 1; p.pending_b_senior = !!plan.b_levels[nextIdx].senior;
    await ctx.db.query('UPDATE payment_advises SET pending_b_level=$2, pending_b_senior=$3, updated_at=$4 WHERE id=$1', [p.id, p.pending_b_level, p.pending_b_senior, ctx.now]);
    await notify(ctx, 'B_APPROVAL_PENDING', brief(p), { remarks: `Level ${idx + 1} approved by ${user.name}; ${plan.b_levels[nextIdx].label} approval is now required.` });
    return p;
  }
  await setStatus(ctx, p, 'B_APPROVED', b.remarks ?? 'All required B approvals complete', { pending_b_level: null, pending_b_senior: false });
  await setStatus(ctx, p, 'PENDING_C_VERIFICATION', 'Forwarded to C for document and accounting verification');
  await notify(ctx, 'B_APPROVED', brief(p), { approvedBy: user.name, remarks: b.remarks ?? undefined });
  return p;
}

// ======================================================================= C : document verification / query
const cReviewSchema = z.object({
  result: z.enum(['VERIFIED', 'DISCREPANCY'], { errorMap: () => ({ message: 'Choose Verified or Discrepancy found.' }) }),
  checklist: z.record(z.boolean()).default({}),
  remarks: optStr(2000), required_document: optStr(300), required_correction: optStr(300),
});
export async function cReview(ctx: Ctx, user: SessionUser, idv: number, body: unknown) {
  await needPerm(user, 'payment.verify_c');
  const b = parse(cReviewSchema, body);
  const p = await lockPayment(ctx.db, idv);
  await assertAccess(user, p, { bank: true });
  await checkSod(ctx.db, p.id, user, 'C');
  if (b.result === 'VERIFIED') {
    assertStatus(p, ['PENDING_C_VERIFICATION', 'A_RESUBMITTED'], 'Document verification');
    const missing = C_DOC_CHECKLIST.filter(([k]) => !b.checklist[k]).map(([, l]) => l);
    if (missing.length) throw badRequest(`Original document verification is pending. Please tick: ${missing.join('; ')}.`, { missing });
    await ctx.db.query(`INSERT INTO document_verifications(payment_id,version_no,verifier_id,checklist,result,remarks,verified_at) VALUES($1,$2,$3,$4,'VERIFIED',$5,$6)`,
      [p.id, p.version_no, user.id, JSON.stringify(b.checklist), b.remarks, ctx.now]);
    await setStatus(ctx, p, 'C_VERIFIED', b.remarks ?? 'Original documents verified by C', { return_to_stage: null });
    const acct = await one('SELECT id FROM accounting_entries WHERE payment_id=$1', [p.id], ctx.db);
    if (!acct) {
      const v = await one<any>('SELECT tds_section FROM vendors WHERE id=$1', [p.vendor_id], ctx.db);
      await ctx.db.query(`INSERT INTO accounting_entries(payment_id,department,gst_treatment,tds_section,tds_amount,gst_amount,basic_amount,other_deductions,advance_adjustment,net_payable,accounting_date,updated_by,updated_at)
        VALUES($1,$2,NULL,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [p.id, p.department, p.tds_amount === 0 ? 'NONE' : v?.tds_section ?? null, p.tds_amount, p.gst_amount, round2(p.gross_amount - p.gst_amount), p.other_deduction, p.advance_adjustment, p.net_payable, isoDate(ctx.now), user.id, ctx.now]);
    }
    await audit(ctx, { action: 'C_VERIFIED_DOCUMENTS', entityType: 'payment', entityId: p.id, paymentId: p.id, new: { status: 'C_VERIFIED', checklist: b.checklist }, remarks: `${actor(user)} (C) verified original documents for ${p.pa_number}.` });
    await notify(ctx, 'C_VERIFIED', brief(p));
    return p;
  }
  assertStatus(p, ['PENDING_C_VERIFICATION', 'A_RESUBMITTED', 'C_VERIFIED', 'ACCOUNTING_VERIFIED', 'D_REJECTED', 'PAYMENT_FAILED'], 'Raising a query');
  if (p.status === 'D_REJECTED' && p.return_to_stage !== 'C') throw badRequest('This payment is currently with A.');
  const remarks = requireText(b.remarks, 'Query remarks are required.');
  if (!b.required_document && !b.required_correction) throw badRequest('Select the required document or correction so that A knows what to provide.');
  const fromStatus = p.status;
  await ctx.db.query(`INSERT INTO document_verifications(payment_id,version_no,verifier_id,checklist,result,remarks,required_document,required_correction,verified_at) VALUES($1,$2,$3,$4,'DISCREPANCY',$5,$6,$7,$8)`,
    [p.id, p.version_no, user.id, JSON.stringify(b.checklist), remarks, b.required_document, b.required_correction, ctx.now]);
  await ctx.db.query(`INSERT INTO payment_queries(payment_id,version_no,raised_by_stage,raised_by,category,reason,remarks,required_document,required_correction,return_to_stage,raised_at) VALUES($1,$2,'C',$3,'DISCREPANCY',$4,$5,$6,$7,'A',$8)`,
    [p.id, p.version_no, user.id, remarks, null, b.required_document, b.required_correction, ctx.now]);
  await ctx.db.query('UPDATE accounting_entries SET verified=false, verified_by=NULL, verified_at=NULL, updated_at=$2 WHERE payment_id=$1', [p.id, ctx.now]);
  await setStatus(ctx, p, 'C_QUERY', remarks, { return_to_stage: 'A' });
  await audit(ctx, { action: 'C_QUERY_RAISED', entityType: 'payment', entityId: p.id, paymentId: p.id, old: { status: fromStatus }, new: { status: 'C_QUERY', remarks, required_document: b.required_document, required_correction: b.required_correction }, remarks: `${actor(user)} (C) raised a document query on ${p.pa_number}: ${remarks}` });
  await notify(ctx, 'C_QUERY_RAISED', brief(p), { reason: remarks });
  return p;
}

// ======================================================================= C : accounting verification
const accountingSchema = z.object({
  ledger_account: optStr(120), cost_centre: optStr(120), department: optStr(120), project: optStr(120), gst_treatment: optStr(120), tds_section: optStr(60),
  tds_amount: money('TDS amount').optional(), gst_amount: money('GST amount').optional(), basic_amount: money('Basic amount').optional(),
  other_deductions: money('Other deductions').optional(), advance_adjustment: money('Advance adjustment').optional(), net_payable: money('Net payable').optional(),
  voucher_no: optStr(60), accounting_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(), erp_reference: optStr(80),
  vendor_ledger_checked: z.boolean().optional(), debit_credit_note_checked: z.boolean().optional(),
});
const ACCT_STAGE = (p: PaymentRow) => ['C_VERIFIED', 'ACCOUNTING_VERIFIED', 'PAYMENT_FAILED'].includes(p.status) || (p.status === 'D_REJECTED' && p.return_to_stage === 'C');

export async function saveAccounting(ctx: Ctx, user: SessionUser, idv: number, body: unknown) {
  await needPerm(user, 'payment.verify_c');
  const b = parse(accountingSchema, body);
  const p = await lockPayment(ctx.db, idv);
  if (!ACCT_STAGE(p)) throw badRequest('Accounting details can be recorded only after the original documents are verified and before payment is approved.');
  await assertAccess(user, p, { bank: true });
  await checkSod(ctx.db, p.id, user, 'C');
  const cur = await one<any>('SELECT * FROM accounting_entries WHERE payment_id=$1', [p.id], ctx.db);
  const flags = { ...(cur?.control_flags ?? {}) };
  if (b.vendor_ledger_checked !== undefined) flags.vendor_ledger_checked = b.vendor_ledger_checked;
  if (b.debit_credit_note_checked !== undefined) flags.debit_credit_note_checked = b.debit_credit_note_checked;
  const fields = ['ledger_account', 'cost_centre', 'department', 'project', 'gst_treatment', 'tds_section', 'tds_amount', 'gst_amount', 'basic_amount', 'other_deductions', 'advance_adjustment', 'net_payable', 'voucher_no', 'accounting_date', 'erp_reference'] as const;
  const next: Record<string, any> = {};
  for (const f of fields) if ((b as any)[f] !== undefined) next[f] = (b as any)[f];
  const d = diff(cur ?? {}, next, Object.keys(next));
  if (cur) {
    const cols = [...Object.keys(next), 'control_flags', 'verified', 'verified_by', 'verified_at', 'updated_by', 'updated_at'];
    const vals = [...Object.values(next), JSON.stringify(flags), false, null, null, user.id, ctx.now];
    await ctx.db.query(`UPDATE accounting_entries SET ${cols.map((c, i) => `${c}=$${i + 2}`).join(', ')} WHERE payment_id=$1`, [p.id, ...vals]);
  } else {
    const cols = ['payment_id', ...Object.keys(next), 'control_flags', 'updated_by', 'updated_at'];
    const vals = [p.id, ...Object.values(next), JSON.stringify(flags), user.id, ctx.now];
    await ctx.db.query(`INSERT INTO accounting_entries(${cols.join(',')}) VALUES(${cols.map((_, i) => `$${i + 1}`).join(',')})`, vals);
  }
  if (p.status === 'ACCOUNTING_VERIFIED') await setStatus(ctx, p, 'C_VERIFIED', 'Accounting details modified – re-verification required');
  await audit(ctx, { action: 'ACCOUNTING_SAVED', entityType: 'accounting', entityId: p.id, paymentId: p.id, old: d.old, new: { ...d.new, flags }, remarks: `${actor(user)} (C) updated accounting details for ${p.pa_number}.` });
  return one('SELECT * FROM accounting_entries WHERE payment_id=$1', [p.id]);
}

export async function verifyAccounting(ctx: Ctx, user: SessionUser, idv: number, body: { confirm?: boolean }) {
  await needPerm(user, 'payment.verify_c');
  const p = await lockPayment(ctx.db, idv);
  if (!ACCT_STAGE(p) || p.status === 'ACCOUNTING_VERIFIED') throw badRequest(p.status === 'ACCOUNTING_VERIFIED' ? 'Accounting treatment is already verified.' : 'Accounting can be verified only after the original documents are verified.');
  await assertAccess(user, p, { bank: true });
  await checkSod(ctx.db, p.id, user, 'C');
  const a = await one<any>('SELECT * FROM accounting_entries WHERE payment_id=$1', [p.id], ctx.db);
  const req: [string, string][] = [['ledger_account', 'Ledger account'], ['cost_centre', 'Cost centre'], ['department', 'Department'], ['project', 'Project'], ['gst_treatment', 'GST treatment'], ['tds_section', 'TDS section'],
    ['voucher_no', 'Accounting voucher number'], ['accounting_date', 'Accounting date'], ['erp_reference', 'ERP reference number']];
  for (const [k, l] of req) if (!a || a[k] == null || String(a[k]).trim() === '') throw badRequest(`${l} is required before accounting can be verified.`);
  for (const k of ['tds_amount', 'gst_amount', 'basic_amount', 'other_deductions', 'advance_adjustment', 'net_payable']) if (a[k] == null) throw badRequest(`${k.replace(/_/g, ' ')} is required before accounting can be verified.`);
  const calc = round2(Number(a.basic_amount) + Number(a.gst_amount) - Number(a.tds_amount) - Number(a.other_deductions) - Number(a.advance_adjustment));
  if (calc !== round2(Number(a.net_payable))) throw badRequest(`Accounting amounts do not add up: basic + GST − TDS − deductions − advance = ${formatINR(calc)}, but net payable is ${formatINR(a.net_payable)}.`);
  if (calc !== round2(p.net_payable)) throw badRequest(`Accounting net payable (${formatINR(calc)}) does not match the Payment Advice net payable (${formatINR(p.net_payable)}). Raise a query to A.`);
  if (!body.confirm) throw badRequest('Please confirm "Accounting treatment verified" to continue.');
  await ctx.db.query('UPDATE accounting_entries SET verified=true, verified_by=$2, verified_at=$3, updated_by=$2, updated_at=$3 WHERE payment_id=$1', [p.id, user.id, ctx.now]);
  const from = p.status;
  await setStatus(ctx, p, 'ACCOUNTING_VERIFIED', 'Accounting treatment verified by C');
  await audit(ctx, { action: 'ACCOUNTING_VERIFIED', entityType: 'accounting', entityId: p.id, paymentId: p.id, old: { status: from }, new: { status: 'ACCOUNTING_VERIFIED', voucher_no: a.voucher_no, erp_reference: a.erp_reference }, remarks: `${actor(user)} (C) verified accounting treatment for ${p.pa_number}.` });
  return p;
}

// ======================================================================= C : bank initiation
const bankInitSchema = z.object({
  bank_ref_no: optStr(80), utr: optStr(40),
  initiated_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(), initiated_time: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/).optional().nullable(),
  mode_details: z.record(z.string().max(120)).default({}), remarks: optStr(1000),
});
export async function initiateBank(ctx: Ctx, user: SessionUser, idv: number, body: unknown) {
  await needPerm(user, 'payment.initiate_bank');
  const b = parse(bankInitSchema, body);
  const p = await lockPayment(ctx.db, idv);
  const okStage = p.status === 'ACCOUNTING_VERIFIED' || (p.status === 'D_REJECTED' && p.return_to_stage === 'C') || p.status === 'PAYMENT_FAILED';
  if (!okStage) throw badRequest(['C_VERIFIED'].includes(p.status) ? 'Payment cannot be initiated until accounting verification is completed.' : `Payment cannot be initiated while it is "${p.status.replace(/_/g, ' ')}".`);
  await assertAccess(user, p, { bank: true });
  await checkSod(ctx.db, p.id, user, 'C');
  const cl = await controlChecklist(ctx.db, p);
  if (!cl.ready) { const first = cl.items.find((i) => !i.ok)!; throw badRequest(first.message, { checklist: cl.items }); }
  const mode = await modeChecks(ctx.db, p);
  const md: Record<string, string> = { ...b.mode_details };
  if (b.bank_ref_no) md.bank_ref_no = b.bank_ref_no;
  if (!md.bank_ref_no) md.bank_ref_no = md.cheque_no || md.dd_no || '';
  const label: Record<string, string> = { bank_ref_no: 'Bank reference number', cheque_no: 'Cheque number', cheque_date: 'Cheque date', dd_no: 'Demand draft number', dd_favouring: 'Draft favouring', upi_id: 'UPI ID', destination_account: 'Destination account' };
  for (const f of mode.required_fields as string[]) if (!md[f] || !String(md[f]).trim()) throw badRequest(`${label[f] ?? f} is required for ${mode.name}.`);
  if (!md.bank_ref_no) throw badRequest('Bank reference number is required.');
  if (mode.requires_beneficiary_bank && (!p.beneficiary_ifsc || !IFSC_RE.test(p.beneficiary_ifsc))) throw badRequest('Beneficiary IFSC is missing or invalid.');
  const dupRef = await one<any>(`SELECT p.pa_number FROM bank_transactions t JOIN payment_advises p ON p.id=t.payment_id WHERE lower(t.bank_ref_no)=lower($1) AND t.payment_id<>$2 AND p.status NOT IN ('CANCELLED') LIMIT 1`, [md.bank_ref_no, p.id], ctx.db);
  if (dupRef) throw conflict(`Bank reference ${md.bank_ref_no} is already recorded against ${dupRef.pa_number}.`);
  let initiatedAt = ctx.now;
  if (b.initiated_date) {
    initiatedAt = new Date(`${b.initiated_date}T${(b.initiated_time ?? '00:00').length === 5 ? (b.initiated_time ?? '00:00') + ':00' : b.initiated_time}+05:30`);
    if (isNaN(initiatedAt.getTime())) throw badRequest('Payment initiation date / time is invalid.');
  }
  const bank = (await one<any>('SELECT * FROM bank_accounts WHERE id=$1', [p.bank_account_id], ctx.db))!;
  const seq = p.bank_round + 1;
  await ctx.db.query('UPDATE bank_transactions SET is_current=false WHERE payment_id=$1', [p.id]);
  const { bank_ref_no: _r, ...rest } = md;
  await ctx.db.query(`INSERT INTO bank_transactions(payment_id,seq_no,bank_account_id,bank_name,payment_mode,bank_portal,bank_ref_no,initiated_at,initiated_by,amount,beneficiary_name,beneficiary_account_last4,utr,bank_status,mode_details,remarks,updated_by,updated_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'INITIATED',$14,$15,$9,$16)`,
    [p.id, seq, bank.id, bank.bank_name, p.payment_mode, bank.bank_portal, md.bank_ref_no, initiatedAt, user.id, p.net_payable, p.beneficiary_name, p.beneficiary_account_last4, b.utr, JSON.stringify(rest), b.remarks, ctx.now]);
  await ctx.db.query(`UPDATE payment_queries SET status='RESOLVED', resolved_by=$2, resolved_at=$3, resolution_remarks='Bank payment re-initiated' WHERE payment_id=$1 AND status='OPEN' AND return_to_stage='C'`, [p.id, user.id, ctx.now]);
  await setStatus(ctx, p, 'PAYMENT_INITIATED', `Payment initiated on ${bank.bank_portal ?? bank.bank_name} – ref ${md.bank_ref_no}`, { bank_round: seq, return_to_stage: null });
  await setStatus(ctx, p, 'PENDING_D_APPROVAL', 'Forwarded to D for final bank approval');
  await audit(ctx, { action: 'C_INITIATED_PAYMENT', entityType: 'bank_transaction', entityId: p.id, paymentId: p.id, new: { bank: bank.bank_name, mode: p.payment_mode, bank_ref_no: md.bank_ref_no, amount: p.net_payable, initiated_at: initiatedAt, beneficiary: p.beneficiary_name, seq }, remarks: `${actor(user)} (C) initiated payment ${p.pa_number} on ${bank.bank_portal ?? bank.bank_name} (ref ${md.bank_ref_no}).` });
  await notify(ctx, 'PAYMENT_INITIATED', brief(p), { bankReference: md.bank_ref_no });
  await notify(ctx, 'D_APPROVAL_PENDING', brief(p), { bankReference: md.bank_ref_no });
  return p;
}

// ======================================================================= D : final approval
const dSchema = z.object({
  decision: z.enum(['APPROVE', 'REJECT'], { errorMap: () => ({ message: 'Choose Approve payment or Reject / return.' }) }),
  checklist: z.record(z.boolean()).default({}), remarks: optStr(2000), reason: optStr(1000), return_to: z.enum(['A', 'C']).optional(),
});
export async function dDecision(ctx: Ctx, user: SessionUser, idv: number, body: unknown) {
  await needPerm(user, 'payment.approve_d');
  const b = parse(dSchema, body);
  const p = await lockPayment(ctx.db, idv);
  assertStatus(p, ['PENDING_D_APPROVAL'], 'Final approval');
  await assertAccess(user, p, { bank: true });
  await checkSod(ctx.db, p.id, user, 'D');
  const already = await one('SELECT 1 x FROM payment_approvals WHERE payment_id=$1 AND stage=$2 AND round_no=$3 AND approver_id=$4', [p.id, 'D', p.bank_round, user.id], ctx.db);
  if (already) throw forbidden('You have already recorded a decision on this payment.');
  const plan: ApprovalPlan = p.approval_plan ?? { matrix_id: null, matrix_name: '', b_levels: [], d_count: 1 };
  const txn = await one<any>('SELECT * FROM bank_transactions WHERE payment_id=$1 AND is_current', [p.id], ctx.db);

  if (b.decision === 'REJECT') {
    const reason = requireText(b.reason, 'Rejection reason is mandatory.');
    if (!b.return_to) throw badRequest('Select the stage the payment should be returned to (A or C).');
    await ctx.db.query(`INSERT INTO payment_approvals(payment_id,stage,round_no,level_no,level_label,approver_id,decision,reason,remarks,checklist,return_to_stage,decided_at) VALUES($1,'D',$2,1,'Authorised Bank Approver',$3,'REJECTED',$4,$5,$6,$7,$8)`,
      [p.id, p.bank_round, user.id, reason, b.remarks, JSON.stringify(b.checklist), b.return_to, ctx.now]);
    await ctx.db.query(`INSERT INTO payment_queries(payment_id,version_no,raised_by_stage,raised_by,category,reason,remarks,return_to_stage,raised_at) VALUES($1,$2,'D',$3,'D_REJECTION',$4,$5,$6,$7)`,
      [p.id, p.version_no, user.id, reason, b.remarks, b.return_to, ctx.now]);
    await setStatus(ctx, p, 'D_REJECTED', reason, { return_to_stage: b.return_to });
    await audit(ctx, { action: 'D_REJECTED', entityType: 'payment', entityId: p.id, paymentId: p.id, old: { status: 'PENDING_D_APPROVAL' }, new: { status: 'D_REJECTED', return_to: b.return_to, reason }, remarks: `${actor(user)} (D) rejected payment ${p.pa_number} and returned it to ${b.return_to}: ${reason}` });
    await notify(ctx, 'D_REJECTED', brief(p), { reason });
    return p;
  }

  const missing = D_CHECKLIST.filter(([k]) => !b.checklist[k]).map(([, l]) => l);
  if (missing.length) throw badRequest(`Please confirm every item of the final review before approving. Not confirmed: ${missing.join(', ')}.`, { missing });
  await ctx.db.query(`INSERT INTO payment_approvals(payment_id,stage,round_no,level_no,level_label,approver_id,decision,remarks,checklist,decided_at) VALUES($1,'D',$2,1,'Authorised Bank Approver',$3,'APPROVED',$4,$5,$6)`,
    [p.id, p.bank_round, user.id, b.remarks, JSON.stringify(b.checklist), ctx.now]);
  const cnt = (await one<{ n: number }>(`SELECT count(*)::int n FROM payment_approvals WHERE payment_id=$1 AND stage='D' AND round_no=$2 AND decision='APPROVED'`, [p.id, p.bank_round], ctx.db))!.n;
  if (cnt < plan.d_count) {
    await audit(ctx, { action: 'D_APPROVED_PARTIAL', entityType: 'payment', entityId: p.id, paymentId: p.id, new: { approvals: cnt, required: plan.d_count }, remarks: `${actor(user)} (D) approved ${p.pa_number} (${cnt} of ${plan.d_count} final approvals).` });
    await notify(ctx, 'D_APPROVAL_PENDING', brief(p), { remarks: `${cnt} of ${plan.d_count} final approvals recorded.` });
    return p;
  }
  await setStatus(ctx, p, 'D_APPROVED', b.remarks ?? 'Final payment approved', { final_approved_at: ctx.now });
  if (txn) await ctx.db.query(`UPDATE bank_transactions SET bank_status='APPROVED', updated_by=$2, updated_at=$3 WHERE id=$1`, [txn.id, user.id, ctx.now]);
  await audit(ctx, { action: 'D_APPROVED_FINAL', entityType: 'payment', entityId: p.id, paymentId: p.id, old: { status: 'PENDING_D_APPROVAL' }, new: { status: 'D_APPROVED', approved_by: user.name, approved_at: ctx.now, bank_reference: txn?.bank_ref_no, remarks: b.remarks },
    remarks: `${actor(user)} (D) approved final payment ${p.pa_number}. Status: PAYMENT APPROVED.` });
  await notify(ctx, 'D_APPROVED', brief(p), { approvedBy: user.name, approvalDate: fmtDate(ctx.now), bankReference: txn?.bank_ref_no ?? '—', bankName: txn?.bank_name });
  return p;
}

// ======================================================================= C : bank status / reconciliation
const bankUpdateSchema = z.object({
  bank_status: z.enum(['INITIATED', 'APPROVED', 'PROCESSED', 'FAILED', 'RETURNED', 'REVERSED', 'RECONCILED'], { errorMap: () => ({ message: 'Select a valid bank status.' }) }),
  utr: optStr(40), bank_txn_id: optStr(60), actual_debit_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  actual_debit_amount: z.coerce.number().min(0).optional().nullable(), remarks: optStr(1000),
});
export async function updateBankStatus(ctx: Ctx, user: SessionUser, idv: number, body: unknown) {
  await needPerm(user, 'payment.bank_update');
  const b = parse(bankUpdateSchema, body);
  const p = await lockPayment(ctx.db, idv);
  assertStatus(p, ['D_APPROVED', 'PAYMENT_COMPLETED'], 'Bank status update');
  await assertAccess(user, p, { bank: true });
  await checkSod(ctx.db, p.id, user, 'C');
  const t = await one<any>('SELECT * FROM bank_transactions WHERE payment_id=$1 AND is_current', [p.id], ctx.db);
  if (!t) throw notFound('No bank transaction has been recorded for this payment.');
  const utr = b.utr ?? t.utr; const debitDate = b.actual_debit_date ?? t.actual_debit_date; const debitAmt = b.actual_debit_amount ?? t.actual_debit_amount;
  const completing = b.bank_status === 'PROCESSED' || b.bank_status === 'RECONCILED';
  if (completing) {
    if (!utr) throw badRequest('UTR is required to mark the payment as processed.');
    if (!debitDate) throw badRequest('Actual debit date is required.');
    if (debitAmt == null) throw badRequest('Actual debit amount is required.');
    if (round2(Number(debitAmt)) !== round2(p.net_payable) && !b.remarks) throw badRequest(`Actual debit amount (${formatINR(debitAmt)}) differs from the approved amount (${formatINR(p.net_payable)}). Please explain in remarks.`);
    const dupUtr = await one<any>(`SELECT p.pa_number FROM bank_transactions x JOIN payment_advises p ON p.id=x.payment_id WHERE lower(x.utr)=lower($1) AND x.id<>$2 LIMIT 1`, [utr, t.id], ctx.db);
    if (dupUtr) throw conflict(`UTR ${utr} is already recorded against ${dupUtr.pa_number}.`);
  }
  if (p.status === 'PAYMENT_COMPLETED' && !['RECONCILED', 'RETURNED', 'REVERSED', 'PROCESSED'].includes(b.bank_status)) throw badRequest('A completed payment can only be reconciled, returned or reversed.');
  await ctx.db.query(`UPDATE bank_transactions SET bank_status=$2, utr=$3, bank_txn_id=COALESCE($4,bank_txn_id), actual_debit_date=$5, actual_debit_amount=$6, remarks=COALESCE($7,remarks), updated_by=$8, updated_at=$9 WHERE id=$1`,
    [t.id, b.bank_status, utr, b.bank_txn_id, debitDate, debitAmt, b.remarks, user.id, ctx.now]);
  const old = { bank_status: t.bank_status, utr: t.utr, actual_debit_amount: t.actual_debit_amount };
  const nw = { bank_status: b.bank_status, utr, bank_txn_id: b.bank_txn_id, actual_debit_date: debitDate, actual_debit_amount: debitAmt };
  let event: any = null;
  if (completing && p.status === 'D_APPROVED') { await setStatus(ctx, p, 'PAYMENT_COMPLETED', `Bank status ${b.bank_status} – UTR ${utr}`, { completed_at: ctx.now }); event = 'PAYMENT_COMPLETED'; }
  else if (b.bank_status === 'FAILED') { await setStatus(ctx, p, 'PAYMENT_FAILED', b.remarks ?? 'Bank payment failed'); event = 'PAYMENT_FAILED'; }
  else if (b.bank_status === 'RETURNED' || b.bank_status === 'REVERSED') { await setStatus(ctx, p, 'PAYMENT_REVERSED', b.remarks ?? `Payment ${b.bank_status.toLowerCase()} by bank`); event = 'PAYMENT_FAILED'; }
  await audit(ctx, { action: 'BANK_STATUS_UPDATED', entityType: 'bank_transaction', entityId: t.id, paymentId: p.id, old, new: nw, remarks: `${actor(user)} (C) updated bank status of ${p.pa_number} to ${b.bank_status}.` });
  if (event) await notify(ctx, event, brief(p), { bankReference: t.bank_ref_no, reason: b.remarks ?? undefined });
  return p;
}

// ======================================================================= hold / release / cancel
export async function holdPayment(ctx: Ctx, user: SessionUser, idv: number, reason: string) {
  await needPerm(user, 'payment.hold');
  const why = requireText(reason, 'A reason is required to put a payment on hold.');
  const p = await lockPayment(ctx.db, idv);
  if (['DRAFT', 'CANCELLED', 'ON_HOLD', 'PAYMENT_COMPLETED', 'PAYMENT_REVERSED'].includes(p.status)) throw badRequest(`A payment that is "${p.status.replace(/_/g, ' ')}" cannot be put on hold.`);
  await assertAccess(user, p);
  const from = p.status;
  await setStatus(ctx, p, 'ON_HOLD', why, { hold_previous_status: from, hold_reason: why });
  await audit(ctx, { action: 'PAYMENT_ON_HOLD', entityType: 'payment', entityId: p.id, paymentId: p.id, old: { status: from }, new: { status: 'ON_HOLD', reason: why }, remarks: `${actor(user)} put ${p.pa_number} on hold: ${why}` });
  await notify(ctx, 'PAYMENT_ON_HOLD', brief(p), { reason: `On hold: ${why}` });
  return p;
}
export async function releaseHold(ctx: Ctx, user: SessionUser, idv: number, remarks?: string) {
  await needPerm(user, 'payment.hold');
  const p = await lockPayment(ctx.db, idv);
  if (p.status !== 'ON_HOLD' || !p.hold_previous_status) throw badRequest('This payment is not on hold.');
  await assertAccess(user, p);
  const to = p.hold_previous_status;
  await setStatus(ctx, p, to, remarks || 'Released from hold', { hold_previous_status: null, hold_reason: null });
  await audit(ctx, { action: 'PAYMENT_HOLD_RELEASED', entityType: 'payment', entityId: p.id, paymentId: p.id, old: { status: 'ON_HOLD' }, new: { status: to }, remarks: `${actor(user)} released ${p.pa_number} from hold.` });
  await notify(ctx, 'PAYMENT_ON_HOLD', brief(p), { reason: 'Released from hold' });
  return p;
}

export async function cancelPayment(ctx: Ctx, user: SessionUser, idv: number, reason: string) {
  await needPerm(user, 'payment.cancel_request');
  const why = requireText(reason, 'Cancellation reason is required.');
  const p = await lockPayment(ctx.db, idv);
  if (['CANCELLED', 'PAYMENT_COMPLETED', 'PAYMENT_REVERSED'].includes(p.status)) throw badRequest(`A payment that is "${p.status.replace(/_/g, ' ')}" cannot be cancelled.`);
  const pending = await one('SELECT id FROM cancellation_requests WHERE payment_id=$1 AND status=$2', [p.id, 'PENDING'], ctx.db);
  if (pending) throw badRequest('A cancellation request is already pending for this payment.');
  await assertAccess(user, p);
  const basis = p.status === 'ON_HOLD' ? (p.hold_previous_status ?? p.status) : p.status;
  const preB = ['DRAFT', 'SUBMITTED', 'PENDING_B_APPROVAL', 'B_REJECTED'].includes(basis);
  if (preB && (p.created_by === user.id || hasRole(user, 'B', 'ADMIN'))) {
    await setStatus(ctx, p, 'CANCELLED', why, { cancel_reason: why, pending_b_level: null, pending_b_senior: false });
    await audit(ctx, { action: 'PAYMENT_CANCELLED', entityType: 'payment', entityId: p.id, paymentId: p.id, old: { status: basis }, new: { status: 'CANCELLED', reason: why }, remarks: `${actor(user)} cancelled ${p.pa_number}: ${why}` });
    await notify(ctx, 'PAYMENT_CANCELLED', brief(p), { reason: why });
    return { cancelled: true, payment: p };
  }
  if (preB) throw forbidden('Only the maker who created the advice, or an approver / administrator, can cancel it at this stage.');
  const kind = basis === 'D_APPROVED' ? 'POST_FINAL' : 'PRE_FINAL';
  if (kind === 'POST_FINAL' && !hasRole(user, 'D', 'ADMIN')) throw forbidden('After final bank approval, cancellation follows a separate authorised process: it must be requested by D or the System Administrator and approved by another authorised D.');
  const r = await ctx.db.query(`INSERT INTO cancellation_requests(payment_id,kind,status_at_request,reason,requested_by,requested_at) VALUES($1,$2,$3,$4,$5,$6) RETURNING id`, [p.id, kind, p.status, why, user.id, ctx.now]);
  await audit(ctx, { action: 'CANCELLATION_REQUESTED', entityType: 'cancellation', entityId: r.rows[0].id, paymentId: p.id, new: { kind, reason: why, status: p.status }, remarks: `${actor(user)} requested cancellation of ${p.pa_number}: ${why}` });
  await notify(ctx, 'CANCELLATION_REQUESTED', brief(p), { reason: why });
  return { cancelled: false, request_id: r.rows[0].id, payment: p };
}

export async function decideCancellation(ctx: Ctx, user: SessionUser, idv: number, reqId: number, body: { approve: boolean; remarks?: string }) {
  await needPerm(user, 'payment.cancel_approve');
  const p = await lockPayment(ctx.db, idv);
  const r = await one<any>('SELECT * FROM cancellation_requests WHERE id=$1 AND payment_id=$2 FOR UPDATE', [reqId, p.id], ctx.db);
  if (!r || r.status !== 'PENDING') throw badRequest('This cancellation request is no longer pending.');
  if (r.requested_by === user.id) throw forbidden('The person who requested the cancellation cannot approve it.');
  if (r.kind === 'POST_FINAL' && !hasRole(user, 'D')) throw forbidden('Cancellation after final approval must be approved by an authorised bank approver (D).');
  await assertAccess(user, p);
  if (!body.approve && !body.remarks?.trim()) throw badRequest('Please give a reason for rejecting the cancellation request.');
  await ctx.db.query(`UPDATE cancellation_requests SET status=$2, decided_by=$3, decided_at=$4, decision_remarks=$5 WHERE id=$1`, [reqId, body.approve ? 'APPROVED' : 'REJECTED', user.id, ctx.now, body.remarks ?? null]);
  if (body.approve) {
    if (r.kind === 'POST_FINAL') await ctx.db.query(`UPDATE bank_transactions SET remarks = COALESCE(remarks || ' | ','') || $2, updated_at=$3 WHERE payment_id=$1 AND is_current`, [p.id, 'CANCELLED after final approval – stop payment on bank portal', ctx.now]);
    await setStatus(ctx, p, 'CANCELLED', r.reason, { cancel_reason: r.reason });
    await notify(ctx, 'PAYMENT_CANCELLED', brief(p), { reason: r.reason });
  }
  await audit(ctx, { action: body.approve ? 'CANCELLATION_APPROVED' : 'CANCELLATION_REJECTED', entityType: 'cancellation', entityId: reqId, paymentId: p.id, new: { decision: body.approve ? 'APPROVED' : 'REJECTED', remarks: body.remarks }, remarks: `${actor(user)} ${body.approve ? 'approved' : 'rejected'} the cancellation of ${p.pa_number}.` });
  return p;
}

export { A_EDITABLE, maskAccount, fmtDateTime, snapshotPayment };
