import { z } from 'zod';
import type { PoolClient } from 'pg';
import { pool, query, one, type Db } from '../db.js';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import { parse, optStr, reqStr, money, dateStr, id as idField, IFSC_RE } from '../lib/validate.js';
import { audit, diff, type Ctx } from './audit.js';
import { decryptText, maskAccount } from '../lib/crypto.js';
import { formatINR, isoDate, round2 } from '../lib/format.js';
import { PAYMENT_TYPES, PRIORITIES, A_EDITABLE, C_DOC_CHECKLIST } from '../constants.js';
import { hasRole, paymentScope, userPermissions, checkSod, type SessionUser } from './access.js';
import { PAYMENT_FROM, buildPaymentWhere, SORTABLE, stageOwnerSql, type PaymentFilters } from './paymentQuery.js';

// ---------------------------------------------------------------- types
export interface PaymentRow {
  id: number; pa_number: string; pa_year: number; company_id: number; bank_account_id: number; vendor_id: number; payment_type: string; payment_mode: string;
  priority: string; department: string | null; invoice_number: string; invoice_date: string; po_number: string | null; grn_reference: string | null;
  gross_amount: number; gst_amount: number; tds_amount: number; other_deduction: number; advance_adjustment: number; net_payable: number; due_date: string;
  purpose: string | null; remarks: string | null; beneficiary_name: string | null; beneficiary_bank_name: string | null; beneficiary_account_enc: string | null;
  beneficiary_account_last4: string | null; beneficiary_ifsc: string | null; status: string; return_to_stage: string | null; version_no: number; approval_round: number;
  bank_round: number; is_amendment: boolean; pending_b_level: number | null; pending_b_senior: boolean; matrix_id: number | null; approval_plan: any;
  duplicate_override_reason: string | null; duplicate_override_by: number | null; duplicate_of: string | null; hold_previous_status: string | null; hold_reason: string | null;
  cancel_reason: string | null; created_by: number; is_demo: boolean; created_at: string; submitted_at: string | null; final_approved_at: string | null; completed_at: string | null; updated_at: string;
}

export const MATERIAL_FIELDS = ['company_id', 'bank_account_id', 'vendor_id', 'payment_type', 'payment_mode', 'department', 'invoice_number', 'invoice_date',
  'gross_amount', 'gst_amount', 'tds_amount', 'other_deduction', 'advance_adjustment'] as const;
const NON_MATERIAL_FIELDS = ['priority', 'due_date', 'purpose', 'remarks', 'po_number', 'grn_reference'] as const;
const FIELD_LABEL: Record<string, string> = {
  company_id: 'Company', bank_account_id: 'Bank account', vendor_id: 'Vendor', payment_type: 'Payment type', payment_mode: 'Payment mode', department: 'Department',
  invoice_number: 'Invoice', invoice_date: 'Invoice date', gross_amount: 'Amount', gst_amount: 'GST', tds_amount: 'TDS', other_deduction: 'Deductions', advance_adjustment: 'Advance adjustment',
};

// ---------------------------------------------------------------- input schema
const itemSchema = z.object({
  description: reqStr('Line item description is required.', 300), hsn_sac: optStr(20),
  quantity: z.coerce.number().min(0).default(1), rate: z.coerce.number().min(0).default(0), amount: z.coerce.number().min(0).default(0), gst_rate: z.coerce.number().min(0).max(100).default(0),
});
export const paymentSchema = z.object({
  company_id: idField('Company'),
  bank_account_id: idField('Bank account'),
  vendor_id: idField('Vendor / party'),
  payment_type: reqStr('Payment type is required.', 40),
  payment_mode: reqStr('Payment mode is required.', 30),
  priority: z.enum(PRIORITIES as [string, ...string[]]).default('NORMAL'),
  department: optStr(80),
  invoice_number: reqStr('Invoice number is required.', 60),
  invoice_date: dateStr('Invoice date'),
  po_number: optStr(60), grn_reference: optStr(60),
  gross_amount: money('Payment amount').refine((v) => v > 0, 'Payment amount must be greater than zero.'),
  gst_amount: money('GST amount').default(0), tds_amount: money('TDS amount').default(0), other_deduction: money('Other deduction').default(0), advance_adjustment: money('Advance adjustment').default(0),
  due_date: dateStr('Due date'),
  purpose: optStr(500), remarks: optStr(2000),
  items: z.array(itemSchema).max(100).optional(),
});
export type PaymentInput = z.infer<typeof paymentSchema>;

