import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { query, one } from '../db.js';
import { h, requirePerm, work, mkCtx } from '../middleware/auth.js';
import { tx } from '../db.js';
import { badRequest, forbidden, notFound } from '../lib/errors.js';
import { parse } from '../lib/validate.js';
import * as P from '../services/payments.js';
import * as W from '../services/workflow.js';
import { storeDocument, readDocument } from '../services/documents.js';
import { getSetting } from '../services/settings.js';
import { audit } from '../services/audit.js';
import { userPermissions, hasRole } from '../services/access.js';
import { exportPaymentsXlsx } from '../services/exports.js';
import { paymentAdvicePdf } from '../services/pdf.js';
import { processingQueue } from '../services/dashboard.js';
import { listBankAccounts, revealAccount } from '../services/masters.js';
import { PAYMENT_TYPES, PRIORITIES, DOC_TYPES, C_DOC_CHECKLIST, D_CHECKLIST, A_EDITABLE } from '../constants.js';
import { fmtDateTime } from '../lib/format.js';

export const paymentsRouter = Router();
const num = (v: any) => { const n = Number(v); if (!Number.isInteger(n) || n <= 0) throw badRequest('Invalid identifier.'); return n; };

paymentsRouter.get('/meta', h(async (req, res) => {
  const u = req.user!;
  const [companies, vendors, modes, depts, ledgers, costCentres, projects, gstTreatments, tdsSections, statuses, users, docs] = await Promise.all([
    query(`SELECT id,name,short_name FROM companies WHERE is_active AND ($1::bigint[]='{}' OR id=ANY($1)) ORDER BY name`, [hasRole(u, 'ADMIN', 'AUDITOR') && !u.companyIds.length ? [] : u.companyIds.length ? u.companyIds : [-1]]),
    query(`SELECT id,vendor_code,name,party_type,tds_section,gst_registration,bank_name,bank_account_last4,ifsc,msme_status,(bank_authorised_at IS NOT NULL) AS bank_authorised FROM vendors WHERE is_active ORDER BY name`),
    query('SELECT code,name,min_amount,max_amount,required_fields,requires_beneficiary_bank FROM payment_modes WHERE is_active ORDER BY sort_order'),
    query(`SELECT code,name FROM master_data WHERE category='DEPARTMENT' AND is_active ORDER BY sort_order,name`),
    query(`SELECT code,name FROM master_data WHERE category='LEDGER' AND is_active ORDER BY sort_order,name`),
    query(`SELECT code,name FROM master_data WHERE category='COST_CENTRE' AND is_active ORDER BY sort_order,name`),
    query(`SELECT code,name FROM master_data WHERE category='PROJECT' AND is_active ORDER BY sort_order,name`),
    query(`SELECT code,name FROM master_data WHERE category='GST_TREATMENT' AND is_active ORDER BY sort_order,name`),
    query(`SELECT code,name FROM master_data WHERE category='TDS_SECTION' AND is_active ORDER BY sort_order,name`),
    query('SELECT code,label,color,sort_order FROM status_config ORDER BY sort_order'),
    query(`SELECT id,name,role_code FROM users WHERE is_active ORDER BY name`),
    getSetting<any>('documents'),
  ]);
  res.json({ companies, banks: await listBankAccounts(u, { forPayment: true }), vendors, modes, departments: depts, ledgers, costCentres, projects, gstTreatments, tdsSections, statuses, users,
    paymentTypes: PAYMENT_TYPES, priorities: PRIORITIES, docTypes: DOC_TYPES, docSettings: docs, cChecklist: C_DOC_CHECKLIST, dChecklist: D_CHECKLIST });
}));

paymentsRouter.get('/', h(async (req, res) => res.json(await P.listPayments(req.user!, req.query as any))));