export function computeNet(i: { gross_amount: number; tds_amount: number; other_deduction: number; advance_adjustment: number; gst_amount: number }) {
  if (i.gst_amount > i.gross_amount) throw badRequest('GST amount cannot exceed the invoice amount.');
  if (i.tds_amount > i.gross_amount) throw badRequest('TDS amount cannot exceed the invoice amount.');
  const net = round2(i.gross_amount - i.tds_amount - i.other_deduction - i.advance_adjustment);
  if (net < 0) throw badRequest('Deductions and advance adjustment cannot exceed the invoice amount.');
  return net;
}

// ---------------------------------------------------------------- helpers
export async function lockPayment(db: Db, idv: number): Promise<PaymentRow> {
  const p = await one<PaymentRow>('SELECT * FROM payment_advises WHERE id=$1 FOR UPDATE', [idv], db);
  if (!p) throw notFound('Payment Advice not found.');
  return p;
}
export async function loadScoped(user: SessionUser, idv: number, db: Db = pool): Promise<PaymentRow> {
  const params: any[] = [idv];
  const where = paymentScope(user, 'p', params);
  const p = await one<PaymentRow>(`SELECT p.* FROM payment_advises p WHERE p.id=$1 AND ${where}`, params, db);
  if (!p) throw notFound('Payment Advice not found or you do not have access to it.');
  return p;
}

export async function setStatus(ctx: Ctx, p: PaymentRow, to: string, remarks: string | null, patch: Record<string, any> = {}) {
  const from = p.status;
  const cols = Object.keys(patch);
  const sets = ['status=$2', 'updated_at=$3', ...cols.map((c, i) => `${c}=$${i + 4}`)];
  await ctx.db.query(`UPDATE payment_advises SET ${sets.join(', ')} WHERE id=$1`, [p.id, to, ctx.now, ...cols.map((c) => patch[c])]);
  await ctx.db.query('INSERT INTO payment_status_history(payment_id,from_status,to_status,changed_by,remarks,at) VALUES($1,$2,$3,$4,$5,$6)', [p.id, from, to, ctx.user?.id ?? null, remarks, ctx.now]);
  p.status = to; Object.assign(p, patch); p.updated_at = ctx.now.toISOString();
}

export async function nextPaNumber(ctx: Ctx) {
  const year = Number(isoDate(ctx.now).slice(0, 4));
  const r = await ctx.db.query(`INSERT INTO payment_sequences(year,last_no) VALUES($1,1) ON CONFLICT (year) DO UPDATE SET last_no = payment_sequences.last_no + 1 RETURNING last_no`, [year]);
  const n = r.rows[0].last_no as number;
  return { year, no: n, pa: `PA-${year}-${String(n).padStart(6, '0')}` };
}

export async function beneficiarySnapshot(db: Db, vendorId: number) {
  const v = await one<any>('SELECT * FROM vendors WHERE id=$1', [vendorId], db);
  if (!v) throw badRequest('Vendor / party not found.');
  return { name: v.name, bank_name: v.bank_name, enc: v.bank_account_enc, last4: v.bank_account_last4, ifsc: v.ifsc, authorised: !!v.bank_authorised_at, vendor: v };
}

export async function validateRefs(user: SessionUser, ctx: { db: Db }, i: PaymentInput) {
  const company = await one<any>('SELECT * FROM companies WHERE id=$1', [i.company_id], ctx.db);
  if (!company || !company.is_active) throw badRequest('Selected company is not available.');
  if (!(hasRole(user, 'ADMIN') && !user.companyIds.length) && !user.companyIds.includes(i.company_id)) throw forbidden('You do not have access to this company.');
  const bank = await one<any>('SELECT * FROM bank_accounts WHERE id=$1', [i.bank_account_id], ctx.db);
  if (!bank || !bank.is_active || bank.company_id !== i.company_id) throw badRequest('Selected bank account does not belong to the selected company or is inactive.');
  if (user.bankAccountIds && !user.bankAccountIds.includes(i.bank_account_id)) throw forbidden('You do not have access to this bank account.');
  const vendor = await one<any>('SELECT * FROM vendors WHERE id=$1', [i.vendor_id], ctx.db);
  if (!vendor || !vendor.is_active) throw badRequest('Selected vendor / party is inactive or not found.');
  if (!PAYMENT_TYPES.some((t) => t.code === i.payment_type)) throw badRequest('Invalid payment type.');
  const mode = await one<any>('SELECT * FROM payment_modes WHERE code=$1', [i.payment_mode], ctx.db);
  if (!mode || !mode.is_active) throw badRequest('Selected payment mode is not available.');
  const inv = new Date(i.invoice_date + 'T00:00:00Z'); const today = new Date(isoDate(new Date()) + 'T00:00:00Z');
  if (inv.getTime() > today.getTime() + 86400000) throw badRequest('Invoice date cannot be in the future.');
  if (i.due_date < i.invoice_date) throw badRequest('Due date cannot be earlier than the invoice date.');
  return { company, bank, vendor, mode };
}

// ---------------------------------------------------------------- duplicate control
export interface DuplicateMatch { id: number; pa_number: string; status: string; vendor: string; invoice_number: string; invoice_date: string; amount: number; kind: 'EXACT' | 'SAME_INVOICE_NO' }
export async function findDuplicates(db: Db, i: { company_id: number; vendor_id: number; invoice_number: string; invoice_date: string; gross_amount: number }, excludeId?: number): Promise<DuplicateMatch[]> {
  const rows = await query<any>(
    `SELECT p.id, p.pa_number, p.status, v.name AS vendor, p.invoice_number, p.invoice_date, p.gross_amount AS amount,
            (p.invoice_date = $4::date AND p.gross_amount = $5 AND p.company_id = $1) AS exact
       FROM payment_advises p JOIN vendors v ON v.id = p.vendor_id
      WHERE p.vendor_id = $2 AND lower(btrim(p.invoice_number)) = lower(btrim($3)) AND p.status NOT IN ('CANCELLED','PAYMENT_REVERSED')
        AND ($6::bigint IS NULL OR p.id <> $6)
      ORDER BY p.id`, [i.company_id, i.vendor_id, i.invoice_number, i.invoice_date, i.gross_amount, excludeId ?? null], db);
  return rows.map((r) => ({ ...r, kind: r.exact ? 'EXACT' : 'SAME_INVOICE_NO' }));
}

// ---------------------------------------------------------------- create / update
async function writeItems(db: Db, paymentId: number, items: PaymentInput['items']) {
  if (!items) return;
  await db.query('DELETE FROM payment_items WHERE payment_id=$1', [paymentId]);
  let n = 1;
  for (const it of items) await db.query('INSERT INTO payment_items(payment_id,line_no,description,hsn_sac,quantity,rate,amount,gst_rate) VALUES($1,$2,$3,$4,$5,$6,$7,$8)', [paymentId, n++, it.description, it.hsn_sac, it.quantity, it.rate, it.amount, it.gst_rate]);
}

export async function createPayment(ctx: Ctx, user: SessionUser, body: unknown) {
  const i = parse(paymentSchema, body);
  await validateRefs(user, ctx, i);
  const net = computeNet(i);
  const ben = await beneficiarySnapshot(ctx.db, i.vendor_id);
  const num = await nextPaNumber(ctx);
  const r = await ctx.db.query(
    `INSERT INTO payment_advises(pa_number,pa_year,company_id,bank_account_id,vendor_id,payment_type,payment_mode,priority,department,invoice_number,invoice_date,po_number,grn_reference,
       gross_amount,gst_amount,tds_amount,other_deduction,advance_adjustment,net_payable,due_date,purpose,remarks,
       beneficiary_name,beneficiary_bank_name,beneficiary_account_enc,beneficiary_account_last4,beneficiary_ifsc,status,created_by,is_demo,created_at,updated_at)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,'DRAFT',$28,$29,$30,$30) RETURNING *`,
    [num.pa, num.year, i.company_id, i.bank_account_id, i.vendor_id, i.payment_type, i.payment_mode, i.priority, i.department, i.invoice_number, i.invoice_date, i.po_number, i.grn_reference,
      i.gross_amount, i.gst_amount, i.tds_amount, i.other_deduction, i.advance_adjustment, net, i.due_date, i.purpose, i.remarks,
      ben.name, ben.bank_name, ben.enc, ben.last4, ben.ifsc, user.id, (ctx as any).demo === true, ctx.now]);
  const p = r.rows[0] as PaymentRow;
  await writeItems(ctx.db, p.id, i.items);
  await ctx.db.query('INSERT INTO payment_status_history(payment_id,from_status,to_status,changed_by,remarks,at) VALUES($1,NULL,$2,$3,$4,$5)', [p.id, 'DRAFT', user.id, 'Payment Advice created', ctx.now]);
  await audit(ctx, { action: 'PAYMENT_CREATED', entityType: 'payment', entityId: p.id, paymentId: p.id, new: { pa_number: p.pa_number, vendor_id: i.vendor_id, amount: net, invoice: i.invoice_number }, remarks: `${user.name} (A) created payment advice ${p.pa_number}.` });
  return p;
}