paymentsRouter.get('/export.xlsx', requirePerm('payment.export'), h(async (req, res) => {
  const buf = await exportPaymentsXlsx(req.user!, req.query as any);
  await tx(async (db) => audit(mkCtx(req, db), { action: 'PAYMENTS_EXPORTED', entityType: 'export', remarks: `${req.user!.name} exported payment data to Excel.`, new: { filters: req.query } }));
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="payments-${new Date().toISOString().slice(0, 10)}.xlsx"`);
  res.send(buf);
}));
paymentsRouter.get('/queue', requirePerm('payment.verify_c'), h(async (req, res) => res.json(await processingQueue(req.user!, req.query as any))));

paymentsRouter.post('/duplicate-check', h(async (req, res) => {
  const b = parse(z.object({ company_id: z.coerce.number(), vendor_id: z.coerce.number(), invoice_number: z.string(), invoice_date: z.string(), gross_amount: z.coerce.number(), exclude_id: z.coerce.number().optional() }), req.body);
  res.json({ duplicates: await P.findDuplicates((await import('../db.js')).pool, b, b.exclude_id), can_override: req.user!.canOverrideDuplicate });
}));

paymentsRouter.post('/', requirePerm('payment.create'), h(async (req, res) => {
  const p = await work(req, (ctx, u) => P.createPayment(ctx, u, req.body));
  res.status(201).json({ id: p.id, pa_number: p.pa_number });
}));
paymentsRouter.get('/:id', h(async (req, res) => res.json(await P.getPaymentDetail(req.user!, num(req.params.id)))));
paymentsRouter.put('/:id', requirePerm('payment.create'), h(async (req, res) => {
  const p = await work(req, (ctx, u) => P.updatePayment(ctx, u, num(req.params.id), req.body)); res.json({ id: p.id });
}));

const act = (fn: (ctx: any, u: any, id: number, body: any) => Promise<any>) => h(async (req, res) => {
  const p = await work(req, (ctx, u) => fn(ctx, u, num(req.params.id), req.body ?? {}));
  res.json({ ok: true, status: p?.status });
});
paymentsRouter.post('/:id/submit', act(W.submitPayment));
paymentsRouter.post('/:id/resubmit', act(W.resubmitToC));
paymentsRouter.post('/:id/amendment', act(W.amendPayment));
paymentsRouter.post('/:id/b-decision', act(W.bDecision));
paymentsRouter.post('/:id/c-review', act(W.cReview));
paymentsRouter.put('/:id/accounting', h(async (req, res) => { await work(req, (ctx, u) => W.saveAccounting(ctx, u, num(req.params.id), req.body)); res.json({ ok: true }); }));
paymentsRouter.post('/:id/accounting/verify', act(W.verifyAccounting));
paymentsRouter.post('/:id/bank-initiation', act(W.initiateBank));
paymentsRouter.post('/:id/d-decision', act(W.dDecision));
paymentsRouter.post('/:id/bank-status', act(W.updateBankStatus));
paymentsRouter.post('/:id/hold', act((ctx, u, id, b) => W.holdPayment(ctx, u, id, b.reason)));
paymentsRouter.post('/:id/release', act((ctx, u, id, b) => W.releaseHold(ctx, u, id, b.remarks)));
paymentsRouter.post('/:id/cancel', h(async (req, res) => { const r = await work(req, (ctx, u) => W.cancelPayment(ctx, u, num(req.params.id), req.body?.reason)); res.json({ ok: true, cancelled: r.cancelled, request_id: (r as any).request_id }); }));
paymentsRouter.post('/:id/cancellations/:rid/decision', h(async (req, res) => {
  await work(req, (ctx, u) => W.decideCancellation(ctx, u, num(req.params.id), num(req.params.rid), { approve: !!req.body?.approve, remarks: req.body?.remarks })); res.json({ ok: true });
}));

paymentsRouter.get('/:id/control-checklist', h(async (req, res) => { const p = await P.loadScoped(req.user!, num(req.params.id)); res.json(await P.controlChecklist((await import('../db.js')).pool, p)); }));

paymentsRouter.get('/:id/audit', h(async (req, res) => {
  const p = await P.loadScoped(req.user!, num(req.params.id));
  res.json(await query(`SELECT id,at,user_name,user_login,role_code,action,entity_type,ip,user_agent,old_value,new_value,remarks FROM audit_logs WHERE payment_id=$1 ORDER BY id`, [p.id]));
}));
paymentsRouter.get('/:id/versions/:n', h(async (req, res) => {
  const p = await P.loadScoped(req.user!, num(req.params.id));
  const v = await one('SELECT version_no,reason,snapshot,created_at FROM payment_versions WHERE payment_id=$1 AND version_no=$2', [p.id, num(req.params.n)]);
  if (!v) throw notFound(); res.json(v);
}));
paymentsRouter.post('/:id/reveal-account', h(async (req, res) => {
  const p = await P.loadScoped(req.user!, num(req.params.id));
  res.json(await work(req, (ctx, u) => revealAccount(ctx, u, 'payment', p.id)));
}));

paymentsRouter.get('/:id/pdf', h(async (req, res) => {
  const out = await tx((db) => paymentAdvicePdf(mkCtx(req, db), req.user!, num(req.params.id)));
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `${req.query.download ? 'attachment' : 'inline'}; filename="${out.filename}"`);
  res.send(out.buffer);
}));

// ---------------------------------------------------------------- documents
paymentsRouter.post('/:id/documents', h(async (req, res, next) => {
  const cfg = await getSetting<any>('documents');
  multer({ storage: multer.memoryStorage(), limits: { fileSize: cfg.max_file_mb * 1024 * 1024, files: 1 } }).single('file')(req, res, (err: any) => {
    if (err?.code === 'LIMIT_FILE_SIZE') return next(badRequest(`File is larger than the ${cfg.max_file_mb} MB limit.`));
    if (err) return next(badRequest(err.message)); next();
  });
}), h(async (req, res) => {
  const file = req.file; if (!file) throw badRequest('Please choose a file to upload.');
  const id = num(req.params.id);
  const doc = await work(req, async (ctx, u) => {
    const p = await P.lockPayment(ctx.db, id);
    const perms = await userPermissions(u);
    const withA = A_EDITABLE.includes(p.status) && (p.status !== 'D_REJECTED' || p.return_to_stage === 'A');
    const mayA = perms.includes('payment.create') && p.created_by === u.id && withA;
    const mayC = perms.includes('payment.verify_c') && ['PENDING_C_VERIFICATION', 'A_RESUBMITTED', 'C_VERIFIED', 'ACCOUNTING_VERIFIED', 'PENDING_D_APPROVAL', 'D_APPROVED', 'PAYMENT_COMPLETED', 'PAYMENT_FAILED', 'D_REJECTED'].includes(p.status) && u.companyIds.includes(p.company_id);
    if (!mayA && !mayC) throw forbidden(p.created_by === u.id ? 'Documents can be added only while the Payment Advice is with you (draft, returned or query stage).' : 'You cannot upload documents to this Payment Advice.');
    const docType = String(req.body?.doc_type ?? 'Other');
    if (!DOC_TYPES.includes(docType) && docType !== 'Bank Confirmation') throw badRequest('Choose a valid document type.');
    return storeDocument(ctx, id, file, { doc_type: docType, doc_name: req.body?.doc_name, replaces_id: req.body?.replaces_id ? Number(req.body.replaces_id) : undefined, payment_version_no: p.version_no });
  });
  res.status(201).json({ id: doc.id });
}));
paymentsRouter.delete('/:id/documents/:docId', h(async (req, res) => {
  await work(req, async (ctx, u) => {
    const p = await P.lockPayment(ctx.db, num(req.params.id));
    if (['D_APPROVED', 'PAYMENT_COMPLETED', 'PAYMENT_REVERSED'].includes(p.status)) throw forbidden('Documents cannot be deleted after final payment approval.');
    const withA = A_EDITABLE.includes(p.status) && (p.status !== 'D_REJECTED' || p.return_to_stage === 'A');
    if (p.created_by !== u.id || !withA) throw forbidden('Documents can be removed only by the maker while the Payment Advice is with them.');
    const d = await one<any>('SELECT * FROM payment_documents WHERE id=$1 AND payment_id=$2', [num(req.params.docId), p.id]);
    if (!d || d.status === 'REMOVED') throw notFound('Document not found.');
    await ctx.db.query(`UPDATE payment_documents SET status='REMOVED' WHERE id=$1`, [d.id]);
    await audit(ctx, { action: 'DOCUMENT_REMOVED', entityType: 'document', entityId: d.id, paymentId: p.id, old: { name: d.doc_name, version: d.version }, remarks: `${u.name} removed document ${d.doc_name} before final approval.` });
  });
  res.json({ ok: true });
}));

export const documentsRouter = Router();
documentsRouter.get('/:docId/download', h(async (req, res) => {
  const d = await one<any>('SELECT * FROM payment_documents WHERE id=$1', [num(req.params.docId)]);
  if (!d) throw notFound('Document not found.');
  await P.loadScoped(req.user!, d.payment_id);
  const buf = await readDocument(d);
  await tx((db) => audit(mkCtx(req, db), { action: 'DOCUMENT_VIEWED', entityType: 'document', entityId: d.id, paymentId: d.payment_id, remarks: `${req.user!.name} opened ${d.doc_name} (v${d.version}) at ${fmtDateTime(new Date())}` }));
  res.setHeader('Content-Type', d.mime_type);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox");
  const inline = /pdf|image\//.test(d.mime_type) && !req.query.download;
  res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(d.original_filename)}`);
  res.send(buf);
}));