/** A edits a payment while it is with A. Material fields are locked once B has approved. */
export async function updatePayment(ctx: Ctx, user: SessionUser, idv: number, body: unknown) {
  const p = await lockPayment(ctx.db, idv);
  if (p.created_by !== user.id) throw forbidden('Only the maker who created this Payment Advice can edit it.');
  const stageWithA = A_EDITABLE.includes(p.status) && (p.status !== 'D_REJECTED' || p.return_to_stage === 'A');
  if (!stageWithA) throw forbidden(p.status === 'DRAFT' ? 'This payment cannot be edited.' : 'This Payment Advice cannot be edited at its current stage. Use the formal rejection / resubmission or Amendment process.');
  const i = parse(paymentSchema, body);
  await validateRefs(user, ctx, i);
  const net = computeNet(i);
  const approvedBefore = !['DRAFT', 'B_REJECTED'].includes(p.status);
  const next: Record<string, any> = { ...i, net_payable: net };
  if (approvedBefore) {
    const bad = MATERIAL_FIELDS.filter((f) => String((p as any)[f] ?? '') !== String((next as any)[f] ?? '') && !(typeof (p as any)[f] === 'number' && Number((p as any)[f]) === Number((next as any)[f])));
    if (bad.length) throw forbidden(`${bad.map((f) => FIELD_LABEL[f]).join(', ')} cannot be changed after B approval. Raise an Amendment Request to restart the approval process.`);
  }
  const ben = await beneficiarySnapshot(ctx.db, i.vendor_id);
  const keys = [...MATERIAL_FIELDS, ...NON_MATERIAL_FIELDS, 'net_payable'];
  const d = diff(p as any, next, keys);
  const patch: Record<string, any> = {};
  for (const k of d.changed) patch[k] = next[k];
  if (!approvedBefore) Object.assign(patch, { beneficiary_name: ben.name, beneficiary_bank_name: ben.bank_name, beneficiary_account_enc: ben.enc, beneficiary_account_last4: ben.last4, beneficiary_ifsc: ben.ifsc });
  const cols = Object.keys(patch);
  if (cols.length) await ctx.db.query(`UPDATE payment_advises SET ${cols.map((c, n) => `${c}=$${n + 3}`).join(', ')}, updated_at=$2 WHERE id=$1`, [p.id, ctx.now, ...cols.map((c) => patch[c])]);
  if (i.items) await writeItems(ctx.db, p.id, i.items);
  if (d.changed.length || i.items) await audit(ctx, { action: 'PAYMENT_EDITED', entityType: 'payment', entityId: p.id, paymentId: p.id, old: d.old, new: d.new, remarks: `${user.name} (A) edited payment advice ${p.pa_number}.` });
  return lockPayment(ctx.db, idv);
}

// ---------------------------------------------------------------- snapshot (version history)
export async function snapshotPayment(db: Db, idv: number) {
  const p = await one<any>('SELECT * FROM payment_advises WHERE id=$1', [idv], db);
  const items = await query<any>('SELECT description,hsn_sac,quantity,rate,amount,gst_rate FROM payment_items WHERE payment_id=$1 ORDER BY line_no', [idv], db);
  const docs = await query<any>(`SELECT id,doc_name,doc_type,version,original_filename,size_bytes,sha256,status FROM payment_documents WHERE payment_id=$1 AND status<>'REMOVED' ORDER BY id`, [idv], db);
  const clean: any = { ...p }; delete clean.beneficiary_account_enc;
  return { payment: clean, items, documents: docs };
}
export async function writeVersion(ctx: Ctx, p: PaymentRow, reason: 'SUBMITTED' | 'RESUBMITTED' | 'AMENDMENT') {
  await ctx.db.query('INSERT INTO payment_versions(payment_id,version_no,reason,snapshot,created_by,created_at) VALUES($1,$2,$3,$4,$5,$6)',
    [p.id, p.version_no, reason, JSON.stringify(await snapshotPayment(ctx.db, p.id)), ctx.user!.id, ctx.now]);
}

// ---------------------------------------------------------------- control checklist (C, before initiation)
export interface CheckItem { key: string; label: string; ok: boolean; message: string }
export async function controlChecklist(db: Db, p: PaymentRow): Promise<{ items: CheckItem[]; ready: boolean }> {
  const acct = await one<any>('SELECT * FROM accounting_entries WHERE payment_id=$1', [p.id], db);
  const ver = await one<any>(`SELECT * FROM document_verifications WHERE payment_id=$1 ORDER BY id DESC LIMIT 1`, [p.id], db);
  const vendor = await one<any>('SELECT * FROM vendors WHERE id=$1', [p.vendor_id], db);
  const docs = await query<any>(`SELECT doc_type FROM payment_documents WHERE payment_id=$1 AND status='ACTIVE'`, [p.id], db);
  const mode = await one<any>('SELECT * FROM payment_modes WHERE code=$1', [p.payment_mode], db);
  const flags = acct?.control_flags ?? {};
  const items: CheckItem[] = [];
  const add = (key: string, label: string, ok: boolean, okMsg: string, failMsg: string) => items.push({ key, label, ok, message: ok ? okMsg : failMsg });

  add('originals', 'Original documents verified', !!ver && ver.result === 'VERIFIED' && ver.version_no === p.version_no, 'Original documents verified by C.', 'Original invoice verification is pending.');
  add('supporting_docs', 'Supporting document attached', docs.length > 0, `${docs.length} active document(s) attached.`, 'No supporting document is attached to this Payment Advice.');
  add('gl_code', 'GL code / ledger account', !!acct?.ledger_account, `Ledger: ${acct?.ledger_account}`, 'Ledger account (GL code) is missing.');
  add('vendor_ledger', 'Vendor ledger checked', !!flags.vendor_ledger_checked, 'Vendor ledger reviewed.', 'Confirm that the vendor ledger has been reviewed.');
  add('cost_centre', 'Cost centre', !!acct?.cost_centre, `Cost centre: ${acct?.cost_centre}`, 'Cost centre is missing.');
  add('gst', 'GST treatment & amount', !!acct?.gst_treatment && acct?.gst_amount != null && Number(acct.gst_amount) === Number(p.gst_amount), `GST ${formatINR(acct?.gst_amount)} – ${acct?.gst_treatment}`,
    !acct?.gst_treatment ? 'GST treatment is missing.' : 'GST amount in accounting does not match the Payment Advice.');
  const tdsOk = !!acct?.tds_section && acct?.tds_amount != null && Number(acct.tds_amount) === Number(p.tds_amount) && (Number(p.tds_amount) === 0 || acct.tds_section !== 'NONE');
  add('tds', 'TDS section & amount', tdsOk, `TDS ${formatINR(acct?.tds_amount)} – ${acct?.tds_section}`, !acct?.tds_section ? 'TDS section is missing (use NONE if not applicable).' : 'TDS amount / section does not match the Payment Advice.');
  add('advance', 'Advance adjustment recorded', acct?.advance_adjustment != null && Number(acct.advance_adjustment) === Number(p.advance_adjustment), `Advance adjusted: ${formatINR(acct?.advance_adjustment)}`, 'Advance adjustment in accounting does not match the Payment Advice.');
  add('dcn', 'Debit / credit notes considered', !!flags.debit_credit_note_checked, 'Debit / credit notes reviewed.', 'Confirm that pending debit / credit notes have been considered.');
  add('voucher', 'Accounting voucher', !!acct?.voucher_no && !!acct?.accounting_date && !!acct?.erp_reference, `Voucher ${acct?.voucher_no} · ERP ${acct?.erp_reference}`, 'Accounting voucher number, date and ERP reference are mandatory.');
  const recon = acct && round2(Number(acct.basic_amount) + Number(acct.gst_amount) - Number(acct.tds_amount) - Number(acct.other_deductions) - Number(acct.advance_adjustment)) === round2(p.net_payable) && Number(acct.net_payable) === Number(p.net_payable);
  add('amount_recon', 'Amount reconciles to Payment Advice', !!recon, `Net payable ${formatINR(p.net_payable)} reconciles.`, 'Accounting net payable does not reconcile with the Payment Advice net payable.');
  const bankOk = !mode?.requires_beneficiary_bank || (!!vendor?.bank_account_enc && !!vendor?.bank_authorised_at && vendor.bank_account_last4 === p.beneficiary_account_last4 && vendor.ifsc === p.beneficiary_ifsc);
  add('beneficiary_bank', 'Vendor bank details authorised & unchanged', bankOk, `Beneficiary account ${maskAccount(p.beneficiary_account_last4)}`,
    !vendor?.bank_account_enc ? 'Vendor bank account is missing.' : 'Vendor bank details changed after approval – raise an amendment so B re-approves.');
  add('accounting_confirmed', 'Accounting treatment verified', !!acct?.verified, 'Accounting treatment verified by C.', 'Payment cannot be initiated until accounting verification is completed.');
  return { items, ready: items.every((x) => x.ok) };
}

// ---------------------------------------------------------------- listing
export async function listPayments(user: SessionUser, f: PaymentFilters & { page?: string; page_size?: string; sort?: string; dir?: string }) {
  const params: any[] = [];
  const where = buildPaymentWhere(user, f, params);
  const page = Math.max(1, Number(f.page ?? 1)); const size = Math.min(200, Math.max(1, Number(f.page_size ?? 25)));
  const sortCol = SORTABLE[f.sort ?? ''] ?? 'p.updated_at'; const dir = f.dir === 'asc' ? 'ASC' : 'DESC';
  const total = (await one<{ n: number; amt: number }>(`SELECT count(*)::int AS n, COALESCE(sum(p.net_payable),0) AS amt ${PAYMENT_FROM} WHERE ${where}`, params))!;
  const rows = await query<any>(
    `SELECT p.id, p.pa_number, p.created_at, p.updated_at, c.name AS company, c.short_name AS company_short, v.name AS vendor, p.invoice_number, p.invoice_date, p.gross_amount, p.net_payable,
            p.due_date, p.priority, p.payment_mode, p.payment_type, p.status, s.label AS status_label, s.color AS status_color, p.return_to_stage, bk.bank_name, cr.name AS created_by_name,
            p.is_demo, p.version_no, p.is_amendment, ${stageOwnerSql} AS stage_owner
       ${PAYMENT_FROM} WHERE ${where} ORDER BY ${sortCol} ${dir}, p.id DESC LIMIT ${size} OFFSET ${(page - 1) * size}`, params);
  return { rows, total: total.n, total_amount: total.amt, page, pageSize: size };
}

// ---------------------------------------------------------------- detail
export async function getPaymentDetail(user: SessionUser, idv: number) {
  const p0 = await loadScoped(user, idv);
  const [head] = await query<any>(
    `SELECT c.name AS company_name, c.short_name AS company_short, c.cin, c.pan AS company_pan, c.gstin AS company_gstin, c.tan, c.address AS company_address, (c.logo_data IS NOT NULL) AS has_logo,
            bk.bank_name, bk.account_name, bk.account_last4, bk.ifsc AS bank_ifsc, bk.branch, bk.bank_portal, bk.account_type AS bank_account_type,
            s.label AS status_label, s.color AS status_color, cr.name AS created_by_name, cr.login_id AS created_by_login
       FROM payment_advises p JOIN companies c ON c.id=p.company_id JOIN bank_accounts bk ON bk.id=p.bank_account_id JOIN status_config s ON s.code=p.status JOIN users cr ON cr.id=p.created_by WHERE p.id=$1`, [idv]);
  const vendor = await one<any>(`SELECT id,vendor_code,name,party_type,pan,gstin,address,contact_person,email,mobile,bank_name,bank_account_last4,ifsc,account_type,msme_status,tds_section,gst_registration,is_active FROM vendors WHERE id=$1`, [p0.vendor_id]);
  const items = await query<any>('SELECT * FROM payment_items WHERE payment_id=$1 ORDER BY line_no', [idv]);
  const documents = await query<any>(`SELECT d.id,d.group_id,d.version,d.doc_name,d.doc_type,d.original_filename,d.mime_type,d.size_bytes,d.sha256,d.status,d.payment_version_no,d.uploaded_at,u.name AS uploaded_by_name
       FROM payment_documents d JOIN users u ON u.id=d.uploaded_by WHERE d.payment_id=$1 ORDER BY d.group_id, d.version`, [idv]);
  const approvals = await query<any>(`SELECT a.*, u.name AS approver_name, u.login_id AS approver_login FROM payment_approvals a JOIN users u ON u.id=a.approver_id WHERE a.payment_id=$1 ORDER BY a.id`, [idv]);
  const queries = await query<any>(`SELECT q.*, u.name AS raised_by_name, r.name AS resolved_by_name FROM payment_queries q JOIN users u ON u.id=q.raised_by LEFT JOIN users r ON r.id=q.resolved_by WHERE q.payment_id=$1 ORDER BY q.id`, [idv]);
  const resubmissions = await query<any>(`SELECT r.*, u.name AS submitted_by_name FROM payment_resubmissions r JOIN users u ON u.id=r.submitted_by WHERE r.payment_id=$1 ORDER BY r.id`, [idv]);
  const verifications = await query<any>(`SELECT d.*, u.name AS verifier_name FROM document_verifications d JOIN users u ON u.id=d.verifier_id WHERE d.payment_id=$1 ORDER BY d.id`, [idv]);
  const accounting = await one<any>(`SELECT a.*, u.name AS verified_by_name FROM accounting_entries a LEFT JOIN users u ON u.id=a.verified_by WHERE a.payment_id=$1`, [idv]);
  const bank = await query<any>(`SELECT t.*, u.name AS initiated_by_name FROM bank_transactions t JOIN users u ON u.id=t.initiated_by WHERE t.payment_id=$1 ORDER BY t.seq_no`, [idv]);
  const cancellations = await query<any>(`SELECT r.*, u.name AS requested_by_name, d.name AS decided_by_name FROM cancellation_requests r JOIN users u ON u.id=r.requested_by LEFT JOIN users d ON d.id=r.decided_by WHERE r.payment_id=$1 ORDER BY r.id`, [idv]);
  const history = await query<any>(`SELECT h.*, u.name AS changed_by_name, sc.label AS to_label FROM payment_status_history h LEFT JOIN users u ON u.id=h.changed_by JOIN status_config sc ON sc.code=h.to_status WHERE h.payment_id=$1 ORDER BY h.id`, [idv]);
  const versions = await query<any>(`SELECT v.version_no, v.reason, v.created_at, u.name AS created_by_name FROM payment_versions v JOIN users u ON u.id=v.created_by WHERE v.payment_id=$1 ORDER BY v.version_no`, [idv]);
  const control = ['C_VERIFIED', 'ACCOUNTING_VERIFIED', 'D_REJECTED', 'PAYMENT_FAILED', 'PENDING_D_APPROVAL', 'D_APPROVED', 'PAYMENT_COMPLETED'].includes(p0.status) ? await controlChecklist(pool, p0) : null;
  const mode = await one<any>('SELECT * FROM payment_modes WHERE code=$1', [p0.payment_mode]);
  const { actions, blocked } = await computeActions(user, p0, { mode, accounting });
  const pay: any = { ...p0 }; delete pay.beneficiary_account_enc;
  pay.beneficiary_account_masked = maskAccount(p0.beneficiary_account_last4);
  return {
    payment: { ...pay, ...head, status_label: head.status_label, stage_owner: (await one<any>(`SELECT ${stageOwnerSql} AS o FROM payment_advises p WHERE p.id=$1`, [idv]))!.o },
    vendor: vendor && { ...vendor, bank_account_masked: maskAccount(vendor.bank_account_last4) },
    items, documents, approvals, queries, resubmissions, verifications, accounting, bank_transactions: bank, cancellations, history, versions, control, mode,
    approval_progress: approvalProgress(p0, approvals),
    actions, blocked,
    can_reveal_account: user.canViewFullAccount,
  };
}

export function approvalProgress(p: PaymentRow, approvals: any[]) {
  const plan = p.approval_plan ?? { b_levels: [], d_count: 1 };
  const b = (plan.b_levels ?? []).map((l: any, i: number) => ({ level: i + 1, label: l.label, senior: !!l.senior, required: l.count,
    done: approvals.filter((a) => a.stage === 'B' && a.round_no === p.approval_round && a.level_no === i + 1 && a.decision === 'APPROVED').map((a) => ({ name: a.approver_name, at: a.decided_at })) }));
  const d = { required: plan.d_count ?? 1, done: approvals.filter((a) => a.stage === 'D' && a.round_no === p.bank_round && a.decision === 'APPROVED').map((a) => ({ name: a.approver_name, at: a.decided_at })) };
  return { matrix: plan.matrix_name ?? null, b, d };
}

// ---------------------------------------------------------------- allowed actions (UI + server share the same rules)
export async function computeActions(user: SessionUser, p: PaymentRow, extra: { mode?: any; accounting?: any } = {}) {
  const perms = new Set(await userPermissions(user));
  const A: Record<string, boolean> = {}; const B: Record<string, string> = {};
  const set = (k: string, ok: boolean, why?: string) => { A[k] = ok; if (!ok && why) B[k] = why; };
  const isCreator = p.created_by === user.id;
  const s = p.status;
  const withA = A_EDITABLE.includes(s) && (s !== 'D_REJECTED' || p.return_to_stage === 'A');
  const sod = async (stage: 'B' | 'C' | 'D') => checkSod(pool, p.id, user, stage, true);

  set('edit', perms.has('payment.create') && isCreator && withA, !isCreator ? 'Only the maker who created this advice can edit it.' : undefined);
  set('upload_docs', perms.has('payment.create') && isCreator && withA, undefined);
  set('submit', perms.has('payment.create') && isCreator && (s === 'DRAFT' || s === 'B_REJECTED'));
  set('resubmit_to_c', perms.has('payment.create') && isCreator && (s === 'C_QUERY' || (s === 'D_REJECTED' && p.return_to_stage === 'A')));
  set('amendment', perms.has('payment.create') && isCreator && ['PENDING_C_VERIFICATION', 'A_RESUBMITTED', 'C_QUERY', 'C_VERIFIED', 'ACCOUNTING_VERIFIED', 'D_REJECTED'].includes(s));
  set('delete_doc', perms.has('payment.create') && isCreator && withA);

  let m: string | null = null;
  if (s === 'PENDING_B_APPROVAL' && perms.has('payment.approve_b')) {
    m = await sod('B');
    if (!m && p.pending_b_senior && !user.isSeniorApprover) m = 'This approval level requires a Senior Approver.';
    if (!m) { const done = await one('SELECT 1 x FROM payment_approvals WHERE payment_id=$1 AND stage=$2 AND round_no=$3 AND approver_id=$4 AND decision=$5', [p.id, 'B', p.approval_round, user.id, 'APPROVED']); if (done) m = 'You have already approved this payment; another approver is required.'; }
    if (!m && !(hasRole(user, 'B') && user.companyIds.includes(p.company_id))) m = 'You do not have access to this company.';
  }
  set('b_decide', s === 'PENDING_B_APPROVAL' && perms.has('payment.approve_b') && !m, m ?? undefined);

  const cStage = ['PENDING_C_VERIFICATION', 'A_RESUBMITTED', 'C_VERIFIED', 'ACCOUNTING_VERIFIED'].includes(s) || (s === 'D_REJECTED' && p.return_to_stage === 'C') || s === 'PAYMENT_FAILED';
  let cm: string | null = null;
  if (cStage && perms.has('payment.verify_c')) cm = await sod('C');
  set('c_verify_docs', ['PENDING_C_VERIFICATION', 'A_RESUBMITTED'].includes(s) && perms.has('payment.verify_c') && !cm, cm ?? undefined);
  set('c_raise_query', cStage && perms.has('payment.verify_c') && !cm, cm ?? undefined);
  const accStage = ['C_VERIFIED', 'ACCOUNTING_VERIFIED'].includes(s) || (s === 'D_REJECTED' && p.return_to_stage === 'C') || s === 'PAYMENT_FAILED';
  set('accounting_edit', accStage && perms.has('payment.verify_c') && !cm, cm ?? undefined);
  set('accounting_verify', accStage && perms.has('payment.verify_c') && !cm, cm ?? undefined);
  const initStage = s === 'ACCOUNTING_VERIFIED' || ((s === 'D_REJECTED' && p.return_to_stage === 'C') || s === 'PAYMENT_FAILED');
  set('initiate_bank', initStage && perms.has('payment.initiate_bank') && !cm, cm ?? undefined);

  let dm: string | null = null;
  if (s === 'PENDING_D_APPROVAL' && perms.has('payment.approve_d')) {
    dm = await sod('D');
    if (!dm) { const done = await one('SELECT 1 x FROM payment_approvals WHERE payment_id=$1 AND stage=$2 AND round_no=$3 AND approver_id=$4', [p.id, 'D', p.bank_round, user.id]); if (done) dm = 'You have already recorded a decision on this payment.'; }
    if (!dm && !(hasRole(user, 'D') && user.companyIds.includes(p.company_id))) dm = 'You do not have access to this company.';
    if (!dm && user.bankAccountIds && !user.bankAccountIds.includes(p.bank_account_id)) dm = 'You do not have access to this bank account.';
  }
  set('d_decide', s === 'PENDING_D_APPROVAL' && perms.has('payment.approve_d') && !dm, dm ?? undefined);
  set('bank_update', ['D_APPROVED', 'PAYMENT_COMPLETED', 'PAYMENT_FAILED'].includes(s) && perms.has('payment.bank_update') && (await sod('C')) === null, undefined);

  const holdable = !['DRAFT', 'CANCELLED', 'ON_HOLD', 'PAYMENT_COMPLETED', 'PAYMENT_REVERSED'].includes(s);
  set('hold', holdable && perms.has('payment.hold'));
  set('release', s === 'ON_HOLD' && perms.has('payment.hold'));
  const cancellable = !['CANCELLED', 'PAYMENT_COMPLETED', 'PAYMENT_REVERSED'].includes(s);
  const pendingReq = await one('SELECT id FROM cancellation_requests WHERE payment_id=$1 AND status=$2', [p.id, 'PENDING']);
  set('cancel', cancellable && !pendingReq && perms.has('payment.cancel_request') && (isCreator || !['DRAFT'].includes(s)), pendingReq ? 'A cancellation request is already pending.' : undefined);
  set('cancel_decide', !!pendingReq && perms.has('payment.cancel_approve'), undefined);
  void extra;
  return { actions: A, blocked: B };
}

export type { PoolClient };
export { conflict };
