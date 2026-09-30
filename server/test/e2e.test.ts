/**
 * End-to-end test of the Payment Approval & Banking Workflow.
 * Boots the real Express app against a freshly reset + seeded PostgreSQL test database and drives it over HTTP.
 * Run:  npm test      (uses DATABASE_URL=…/pawf_test)
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { Client, listen } from './helpers.js';

process.env.DATABASE_URL ??= 'postgres://pawf:pawf_dev_pw@localhost:5432/pawf_test';
process.env.NODE_ENV = 'test';

let base = ''; let server: any; let db: any;
let A: Client, A2: Client, B: Client, B2: Client, C: Client, C2: Client, D: Client, D2: Client, ADMIN: Client, AUD: Client;
let meta: any; let BOL: number, KOTAK: number, ABC: number, XYZ: number;
const log: string[] = [];
const step = (s: string) => { log.push(s); };
let seq = 1;
const invNo = (p = 'E2E') => `${p}-${Date.now().toString(36)}-${seq++}`;

const payBody = (over: any = {}) => ({ company_id: BOL, bank_account_id: KOTAK, vendor_id: ABC, payment_type: 'VENDOR', payment_mode: 'NEFT', priority: 'NORMAL', department: 'PROCUREMENT',
  invoice_number: invNo(), invoice_date: '2026-09-20', po_number: 'PO-1', grn_reference: 'GRN-1', gross_amount: 525000, gst_amount: 56250, tds_amount: 0, other_deduction: 0, advance_adjustment: 0,
  due_date: '2026-10-10', purpose: 'E2E test payment', remarks: 'automated test', ...over });
const ALL_C = { original_invoice: true, original_supporting: true, purchase_order: true, goods_receipt: true, gst_details: true, tds_checked: true, vendor_bank: true, accounting_entry: true, other_docs: true };
const ALL_D = { payment_advice: true, b_approval: true, supporting_documents: true, accounting_treatment: true, beneficiary_details: true, payment_amount: true, bank_account: true, payment_mode: true, c_verification: true, bank_portal_details: true };
const acct = (over: any = {}) => ({ ledger_account: '5002', cost_centre: 'CC-PLANT', department: 'PROCUREMENT', project: 'NA', gst_treatment: 'REG_ITC', tds_section: 'NONE', voucher_no: `PV-${seq}`, accounting_date: '2026-09-29', erp_reference: `ERP-${seq}`, vendor_ledger_checked: true, debit_credit_note_checked: true, ...over });

async function newPayment(client = A, over: any = {}, docs = true) {
  const r = await client.post('/api/payments', payBody(over));
  assert.equal(r.status, 201, JSON.stringify(r.json));
  if (docs) assert.equal((await client.upload(r.json.id)).status, 201);
  return r.json as { id: number; pa_number: string };
}
const detail = async (c: Client, id: number) => (await c.get(`/api/payments/${id}`)).json;
const status = async (c: Client, id: number) => (await detail(c, id)).payment.status;

before(async () => {
  const { pool } = await import('../src/db.js');
  db = pool;
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  const { seedDemo } = await import('../src/scripts/seed.js');
  await seedDemo(() => {});
  const { createApp } = await import('../src/index.js');
  ({ server, base } = await listen(createApp()));
  const mk = async (u: string) => { const c = new Client(base, u); const me: any = await c.login(u); assert.ok(me.user, `login ${u}`); return c; };
  [A, A2, B, B2, C, C2, D, D2, ADMIN, AUD] = await Promise.all(['a.anil', 'a.priya', 'b.rajesh', 'b.meera', 'c.sunil', 'c.kavita', 'd.vikram', 'd.sneha', 'admin', 'auditor'].map(mk));
  meta = (await A.get('/api/payments/meta')).json;
  BOL = meta.companies.find((c: any) => c.short_name === 'BOL').id;
  KOTAK = meta.banks.find((b: any) => b.company_short === 'BOL' && b.bank_name.startsWith('Kotak')).id;
  ABC = meta.vendors.find((v: any) => v.name === 'ABC Suppliers').id;
  XYZ = meta.vendors.find((v: any) => v.name === 'XYZ Ltd').id;
});
after(async () => { server?.close(); await db?.end(); console.log('\n──── workflow narrative ────\n' + log.join('\n')); });

describe('1 · authentication & security', () => {
  test('unauthenticated API access is rejected', async () => {
    const c = new Client(base); const r = await c.get('/api/payments'); assert.equal(r.status, 401);
  });
  test('wrong password gives a generic message, correct login sets an httpOnly cookie', async () => {
    const c = new Client(base); const r = await c.raw('POST', '/api/auth/login', { userId: 'a.anil', password: 'nope' });
    assert.equal(r.status, 401); assert.match((await r.json() as any).error, /Invalid User ID or password/);
    const ok = await c.raw('POST', '/api/auth/login', { userId: 'a.anil', password: 'Demo@12345' });
    const sc = ok.headers.get('set-cookie')!; assert.match(sc, /HttpOnly/i); assert.match(sc, /SameSite=Strict/i);
  });
  test('CSRF: state-changing calls without the token are refused', async () => {
    const c = new Client(base); await c.login('a.anil'); c.csrf = 'wrong';
    const r = await c.post('/api/payments', payBody()); assert.equal(r.status, 403); assert.equal(r.json.code, 'CSRF');
  });
  test('password policy is enforced when creating users', async () => {
    const r = await ADMIN.post('/api/admin/users', { login_id: 'weak.user', password: 'abc', name: 'Weak', email: 'w@example.com', role_code: 'A' });
    assert.equal(r.status, 400); assert.match(r.json.error, /at least 10 characters/);
  });
  test('login-attempt protection locks the account and an admin can unlock it', async () => {
    const cr = await ADMIN.post('/api/admin/users', { login_id: 'lock.test', password: 'Str0ng!Passw0rd', name: 'Lock Test', email: 'lock@example.com', role_code: 'A', must_change_password: false });
    assert.equal(cr.status, 201, JSON.stringify(cr.json));
    const c = new Client(base);
    let last: any; for (let i = 0; i < 5; i++) last = await c.post('/api/auth/login', { userId: 'lock.test', password: 'wrong' });
    assert.equal(last.status, 423);
    const still = await c.post('/api/auth/login', { userId: 'lock.test', password: 'Str0ng!Passw0rd' }); assert.equal(still.status, 423);
    assert.equal((await ADMIN.post(`/api/admin/users/${cr.json.id}/unlock`)).status, 200);
    const ok = await c.post('/api/auth/login', { userId: 'lock.test', password: 'Str0ng!Passw0rd' }); assert.equal(ok.status, 200);
  });
  test('optional TOTP two-factor authentication', async () => {
    const { totpNow } = await import('../src/lib/totp.js');
    const c = new Client(base); await c.login('a.priya');
    const setup = (await c.post('/api/auth/2fa/setup')).json; assert.ok(setup.secret && setup.qr.startsWith('data:image/png'));
    assert.equal((await c.post('/api/auth/2fa/enable', { code: '000000' })).status, 400);
    assert.equal((await c.post('/api/auth/2fa/enable', { code: totpNow(setup.secret) })).status, 200);
    const c2 = new Client(base);
    assert.equal((await c2.post('/api/auth/login', { userId: 'a.priya', password: 'Demo@12345' })).json.requiresOtp, true);
    assert.equal((await c2.post('/api/auth/login', { userId: 'a.priya', password: 'Demo@12345', otp: '123456' })).status, 401);
    assert.equal((await c2.post('/api/auth/login', { userId: 'a.priya', password: 'Demo@12345', otp: totpNow(setup.secret) })).status, 200);
    assert.equal((await c.post('/api/auth/2fa/disable', { password: 'Demo@12345' })).status, 200);
  });
  test('the recovery mobile is only visible to administrators', async () => {
    assert.equal((await A.get('/api/admin/recovery')).status, 403);
    const r = await ADMIN.get('/api/admin/recovery'); assert.equal(r.json.mobile, '9460201308');
    const pub = await new Client(base).get('/api/auth/public-config'); assert.ok(!JSON.stringify(pub.json).includes('9460201308'));
    assert.ok(!JSON.stringify((await A.get('/api/auth/me')).json).includes('9460201308'));
  });
});

describe('2 · complete payment workflow  A → B → C → query → A → C → bank → D → WhatsApp', () => {
  let pa: { id: number; pa_number: string };
  test('A creates and submits a ₹5,25,000 Payment Advice (unique number PA-YYYY-000000)', async () => {
    pa = await newPayment(A); assert.match(pa.pa_number, /^PA-2026-\d{6}$/);
    const d = await detail(A, pa.id); assert.equal(d.payment.status, 'DRAFT'); assert.equal(d.payment.net_payable, 525000);
    const r = await A.post(`/api/payments/${pa.id}/submit`); assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(await status(A, pa.id), 'PENDING_B_APPROVAL');
    const dd = await detail(A, pa.id);
    assert.equal(dd.approval_progress.b[0].senior, true, '₹5,25,000 falls in the "Senior Approver + D" band of the configurable matrix');
    step(`A (Anil Verma) created & submitted ${pa.pa_number} – ₹5,25,000 (matrix: ${dd.approval_progress.matrix})`);
  });
  test('A cannot edit or self-approve after submission', async () => {
    assert.equal((await A.put(`/api/payments/${pa.id}`, payBody())).status, 403);
    const r = await A.post(`/api/payments/${pa.id}/b-decision`, { decision: 'APPROVE' }); assert.equal(r.status, 403);
  });
  test('ordinary B cannot give a senior-level approval; Senior Approver can', async () => {
    const d = await detail(B, pa.id); assert.equal(d.actions.b_decide, false); assert.match(d.blocked.b_decide, /Senior Approver/);
    assert.equal((await B.post(`/api/payments/${pa.id}/b-decision`, { decision: 'APPROVE' })).status, 403);
    const r = await B2.post(`/api/payments/${pa.id}/b-decision`, { decision: 'APPROVE', remarks: 'Rates verified against PO.' }); assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(await status(C, pa.id), 'PENDING_C_VERIFICATION');
    step('B (Meera Iyer, Senior Approver) approved → status PENDING C VERIFICATION');
  });
  test('C raises a document discrepancy → A receives the query', async () => {
    const bad = await C.post(`/api/payments/${pa.id}/c-review`, { result: 'VERIFIED', checklist: { ...ALL_C, original_invoice: false } });
    assert.equal(bad.status, 400); assert.match(bad.json.error, /Original document verification is pending/);
    const noReason = await C.post(`/api/payments/${pa.id}/c-review`, { result: 'DISCREPANCY', remarks: '' }); assert.equal(noReason.status, 400);
    const r = await C.post(`/api/payments/${pa.id}/c-review`, { result: 'DISCREPANCY', checklist: {}, remarks: 'Invoice copy illegible; GRN missing.', required_document: 'Legible invoice + signed GRN' });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(await status(A, pa.id), 'C_QUERY');
    const d = await detail(A, pa.id); assert.equal(d.queries.at(-1).raised_by_stage, 'C'); assert.equal(d.actions.resubmit_to_c, true);
    const notes = (await A.get('/api/notifications')).json; assert.ok(notes.rows.some((n: any) => n.event_code === 'C_QUERY_RAISED' && n.payment_id === pa.id), 'A receives an in-app notification');
    step('C (Sunil Patil) raised query → status C QUERY RAISED; A notified');
  });
  test('A must upload the required document, then resubmits the SAME advice (version history kept)', async () => {
    const early = await A.post(`/api/payments/${pa.id}/resubmit`, { remarks: 'fixed' }); assert.equal(early.status, 400); assert.match(early.json.error, /upload the required document/);
    const orig = (await detail(A, pa.id)).documents.find((x: any) => x.status === 'ACTIVE' && x.doc_type === 'Invoice');
    assert.equal((await A.upload(pa.id, 'invoice_v2.pdf', { replaces_id: orig.id })).status, 201);
    assert.equal((await A.upload(pa.id, 'grn.pdf', { docType: 'Goods/Service Receipt' })).status, 201);
    const r = await A.post(`/api/payments/${pa.id}/resubmit`, { remarks: 'Uploaded legible invoice v2 and signed GRN.' }); assert.equal(r.status, 200, JSON.stringify(r.json));
    const d = await detail(A, pa.id);
    assert.equal(d.payment.status, 'A_RESUBMITTED'); assert.equal(d.payment.pa_number, pa.pa_number); assert.equal(d.payment.version_no, 2);
    assert.deepEqual(d.documents.filter((x: any) => x.doc_type === 'Invoice').map((x: any) => [x.version, x.status]), [[1, 'SUPERSEDED'], [2, 'ACTIVE']]);
    assert.equal(d.versions.length, 2);
    step('A uploaded corrected invoice (v2) + GRN and resubmitted the SAME advice directly to C (version 2)');
  });
  test('accounting/bank steps are blocked until documents AND accounting are verified', async () => {
    const early = await C.post(`/api/payments/${pa.id}/bank-initiation`, { bank_ref_no: 'X1' }); assert.equal(early.status, 400);
    assert.match(early.json.error, /Payment cannot be initiated until accounting verification is completed|cannot be initiated/);
    const v = await C.post(`/api/payments/${pa.id}/c-review`, { result: 'VERIFIED', checklist: ALL_C, remarks: 'Originals verified.' }); assert.equal(v.status, 200, JSON.stringify(v.json));
    assert.equal(await status(C, pa.id), 'C_VERIFIED');
    const early2 = await C.post(`/api/payments/${pa.id}/bank-initiation`, { bank_ref_no: 'X1' }); assert.equal(early2.status, 400); assert.match(early2.json.error, /accounting verification/);
    const noConfirm = await C.post(`/api/payments/${pa.id}/accounting/verify`, { confirm: true }); assert.equal(noConfirm.status, 400); assert.match(noConfirm.json.error, /required/);
    assert.equal((await C.put(`/api/payments/${pa.id}/accounting`, acct({ tds_section: 'NONE', gst_amount: 1 }))).status, 200);
    const mism = await C.post(`/api/payments/${pa.id}/accounting/verify`, { confirm: true }); assert.equal(mism.status, 400);
    assert.equal((await C.put(`/api/payments/${pa.id}/accounting`, acct({ gst_amount: 56250, tds_amount: 0, basic_amount: 468750, other_deductions: 0, advance_adjustment: 0, net_payable: 525000 }))).status, 200);
    const noTick = await C.post(`/api/payments/${pa.id}/accounting/verify`, { confirm: false }); assert.equal(noTick.status, 400); assert.match(noTick.json.error, /confirm/i);
    const ok = await C.post(`/api/payments/${pa.id}/accounting/verify`, { confirm: true }); assert.equal(ok.status, 200, JSON.stringify(ok.json));
    assert.equal(await status(C, pa.id), 'ACCOUNTING_VERIFIED');
    step('C verified original documents and accounting treatment (ledger, cost centre, GST/TDS, voucher, ERP ref)');
  });
  test('C enters bank initiation details (bank ref mandatory) → PENDING D APPROVAL', async () => {
    const miss = await C.post(`/api/payments/${pa.id}/bank-initiation`, {}); assert.equal(miss.status, 400); assert.match(miss.json.error, /Bank reference number is required/);
    const r = await C.post(`/api/payments/${pa.id}/bank-initiation`, { bank_ref_no: `KKBK-E2E-${seq}`, remarks: 'Initiated on Kotak Biz' }); assert.equal(r.status, 200, JSON.stringify(r.json));
    const d = await detail(C, pa.id); assert.equal(d.payment.status, 'PENDING_D_APPROVAL'); assert.equal(d.bank_transactions[0].bank_status, 'INITIATED');
    assert.equal(d.bank_transactions[0].bank_name, 'Kotak Mahindra Bank');
    step(`C initiated NEFT on the bank portal (ref ${d.bank_transactions[0].bank_ref_no}) → status PENDING D APPROVAL`);
  });
  test('segregation of duties: C cannot approve as D; D sees full history; D must tick every check', async () => {
    assert.equal((await C2.post(`/api/payments/${pa.id}/d-decision`, { decision: 'APPROVE', checklist: ALL_D })).status, 403);
    const d = await detail(D, pa.id);
    for (const k of ['approvals', 'queries', 'verifications', 'accounting', 'bank_transactions', 'documents', 'history', 'resubmissions']) assert.ok(d[k] !== undefined, `D sees ${k}`);
    assert.ok(d.approvals.length >= 1 && d.queries.length >= 1 && d.verifications.length >= 2 && d.resubmissions.length >= 1);
    const partial = await D.post(`/api/payments/${pa.id}/d-decision`, { decision: 'APPROVE', checklist: { ...ALL_D, bank_account: false } }); assert.equal(partial.status, 400); assert.match(partial.json.error, /Bank Account/);
  });
  test('D approves → PAYMENT APPROVED, details recorded, WhatsApp goes to C', async () => {
    const r = await D.post(`/api/payments/${pa.id}/d-decision`, { decision: 'APPROVE', checklist: ALL_D, remarks: 'Complete history reviewed. Approved.' }); assert.equal(r.status, 200, JSON.stringify(r.json));
    const d = await detail(D, pa.id); assert.equal(d.payment.status, 'D_APPROVED'); assert.equal(d.payment.status_label, 'PAYMENT APPROVED');
    const dap = d.approvals.find((a: any) => a.stage === 'D' && a.decision === 'APPROVED'); assert.equal(dap.approver_name, 'Vikram Singh'); assert.ok(dap.decided_at); assert.match(dap.remarks, /Approved/);
    assert.equal(d.bank_transactions[0].bank_status, 'APPROVED');
    const wa = (await ADMIN.get('/api/admin/outbox?channel=WHATSAPP')).json.find((o: any) => o.pa_number === pa.pa_number && o.event_code === 'D_APPROVED');
    assert.ok(wa, 'WhatsApp message queued'); assert.equal(wa.status, 'SENT'); assert.equal(wa.recipient, 'Sunil Patil'); assert.equal(wa.to_address, '9000000006');
    assert.match(wa.body, /^Payment Approved\nPayment Advice No: PA-2026-\d{6}\nCompany: Betul Oil Limited\nVendor: ABC Suppliers\nAmount: ₹5,25,000\nBank: Kotak Mahindra Bank\nApproved By: Vikram Singh\nApproval Date: \d{2}-[A-Z][a-z]{2}-\d{4}\nBank Reference: KKBK-E2E-\d+\nStatus: FINAL PAYMENT APPROVED$/);
    step('D (Vikram Singh) approved → PAYMENT APPROVED. WhatsApp sent to C:\n' + wa.body.split('\n').map((l: string) => '      │ ' + l).join('\n'));
  });
  test('documents are locked after final approval; C completes the payment with UTR (reconciliation)', async () => {
    const d0 = await detail(A, pa.id); const doc = d0.documents.find((x: any) => x.status === 'ACTIVE');
    assert.equal((await A.del(`/api/payments/${pa.id}/documents/${doc.id}`)).status, 403);
    await assert.rejects(db.query(`UPDATE payment_documents SET status='REMOVED' WHERE id=$1`, [doc.id]), /cannot be changed or removed after final payment approval/);
    const noUtr = await C.post(`/api/payments/${pa.id}/bank-status`, { bank_status: 'PROCESSED' }); assert.equal(noUtr.status, 400); assert.match(noUtr.json.error, /UTR/);
    const mismatch = await C.post(`/api/payments/${pa.id}/bank-status`, { bank_status: 'PROCESSED', utr: 'UTR1', actual_debit_date: '2026-09-30', actual_debit_amount: 500000 }); assert.equal(mismatch.status, 400);
    const ok = await C.post(`/api/payments/${pa.id}/bank-status`, { bank_status: 'PROCESSED', utr: `KKBKN${Date.now()}`, bank_txn_id: 'TX1', actual_debit_date: '2026-09-30', actual_debit_amount: 525000 }); assert.equal(ok.status, 200, JSON.stringify(ok.json));
    assert.equal(await status(C, pa.id), 'PAYMENT_COMPLETED');
    const rec = await C.post(`/api/payments/${pa.id}/bank-status`, { bank_status: 'RECONCILED', remarks: 'Matched with statement' }); assert.equal(rec.status, 200);
    step('C recorded UTR / debit date / amount → PAYMENT COMPLETED → RECONCILED');
  });
  test('the immutable audit trail tells the whole story in order', async () => {
    const rows = (await A.get(`/api/payments/${pa.id}/audit`)).json as any[];
    const actions = rows.map((r) => r.action);
    const order = ['PAYMENT_CREATED', 'PAYMENT_SUBMITTED', 'B_APPROVED', 'C_QUERY_RAISED', 'A_RESUBMITTED_TO_C', 'C_VERIFIED_DOCUMENTS', 'ACCOUNTING_VERIFIED', 'C_INITIATED_PAYMENT', 'D_APPROVED_FINAL', 'BANK_STATUS_UPDATED'];
    let i = -1; for (const a of order) { const j = actions.indexOf(a, i + 1); assert.ok(j > i, `${a} appears in order`); i = j; }
    const created = rows.find((r) => r.action === 'PAYMENT_CREATED'); assert.ok(created.ip && created.user_agent && created.user_name === 'Anil Verma' && created.role_code === 'A');
    const hist = (await detail(A, pa.id)).history.map((h: any) => h.to_status);
    for (const s of ['DRAFT', 'SUBMITTED', 'PENDING_B_APPROVAL', 'B_APPROVED', 'PENDING_C_VERIFICATION', 'C_QUERY', 'A_RESUBMITTED', 'C_VERIFIED', 'ACCOUNTING_VERIFIED', 'PAYMENT_INITIATED', 'PENDING_D_APPROVAL', 'D_APPROVED', 'PAYMENT_COMPLETED']) assert.ok(hist.includes(s), `history has ${s}`);
  });
});

describe('3 · immutability & audit integrity', () => {
  test('audit_logs and status history cannot be updated or deleted, even by SQL', async () => {
    await assert.rejects(db.query(`UPDATE audit_logs SET remarks='tampered' WHERE id=1`), /immutable/);
    await assert.rejects(db.query(`DELETE FROM audit_logs WHERE id=1`), /immutable/);
    await assert.rejects(db.query(`TRUNCATE audit_logs`), /immutable/);
    await assert.rejects(db.query(`DELETE FROM payment_status_history`), /immutable/);
    await assert.rejects(db.query(`UPDATE payment_approvals SET decision='REJECTED'`), /immutable/);
    await assert.rejects(db.query(`DELETE FROM payment_advises`), /immutable/);
  });
  test('the audit hash-chain verifies', async () => {
    const r = await AUD.get('/api/admin/audit-verify'); assert.equal(r.status, 200); assert.equal(r.json.ok, true); assert.ok(r.json.checked > 300);
  });
  test('only auditors/admin can read the global audit log; admin console stays admin-only', async () => { assert.equal((await A.get('/api/admin/audit-logs')).status, 403); assert.equal((await AUD.get('/api/admin/audit-logs')).status, 200); assert.equal((await C.get('/api/admin/users')).status, 403); });
});

describe('4 · rejection, return and resubmission of the same advice', () => {
  test('B must give a reason; rejection returns to A; A corrects & resubmits the SAME PA', async () => {
    const pa = await newPayment(A, { gross_amount: 84000, gst_amount: 12813.56 });
    await A.post(`/api/payments/${pa.id}/submit`);
    const none = await B.post(`/api/payments/${pa.id}/b-decision`, { decision: 'REJECT', reason: '' }); assert.equal(none.status, 400); assert.match(none.json.error, /Rejection reason is mandatory/);
    const r = await B.post(`/api/payments/${pa.id}/b-decision`, { decision: 'RETURN', reason: 'Need approved PO', required_document: 'Approved PO' }); assert.equal(r.status, 200);
    assert.equal(await status(A, pa.id), 'B_REJECTED');
    const d = await detail(A, pa.id); assert.equal(d.queries.at(-1).reason, 'Need approved PO'); assert.equal(d.actions.edit, true);
    assert.equal((await A.put(`/api/payments/${pa.id}`, payBody({ ...d.payment, invoice_number: d.payment.invoice_number, gross_amount: 86000, gst_amount: 13118.64, purpose: 'Corrected' }))).status, 200);
    const re = await A.post(`/api/payments/${pa.id}/submit`); assert.equal(re.status, 200, JSON.stringify(re.json));
    const d2 = await detail(A, pa.id); assert.equal(d2.payment.status, 'PENDING_B_APPROVAL'); assert.equal(d2.payment.pa_number, pa.pa_number); assert.equal(d2.payment.version_no, 2);
    assert.equal(d2.queries.at(-1).status, 'RESOLVED');
    step(`B returned ${pa.pa_number} with a reason → A corrected and resubmitted the SAME advice (v2)`);
  });
  test('D can reject and return to C, who re-initiates', async () => {
    const pa = await newPayment(A, { gross_amount: 62000, gst_amount: 9457.63 });
    await A.post(`/api/payments/${pa.id}/submit`); await B.post(`/api/payments/${pa.id}/b-decision`, { decision: 'APPROVE' });
    await C.post(`/api/payments/${pa.id}/c-review`, { result: 'VERIFIED', checklist: ALL_C });
    await C.put(`/api/payments/${pa.id}/accounting`, acct({ gst_amount: 9457.63, basic_amount: 52542.37, net_payable: 62000, tds_amount: 0, other_deductions: 0, advance_adjustment: 0 }));
    await C.post(`/api/payments/${pa.id}/accounting/verify`, { confirm: true });
    assert.equal((await C.post(`/api/payments/${pa.id}/bank-initiation`, { bank_ref_no: `REJ-${seq}` })).status, 200);
    const noReason = await D.post(`/api/payments/${pa.id}/d-decision`, { decision: 'REJECT', return_to: 'C' }); assert.equal(noReason.status, 400); assert.match(noReason.json.error, /Rejection reason is mandatory/);
    const noStage = await D.post(`/api/payments/${pa.id}/d-decision`, { decision: 'REJECT', reason: 'IFSC mismatch' }); assert.equal(noStage.status, 400);
    assert.equal((await D.post(`/api/payments/${pa.id}/d-decision`, { decision: 'REJECT', reason: 'IFSC mismatch on portal', return_to: 'C' })).status, 200);
    assert.equal(await status(C, pa.id), 'D_REJECTED');
    assert.equal((await C.post(`/api/payments/${pa.id}/bank-initiation`, { bank_ref_no: `REJ2-${seq}`, remarks: 're-initiated' })).status, 200);
    const d = await detail(D, pa.id); assert.equal(d.payment.status, 'PENDING_D_APPROVAL'); assert.equal(d.bank_transactions.length, 2); assert.equal(d.bank_transactions.filter((t: any) => t.is_current).length, 1);
    assert.equal((await D2.post(`/api/payments/${pa.id}/d-decision`, { decision: 'APPROVE', checklist: ALL_D })).status, 200);
  });
});

describe('5 · segregation of duties (maker-checker)', () => {
  let ab: Client; let abId: number;
  test('a user holding two roles still cannot approve their own payment', async () => {
    const pw = 'Str0ng!Passw0rd';
    const cr = await ADMIN.post('/api/admin/users', { login_id: 'ab.dual', password: pw, name: 'Dual Role', email: 'dual@example.com', mobile: '9000000044', role_code: 'A', extra_roles: ['B', 'C', 'D'], is_senior_approver: true, must_change_password: false, company_ids: [BOL] });
    assert.equal(cr.status, 201, JSON.stringify(cr.json)); abId = cr.json.id;
    ab = new Client(base, 'ab.dual'); await ab.login('ab.dual', pw);
    const pa = await newPayment(ab, { gross_amount: 40000, gst_amount: 6101.69 });
    assert.equal((await ab.post(`/api/payments/${pa.id}/submit`)).status, 200);
    const self = await ab.post(`/api/payments/${pa.id}/b-decision`, { decision: 'APPROVE' });
    assert.equal(self.status, 403); assert.equal(self.json.error, 'Payment cannot be approved by the same user who created it.');
    assert.equal((await B.post(`/api/payments/${pa.id}/b-decision`, { decision: 'APPROVE' })).status, 200);
    const cSelf = await ab.post(`/api/payments/${pa.id}/c-review`, { result: 'VERIFIED', checklist: ALL_C }); assert.equal(cSelf.status, 403);
    // B (rajesh) with only role B cannot do C's work
    assert.equal((await B.post(`/api/payments/${pa.id}/c-review`, { result: 'VERIFIED', checklist: ALL_C })).status, 403);
  });
  test('B who approved cannot verify as C unless the admin has authorised the exception; C can never approve as D', async () => {
    const pw = 'Str0ng!Passw0rd';
    const cr = await ADMIN.post('/api/admin/users', { login_id: 'bc.dual', password: pw, name: 'B and C', email: 'bc@example.com', mobile: '9000000045', role_code: 'B', extra_roles: ['C', 'D'], must_change_password: false, company_ids: [BOL] });
    const bc = new Client(base); await bc.login('bc.dual', pw);
    const pa = await newPayment(A, { gross_amount: 45000, gst_amount: 6864.41 }); await A.post(`/api/payments/${pa.id}/submit`);
    assert.equal((await bc.post(`/api/payments/${pa.id}/b-decision`, { decision: 'APPROVE' })).status, 200);
    const asC = await bc.post(`/api/payments/${pa.id}/c-review`, { result: 'VERIFIED', checklist: ALL_C }); assert.equal(asC.status, 403); assert.match(asC.json.error, /B cannot perform the C verification.*unless specifically authorised/);
    assert.equal((await ADMIN.put(`/api/admin/users/${cr.json.id}`, { name: 'B and C', email: 'bc@example.com', mobile: '9000000045', role_code: 'B', extra_roles: ['C', 'D'], sod_exception: true, company_ids: [BOL], bank_account_ids: [], is_active: true })).status, 200);
    const bc2 = new Client(base); await bc2.login('bc.dual', pw);
    assert.equal((await bc2.post(`/api/payments/${pa.id}/c-review`, { result: 'VERIFIED', checklist: ALL_C })).status, 200, 'authorised exception allows B→C');
    await bc2.put(`/api/payments/${pa.id}/accounting`, acct({ gst_amount: 6864.41, basic_amount: 38135.59, net_payable: 45000, tds_amount: 0, other_deductions: 0, advance_adjustment: 0 }));
    await bc2.post(`/api/payments/${pa.id}/accounting/verify`, { confirm: true });
    assert.equal((await bc2.post(`/api/payments/${pa.id}/bank-initiation`, { bank_ref_no: `BC-${seq}` })).status, 200);
    const asD = await bc2.post(`/api/payments/${pa.id}/d-decision`, { decision: 'APPROVE', checklist: ALL_D }); assert.equal(asD.status, 403); assert.match(asD.json.error, /Segregation of duties/);
  });
  test('the role/permission matrix blocks cross-role actions', async () => {
    assert.equal((await AUD.post('/api/payments', payBody())).status, 403, 'auditor is view-only');
    assert.equal((await B.post('/api/payments', payBody())).status, 403, 'B cannot create');
    assert.equal((await A.get('/api/admin/users')).status, 403);
    assert.equal((await C.get('/api/admin/settings')).status, 403);
    assert.equal((await D.post(`/api/payments/1/c-review`, { result: 'VERIFIED', checklist: ALL_C })).status, 403);
    assert.equal((await A.get('/api/dashboard/management')).status, 403);
    assert.equal((await AUD.get('/api/dashboard/management')).status, 200);
  });
  test('A only sees own payments; B/C/D see their companies', async () => {
    const a1 = (await A.get('/api/payments?page_size=200')).json; const a2 = (await A2.get('/api/payments?page_size=200')).json;
    assert.ok(a1.total > 0 && a2.total > 0);
    assert.ok(a1.rows.every((r: any) => r.created_by_name === 'Anil Verma')); assert.ok(a2.rows.every((r: any) => r.created_by_name === 'Priya Nair'));
    const other = a2.rows[0].id; assert.equal((await A.get(`/api/payments/${other}`)).status, 404);
  });
});

describe('6 · duplicate payment control', () => {
  test('exact duplicate is blocked with the existing PA number; only an authorised user can override, with justification', async () => {
    const inv = invNo('DUP');
    const first = await newPayment(A, { invoice_number: inv, gross_amount: 33000, gst_amount: 5033.9 });
    assert.equal((await A.post(`/api/payments/${first.id}/submit`)).status, 200);
    const live = (await A.post('/api/payments/duplicate-check', { company_id: BOL, vendor_id: ABC, invoice_number: inv, invoice_date: '2026-09-20', gross_amount: 33000 })).json;
    assert.equal(live.duplicates[0].pa_number, first.pa_number); assert.equal(live.duplicates[0].kind, 'EXACT');
    const dup = await newPayment(A, { invoice_number: inv, gross_amount: 33000, gst_amount: 5033.9 });
    const blocked = await A.post(`/api/payments/${dup.id}/submit`); assert.equal(blocked.status, 409); assert.match(blocked.json.error, /Possible duplicate payment detected/); assert.match(blocked.json.error, new RegExp(first.pa_number));
    assert.equal(blocked.json.details.code, 'DUPLICATE');
    const unauth = await A.post(`/api/payments/${dup.id}/submit`, { override_reason: 'Trust me' }); assert.equal(unauth.status, 403); assert.match(unauth.json.error, /not authorised to override/);
    const dup2 = await newPayment(A2, { invoice_number: inv, gross_amount: 33000, gst_amount: 5033.9 });
    const noJust = await A2.post(`/api/payments/${dup2.id}/submit`); assert.equal(noJust.status, 409);
    const ok = await A2.post(`/api/payments/${dup2.id}/submit`, { override_reason: 'Vendor re-issued the invoice after GST correction' }); assert.equal(ok.status, 200, JSON.stringify(ok.json));
    const rows = (await A2.get(`/api/payments/${dup2.id}/audit`)).json; assert.ok(rows.some((r: any) => r.action === 'DUPLICATE_OVERRIDE'));
    const d = await detail(A2, dup2.id); assert.equal(d.payment.duplicate_override_reason, 'Vendor re-issued the invoice after GST correction');
    step(`Duplicate control: ${dup.pa_number} blocked (existing ${first.pa_number}); override allowed only for authorised Priya with justification`);
  });
  test('same vendor + invoice number but different amount is also flagged', async () => {
    const inv = invNo('DUPN'); const a = await newPayment(A, { invoice_number: inv, gross_amount: 21000, gst_amount: 3203.39 }); await A.post(`/api/payments/${a.id}/submit`);
    const b = await newPayment(A, { invoice_number: inv, gross_amount: 21500, gst_amount: 3279.66 });
    const r = await A.post(`/api/payments/${b.id}/submit`); assert.equal(r.status, 409); assert.match(r.json.error, /Duplicate invoice detected/);
  });
});

describe('7 · approval matrix (configurable), multi-level and multi-D', () => {
  test('matrix bands come from the database, not code', async () => {
    const m = (await ADMIN.get('/api/admin/approval-matrix')).json; assert.equal(m.length, 4);
    const p = (n: number) => ADMIN.post('/api/admin/approval-matrix/preview', { company_id: BOL, bank_account_id: KOTAK, payment_type: 'VENDOR', net_payable: n });
    assert.equal((await p(80000)).json.b_levels[0].senior, false);
    assert.equal((await p(300000)).json.b_levels[0].senior, false);
    assert.equal((await p(525000)).json.b_levels[0].senior, true);
    const big = (await p(3000000)).json; assert.equal(big.b_levels.length, 2); assert.equal(big.d_count, 2);
    // change a rule without touching source code: raise the senior threshold, verify the plan follows
    const rule = m.find((x: any) => x.name.startsWith('₹5,00,001'));
    const upd = await ADMIN.put(`/api/admin/approval-matrix/${rule.id}`, { ...rule, min_amount: 800000.01, b_levels: rule.b_levels });
    assert.equal(upd.status, 200); assert.equal((await p(525000)).json.b_levels[0].senior, false, 'now handled by ordinary B (falls back to the ≤5L band? no: gap band)');
    assert.equal((await ADMIN.put(`/api/admin/approval-matrix/${rule.id}`, { ...rule, min_amount: 500000.01 })).status, 200);
  });
  test('above ₹25 lakh: two B levels in sequence and two independent D approvals', async () => {
    const pa = await newPayment(A, { gross_amount: 3250000, gst_amount: 495762.71, payment_mode: 'RTGS', vendor_id: meta.vendors.find((v: any) => v.name.startsWith('Vardhaman')).id });
    await A.post(`/api/payments/${pa.id}/submit`);
    const d0 = await detail(A, pa.id); assert.equal(d0.approval_progress.b.length, 2); assert.equal(d0.approval_progress.d.required, 2);
    const wrong = await B2.post(`/api/payments/${pa.id}/b-decision`, { decision: 'APPROVE' }); assert.equal(wrong.status, 200, 'first level: any B (senior may also do level 1)');
    assert.equal(await status(A, pa.id), 'PENDING_B_APPROVAL', 'level 2 outstanding');
    const again = await B2.post(`/api/payments/${pa.id}/b-decision`, { decision: 'APPROVE' }); assert.equal(again.status, 403); assert.match(again.json.error, /already approved|Senior/);
    assert.equal((await B.post(`/api/payments/${pa.id}/b-decision`, { decision: 'APPROVE' })).status, 403, 'level 2 needs a Senior Approver');
    const db2 = await ADMIN.post('/api/admin/users', { login_id: 'senior.two', password: 'Str0ng!Passw0rd', name: 'Second Senior', email: 's2@example.com', role_code: 'B', is_senior_approver: true, must_change_password: false, company_ids: [BOL] });
    const s2 = new Client(base); await s2.login('senior.two', 'Str0ng!Passw0rd');
    assert.equal((await s2.post(`/api/payments/${pa.id}/b-decision`, { decision: 'APPROVE' })).status, 200);
    assert.equal(await status(A, pa.id), 'PENDING_C_VERIFICATION'); void db2;
    await C.post(`/api/payments/${pa.id}/c-review`, { result: 'VERIFIED', checklist: ALL_C });
    await C.put(`/api/payments/${pa.id}/accounting`, acct({ gst_amount: 495762.71, basic_amount: 2754237.29, net_payable: 3250000, tds_amount: 0, other_deductions: 0, advance_adjustment: 0 }));
    await C.post(`/api/payments/${pa.id}/accounting/verify`, { confirm: true });
    assert.equal((await C.post(`/api/payments/${pa.id}/bank-initiation`, { bank_ref_no: `BIG-${seq}` })).status, 200);
    assert.equal((await D.post(`/api/payments/${pa.id}/d-decision`, { decision: 'APPROVE', checklist: ALL_D })).status, 200);
    assert.equal(await status(D, pa.id), 'PENDING_D_APPROVAL', 'needs a second D');
    assert.equal((await D.post(`/api/payments/${pa.id}/d-decision`, { decision: 'APPROVE', checklist: ALL_D })).status, 403);
    assert.equal((await D2.post(`/api/payments/${pa.id}/d-decision`, { decision: 'APPROVE', checklist: ALL_D })).status, 200);
    assert.equal(await status(D, pa.id), 'D_APPROVED');
  });
  test('payment mode rules: RTGS minimum and IMPS maximum are enforced from the payment-mode master', async () => {
    const r = await newPayment(A, { payment_mode: 'RTGS', gross_amount: 50000, gst_amount: 0 }); const s = await A.post(`/api/payments/${r.id}/submit`); assert.equal(s.status, 400); assert.match(s.json.error, /RTGS requires a minimum payment of ₹2,00,000/);
    const r2 = await newPayment(A, { payment_mode: 'IMPS', gross_amount: 900000, gst_amount: 0 }); const s2 = await A.post(`/api/payments/${r2.id}/submit`); assert.equal(s2.status, 400); assert.match(s2.json.error, /maximum payment of ₹5,00,000/);
  });
});

describe('8 · amendment control after B approval', () => {
  test('material fields are locked; an amendment request restarts approval and keeps the earlier version', async () => {
    const pa = await newPayment(A, { gross_amount: 120000, gst_amount: 18305.08 }); await A.post(`/api/payments/${pa.id}/submit`); await B.post(`/api/payments/${pa.id}/b-decision`, { decision: 'APPROVE' });
    await C.post(`/api/payments/${pa.id}/c-review`, { result: 'DISCREPANCY', checklist: {}, remarks: 'Amount on invoice is 1,25,000', required_correction: 'Correct the amount' });
    const d = await detail(A, pa.id);
    const edit = await A.put(`/api/payments/${pa.id}`, payBody({ invoice_number: d.payment.invoice_number, gross_amount: 125000, gst_amount: 19067.8 })); assert.equal(edit.status, 403); assert.match(edit.json.error, /Amount.*cannot be changed after B approval.*Amendment/);
    const vend = await A.put(`/api/payments/${pa.id}`, payBody({ invoice_number: d.payment.invoice_number, gross_amount: 120000, gst_amount: 18305.08, vendor_id: XYZ })); assert.equal(vend.status, 403);
    const soft = await A.put(`/api/payments/${pa.id}`, payBody({ invoice_number: d.payment.invoice_number, gross_amount: 120000, gst_amount: 18305.08, remarks: 'note added', purpose: 'clarified purpose' })); assert.equal(soft.status, 200, 'non-material change allowed');
    const noChange = await A.post(`/api/payments/${pa.id}/amendment`, { ...payBody({ invoice_number: d.payment.invoice_number, gross_amount: 120000, gst_amount: 18305.08 }), amendment_reason: 'x' }); assert.equal(noChange.status, 400);
    const am = await A.post(`/api/payments/${pa.id}/amendment`, { ...payBody({ invoice_number: d.payment.invoice_number, gross_amount: 125000, gst_amount: 19067.8 }), amendment_reason: 'Invoice amount corrected by vendor' }); assert.equal(am.status, 200, JSON.stringify(am.json));
    const d2 = await detail(A, pa.id); assert.equal(d2.payment.status, 'PENDING_B_APPROVAL'); assert.equal(d2.payment.is_amendment, true); assert.equal(d2.payment.gross_amount, 125000);
    assert.equal(d2.payment.approval_round, 2); assert.ok(d2.versions.some((v: any) => v.reason === 'AMENDMENT'));
    const v1 = (await A.get(`/api/payments/${pa.id}/versions/1`)).json; assert.equal(v1.snapshot.payment.gross_amount, 120000, 'previous version kept permanently');
    assert.equal((await B.post(`/api/payments/${pa.id}/b-decision`, { decision: 'APPROVE' })).status, 200, 'B must approve again');
    step(`Amendment on ${pa.pa_number}: ₹1,20,000 → ₹1,25,000 restarted B approval; v1 snapshot preserved`);
  });
  test('an amendment is refused once the payment has been initiated at the bank', async () => {
    const list = (await A.get('/api/payments?status=PENDING_D_APPROVAL&page_size=50')).json.rows; assert.ok(list.length);
    const d = await detail(A, list[0].id);
    const r = await A.post(`/api/payments/${list[0].id}/amendment`, { ...payBody({ invoice_number: d.payment.invoice_number, gross_amount: 1 }), amendment_reason: 'late' }); assert.equal(r.status, 400); assert.match(r.json.error, /already been initiated/);
  });
});

describe('9 · cancellation and hold', () => {
  test('creator can cancel before B approval with a reason', async () => {
    const pa = await newPayment(A, { gross_amount: 15000, gst_amount: 2288.14 }); await A.post(`/api/payments/${pa.id}/submit`);
    assert.equal((await A.post(`/api/payments/${pa.id}/cancel`, { reason: '' })).status, 400);
    assert.equal((await A.post(`/api/payments/${pa.id}/cancel`, { reason: 'Raised in error' })).json.cancelled, true);
    const d = await detail(A, pa.id); assert.equal(d.payment.status, 'CANCELLED'); assert.equal(d.payment.cancel_reason, 'Raised in error');
  });
  test('after B approval, cancellation needs a second authorised person; requester cannot self-approve', async () => {
    const pa = await newPayment(A, { gross_amount: 18000, gst_amount: 2745.76 }); await A.post(`/api/payments/${pa.id}/submit`); await B.post(`/api/payments/${pa.id}/b-decision`, { decision: 'APPROVE' });
    const rq = await C.post(`/api/payments/${pa.id}/cancel`, { reason: 'Vendor credit note issued' }); assert.equal(rq.status, 200); assert.equal(rq.json.cancelled, false); assert.ok(rq.json.request_id);
    assert.equal(await status(C, pa.id), 'PENDING_C_VERIFICATION');
    assert.equal((await C.post(`/api/payments/${pa.id}/cancellations/${rq.json.request_id}/decision`, { approve: true })).status, 403);
    assert.equal((await B.post(`/api/payments/${pa.id}/cancellations/${rq.json.request_id}/decision`, { approve: true })).status, 200);
    assert.equal(await status(C, pa.id), 'CANCELLED');
  });
  test('after D approval a separate authorised process applies (D requests, another D approves)', async () => {
    const list = (await D.get('/api/payments?status=D_APPROVED&page_size=50')).json.rows; const target = list.find((r: any) => r.pa_number !== 'PA-2026-000001'); assert.ok(target);
    const byC = await C.post(`/api/payments/${target.id}/cancel`, { reason: 'stop payment' }); assert.equal(byC.status, 403); assert.match(byC.json.error, /separate authorised process/);
    const rq = await D.post(`/api/payments/${target.id}/cancel`, { reason: 'Duplicate settlement found' }); assert.equal(rq.status, 200); assert.equal(rq.json.cancelled, false);
    assert.equal((await B.post(`/api/payments/${target.id}/cancellations/${rq.json.request_id}/decision`, { approve: true })).status, 403, 'B cannot approve a post-final cancellation');
    assert.equal((await D.post(`/api/payments/${target.id}/cancellations/${rq.json.request_id}/decision`, { approve: true })).status, 403, 'requester cannot self-approve');
    assert.equal((await D2.post(`/api/payments/${target.id}/cancellations/${rq.json.request_id}/decision`, { approve: true })).status, 200);
    assert.equal(await status(D, target.id), 'CANCELLED');
  });
  test('hold and release restore the previous status', async () => {
    const pa = await newPayment(A, { gross_amount: 19000, gst_amount: 2898.31 }); await A.post(`/api/payments/${pa.id}/submit`);
    assert.equal((await B.post(`/api/payments/${pa.id}/hold`, { reason: '' })).status, 400);
    assert.equal((await B.post(`/api/payments/${pa.id}/hold`, { reason: 'Vendor dispute' })).status, 200); assert.equal(await status(B, pa.id), 'ON_HOLD');
    assert.equal((await B.post(`/api/payments/${pa.id}/b-decision`, { decision: 'APPROVE' })).status, 400);
    assert.equal((await B.post(`/api/payments/${pa.id}/release`, {})).status, 200); assert.equal(await status(B, pa.id), 'PENDING_B_APPROVAL');
  });
  test('failed payment can be re-initiated and goes back to D', async () => {
    const list = (await C.get('/api/payments?status=PAYMENT_FAILED&page_size=10')).json.rows; assert.ok(list.length);
    const id = list[0].id; const d = await detail(C, id); assert.equal(d.actions.initiate_bank, true);
    assert.equal((await C.post(`/api/payments/${id}/bank-initiation`, { bank_ref_no: `RETRY-${seq}` })).status, 200); assert.equal(await status(C, id), 'PENDING_D_APPROVAL');
  });
});

describe('10 · documents', () => {
  test('type, size and content are validated; versions are kept; only maker can remove while with A', async () => {
    const pa = await newPayment(A, { gross_amount: 11000, gst_amount: 1677.97 }, false);
    const exe = await A.upload(pa.id, 'malware.exe', { content: Buffer.from('MZ....') }); assert.equal(exe.status, 400); assert.match(exe.json.error, /not allowed/);
    const fake = await A.upload(pa.id, 'fake.pdf', { content: Buffer.from('this is not a pdf') }); assert.equal(fake.status, 400); assert.match(fake.json.error, /does not match/);
    const noDoc = await A.post(`/api/payments/${pa.id}/submit`); assert.equal(noDoc.status, 400); assert.match(noDoc.json.error, /upload at least one supporting document/);
    const up = await A.upload(pa.id, 'bill.pdf'); assert.equal(up.status, 201);
    const png = await A.upload(pa.id, 'photo.png', { content: Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(20)]), docType: 'Other' }); assert.equal(png.status, 201);
    const d = await detail(A, pa.id); const doc = d.documents[0];
    const dl = await A.raw('GET', `/api/documents/${doc.id}/download`); assert.equal(dl.status, 200); assert.equal(dl.headers.get('content-type'), 'application/pdf'); assert.equal(dl.headers.get('x-content-type-options'), 'nosniff');
    assert.ok((await dl.text()).startsWith('%PDF'));
    assert.equal((await A2.raw('GET', `/api/documents/${doc.id}/download`)).status, 404, 'no access to other makers documents');
    assert.equal((await A.del(`/api/payments/${pa.id}/documents/${d.documents[1].id}`)).status, 200);
    // stored encrypted at rest
    const { rows } = await db.query('SELECT storage_key FROM payment_documents WHERE id=$1', [doc.id]);
    const fs = await import('node:fs'); const path = await import('node:path'); const { config } = await import('../src/config.js');
    const raw = fs.readFileSync(path.join(config.storageDir, rows[0].storage_key)); assert.ok(!raw.subarray(0, 8).toString().startsWith('%PDF'), 'ciphertext on disk');
  });
  test('configurable maximum file size', async () => {
    await ADMIN.put('/api/admin/settings/documents', { max_file_mb: 1 });
    const pa = await newPayment(A, { gross_amount: 12000, gst_amount: 1830.51 }, false);
    const big = await A.upload(pa.id, 'big.pdf', { content: Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(1.5 * 1024 * 1024)]) }); assert.equal(big.status, 400); assert.match(big.json.error, /larger than the 1 MB limit/);
    await ADMIN.put('/api/admin/settings/documents', { max_file_mb: 10 });
  });
});

describe('11 · masters, masking and vendor bank-change authorisation', () => {
  test('bank account numbers are masked; only flagged users can reveal, and it is audited', async () => {
    const banks = (await A.get('/api/bank-accounts')).json; assert.ok(banks.every((b: any) => /^XXXX XXXX \d{4}$/.test(b.account_masked)));
    const kotak = banks.find((b: any) => b.id === KOTAK); assert.equal(kotak.account_masked, 'XXXX XXXX 4521'); assert.ok(!JSON.stringify(banks).includes('4471209843214521'));
    assert.equal((await A.post(`/api/bank-accounts/${KOTAK}/reveal`)).status, 403);
    const full = await C.post(`/api/bank-accounts/${KOTAK}/reveal`); assert.equal(full.status, 200); assert.equal(full.json.account_number, '4471209843214521');
    const logs = (await ADMIN.get('/api/admin/audit-logs?action=ACCOUNT_NUMBER_REVEALED')).json.rows; assert.ok(logs.length >= 1);
    const det = await detail(A, (await A.get('/api/payments?page_size=1')).json.rows[0].id); assert.ok(!JSON.stringify(det).includes('50100234567891'));
  });
  test('vendor bank details change only after a different user authorises; history is kept', async () => {
    const v = (await C.get('/api/vendors?q=ABC%20Suppliers')).json[0];
    const rq = await C.post(`/api/vendors/${v.id}/bank-change`, { bank_name: 'Axis Bank', account_number: '917020011122233', ifsc: 'UTIB0000123', account_type: 'CURRENT', reason: 'Vendor changed bankers (letter on file)' }); assert.equal(rq.status, 201, JSON.stringify(rq.json));
    assert.equal((await C.get('/api/vendors?q=ABC%20Suppliers')).json[0].bank_account_masked, 'XXXX XXXX 7891', 'not yet changed');
    assert.equal((await C.post(`/api/vendors/bank-requests/${rq.json.id}/decision`, { approve: true })).status, 403, 'requester (C) lacks authorise permission');
    const b = await B2.post(`/api/vendors/bank-requests/${rq.json.id}/decision`, { approve: true, remarks: 'Verified letter' }); assert.equal(b.status, 200);
    assert.equal((await C.get('/api/vendors?q=ABC%20Suppliers')).json[0].bank_account_masked, 'XXXX XXXX 2233');
    const hist = (await C.get(`/api/vendors/${v.id}/history`)).json; assert.ok(hist.some((h: any) => h.change_type === 'BANK_CHANGE_REQUESTED') && hist.some((h: any) => h.change_type === 'BANK_CHANGE_APPROVED'));
    const self = await ADMIN.post(`/api/vendors`, { name: 'Temp Vendor', bank_name: 'HDFC Bank', bank_account_number: '123456789012', ifsc: 'HDFC0000001', account_type: 'CURRENT' }); assert.equal(self.status, 201);
    const pend = (await ADMIN.get('/api/vendors/bank-requests')).json.find((r: any) => r.vendor === 'Temp Vendor');
    assert.equal((await ADMIN.post(`/api/vendors/bank-requests/${pend.id}/decision`, { approve: true })).status, 403, 'requester cannot authorise own request');
    const noBank = (await A.get('/api/payments/meta')).json.vendors.find((x: any) => x.name === 'Temp Vendor'); assert.equal(noBank.bank_authorised, false);
  });
  test('a payment to a vendor whose bank details changed after approval fails the control checklist', async () => {
    const pa = await newPayment(A, { vendor_id: XYZ, gross_amount: 30000, gst_amount: 4576.27 }); await A.post(`/api/payments/${pa.id}/submit`); await B.post(`/api/payments/${pa.id}/b-decision`, { decision: 'APPROVE' });
    await C.post(`/api/payments/${pa.id}/c-review`, { result: 'VERIFIED', checklist: ALL_C });
    await C.put(`/api/payments/${pa.id}/accounting`, acct({ gst_amount: 4576.27, basic_amount: 25423.73, net_payable: 30000, tds_amount: 0, other_deductions: 0, advance_adjustment: 0 })); await C.post(`/api/payments/${pa.id}/accounting/verify`, { confirm: true });
    const rq = await C.post(`/api/vendors/${XYZ}/bank-change`, { bank_name: 'Yes Bank', account_number: '000123456789', ifsc: 'YESB0000001', account_type: 'CURRENT', reason: 'Fraud-check test' }); await B2.post(`/api/vendors/bank-requests/${rq.json.id}/decision`, { approve: true });
    const chk = (await C.get(`/api/payments/${pa.id}/control-checklist`)).json; assert.equal(chk.ready, false); assert.ok(chk.items.some((i: any) => i.key === 'beneficiary_bank' && !i.ok));
    const r = await C.post(`/api/payments/${pa.id}/bank-initiation`, { bank_ref_no: `BK-${seq}` }); assert.equal(r.status, 400); assert.match(r.json.error, /bank details changed after approval/);
  });
  test('company, bank, user, payment-mode and list masters are maintainable by the admin only', async () => {
    assert.equal((await A.post('/api/companies', { name: 'X', short_name: 'X' })).status, 403);
    const c = await ADMIN.post('/api/companies', { name: 'Test Co Pvt Ltd', short_name: 'TCO', pan: 'ABCDE1234F', is_active: true }); assert.equal(c.status, 201, JSON.stringify(c.json));
    assert.equal((await ADMIN.post('/api/companies', { name: 'Bad Co', short_name: 'BAD', pan: '123' })).status, 400);
    const b = await ADMIN.post('/api/bank-accounts', { company_id: c.json.id, bank_name: 'HDFC Bank', account_name: 'Test', account_number: '12345678901234', ifsc: 'HDFC0000001', account_type: 'CURRENT' }); assert.equal(b.status, 201);
    assert.equal((await ADMIN.post('/api/master-data/cost_centre', { code: 'cc-new', name: 'New cost centre' })).status, 201);
    assert.equal((await ADMIN.post('/api/payment-modes', { code: 'swift', name: 'SWIFT', required_fields: ['bank_ref_no'] })).status, 201);
    assert.equal((await ADMIN.put('/api/admin/statuses/PENDING_B_APPROVAL', { label: 'AWAITING B', color: 'amber' })).status, 200);
    assert.equal((await A.get('/api/statuses')).json.find((s: any) => s.code === 'PENDING_B_APPROVAL').label, 'AWAITING B');
    await ADMIN.put('/api/admin/statuses/PENDING_B_APPROVAL', { label: 'PENDING B APPROVAL', color: 'amber' });
  });
});

describe('12 · search, filters, dashboards, Excel, PDF, reports, notifications', () => {
  test('global search works across PA no, vendor, invoice, amount, bank, status, user, UTR', async () => {
    const q = async (s: string) => (await A.get(`/api/payments?q=${encodeURIComponent(s)}&page_size=5`)).json;
    assert.ok((await q('PA-2026-000002')).total >= 1);
    assert.ok((await q('ABC Suppliers')).total >= 1);
    assert.ok((await q('ABC/26-27/0873')).total >= 1);
    assert.ok((await q('Kotak')).total >= 1);
    assert.ok((await q('PAYMENT APPROVED')).total >= 1);
    const d = await ADMIN.get('/api/payments?q=KKBK2627001245'); assert.ok(d.json.total >= 1, 'bank reference');
    const amt = await ADMIN.get('/api/payments?q=525000'); assert.ok(amt.json.total >= 1);
    assert.ok((await ADMIN.get('/api/payments?q=Vikram')).json.total >= 1, 'approver name');
    const utr = (await db.query(`SELECT utr FROM bank_transactions WHERE utr IS NOT NULL LIMIT 1`)).rows[0].utr; assert.ok((await ADMIN.get(`/api/payments?q=${utr}`)).json.total >= 1, 'UTR');
    const s = (await A.get('/api/search?q=abc')).json; assert.ok(s.payments.length && s.vendors.length);
  });
  test('filters: date range, company, status, mode, approved-by, amount', async () => {
    const all = (await ADMIN.get('/api/payments?page_size=200')).json.total;
    const f = async (qs: string) => (await ADMIN.get(`/api/payments?${qs}&page_size=200`)).json;
    assert.ok((await f(`company_id=${BOL}`)).total < all); assert.ok((await f('status=PAYMENT_COMPLETED')).rows.every((r: any) => r.status === 'PAYMENT_COMPLETED'));
    assert.ok((await f('payment_mode=RTGS')).rows.every((r: any) => r.payment_mode === 'RTGS'));
    assert.ok((await f('date_from=2026-08-01&date_to=2026-08-31')).rows.every((r: any) => r.created_at >= '2026-07-31' && r.created_at <= '2026-09-01'));
    assert.ok((await f('min_amount=1000000')).rows.every((r: any) => r.net_payable >= 1000000));
    const meera = meta.users.find((u: any) => u.name === 'Meera Iyer'); assert.ok((await f(`approved_by=${meera.id}`)).total > 0);
  });
  test('role dashboards return the specified cards', async () => {
    const dash = async (c: Client) => (await c.get('/api/dashboard')).json;
    const a = await dash(A); assert.deepEqual(a.sections.A.cards.map((c: any) => c.label), ['My Payment Requests', 'Draft', 'Pending B Approval', 'B Rejected', 'C Query', 'Resubmitted', 'Completed']);
    const b = await dash(B2); assert.deepEqual(b.sections.B.cards.map((c: any) => c.label).slice(0, 2), ['Pending Approval', 'Approved Today']); assert.ok(b.sections.B.pending_by_company && b.sections.B.pending_by_priority);
    const c = await dash(C); assert.deepEqual(c.sections.C.cards.map((x: any) => x.label).slice(0, 4), ['Pending Verification', 'Query Raised', 'Ready for Payment', 'Pending D Approval']);
    const d = await dash(D); assert.deepEqual(d.sections.D.cards.map((x: any) => x.label).slice(0, 2), ['Pending Final Approval', 'Approved Today']);
    const q = (await C.get('/api/payments/queue')).json; assert.ok(q.length && ['pa_number', 'company', 'party', 'net_payable', 'b_approval_date', 'b_approver', 'b_remarks', 'status_label', 'doc_status', 'accounting_status', 'bank_status'].every((k) => k in q[0]));
    const m = (await AUD.get('/api/dashboard/management')).json; for (const k of ['kpi', 'byCompany', 'byBank', 'byVendor', 'byMode', 'daily', 'monthly']) assert.ok(m[k], k);
    assert.ok(m.kpi.total_payments > 30 && m.monthly.length >= 3);
    const filtered = (await AUD.get(`/api/dashboard/management?company_id=${BOL}`)).json; assert.ok(filtered.kpi.total_payments < m.kpi.total_payments);
  });
  test('Excel export has the specified columns and honours filters', async () => {
    const res = await ADMIN.raw('GET', '/api/payments/export.xlsx?status=PAYMENT_COMPLETED'); assert.equal(res.status, 200);
    const wb = new ExcelJS.Workbook(); await wb.xlsx.load(Buffer.from(await res.arrayBuffer())); const ws = wb.getWorksheet('Payments')!;
    const head = (ws.getRow(1).values as any[]).slice(1);
    assert.deepEqual(head, ['Payment Advice No.', 'Date', 'Company', 'Vendor', 'Invoice No.', 'Invoice Date', 'Gross Amount', 'GST', 'TDS', 'Other Deduction', 'Net Payable', 'Payment Mode', 'Bank', 'Created By', 'B Approval By', 'B Approval Date', 'C Verification By', 'C Verification Date', 'Accounting Voucher No.', 'Bank Initiated By', 'Bank Initiation Date', 'Bank Reference No.', 'D Approval By', 'D Approval Date', 'UTR', 'Final Status', 'Remarks']);
    const n = (await ADMIN.get('/api/payments?status=PAYMENT_COMPLETED&page_size=200')).json.total;
    let rows = 0; ws.eachRow((r, i) => { if (i > 1 && r.getCell(1).value && String(r.getCell(1).value).startsWith('PA-')) rows++; }); assert.equal(rows, n);
    assert.equal(ws.getRow(2).getCell(26).value, 'PAYMENT COMPLETED');
    assert.equal((await AUD.raw('GET', '/api/payments/export.xlsx')).status, 200);
    assert.equal((await new Client(base).raw('GET', '/api/payments/export.xlsx')).status, 401);
  });
  test('Payment Advice PDF renders with QR', async () => {
    const id = (await ADMIN.get('/api/payments?q=PA-2026-000001')).json.rows[0].id;
    const res = await D.raw('GET', `/api/payments/${id}/pdf`); assert.equal(res.status, 200); assert.equal(res.headers.get('content-type'), 'application/pdf');
    const buf = Buffer.from(await res.arrayBuffer()); assert.ok(buf.subarray(0, 5).toString() === '%PDF-' && buf.length > 20000);
    const fs = await import('node:fs'); fs.writeFileSync('/tmp/PA-2026-000001.pdf', buf);
    assert.equal((await A2.raw('GET', `/api/payments/${id}/pdf`)).status, 404);
  });
  test('all 12 reports run and export to Excel and PDF', async () => {
    const list = (await A.get('/api/reports')).json; assert.equal(list.length, 12);
    for (const r of list) {
      const j = await C.get(`/api/reports/${r.key}`); assert.equal(j.status, 200, `${r.key}: ${JSON.stringify(j.json)}`); assert.ok(j.json.columns.length);
      const x = await C.raw('GET', `/api/reports/${r.key}/export.xlsx`); assert.equal(x.status, 200, r.key);
      const p = await C.raw('GET', `/api/reports/${r.key}/export.pdf`); assert.equal(p.status, 200, r.key); assert.equal(Buffer.from(await p.arrayBuffer()).subarray(0, 4).toString(), '%PDF');
    }
    const filtered = (await C.get(`/api/reports/payment_register?company_id=${BOL}&status=PAYMENT_COMPLETED`)).json; assert.ok(filtered.rows.length > 0 && filtered.rows.every((r: any) => r.status_label === 'PAYMENT COMPLETED'));
  });
  test('notifications: in-app list + mark read; e-mail templates rendered with a login button; every listed event has a template', async () => {
    const n = (await B2.get('/api/notifications')).json; assert.ok(n.rows.length); assert.equal((await B2.post('/api/notifications/read', {})).status, 200); assert.equal((await B2.get('/api/notifications')).json.unread, 0);
    const em = (await ADMIN.get('/api/admin/outbox?channel=EMAIL')).json.find((o: any) => o.event_code === 'B_APPROVAL_PENDING'); assert.ok(em); assert.match(em.subject, /^Payment Approval Required – PA-2026-\d{6} – ₹[\d,]+$/);
    const html = (await db.query(`SELECT html FROM notification_outbox WHERE event_code='B_APPROVAL_PENDING' AND channel='EMAIL' LIMIT 1`)).rows[0].html; for (const f of ['Payment Advice Number', 'Vendor', 'Company', 'Amount', 'Due Date', 'Current Stage', 'Required Action', 'Open in Payment Workflow']) assert.ok(html.includes(f), f);
    const tpl = (await ADMIN.get('/api/admin/notification-templates')).json; assert.equal(tpl.events.length, 16); for (const [ev] of tpl.events) assert.ok(tpl.templates.filter((t: any) => t.event_code === ev).length === 4, ev);
  });
  test('WhatsApp / e-mail settings never expose credentials; test message via mock provider works', async () => {
    assert.equal((await ADMIN.put('/api/admin/settings/whatsapp', { provider: 'META_CLOUD', phone_number_id: '123', access_token: 'SECRET-TOKEN-123' })).status, 200);
    const s = (await ADMIN.get('/api/admin/settings')).json.whatsapp.value; assert.equal(s.has_access_token, true); assert.ok(!JSON.stringify(s).includes('SECRET-TOKEN')); assert.ok(!('access_token_enc' in s));
    const raw = (await db.query(`SELECT value FROM system_settings WHERE key='whatsapp'`)).rows[0].value; assert.ok(raw.access_token_enc.startsWith('v1:') && !JSON.stringify(raw).includes('SECRET-TOKEN'), 'encrypted at rest');
    await ADMIN.put('/api/admin/settings/whatsapp', { provider: 'MOCK' });
    const t = await ADMIN.post('/api/admin/settings/test-message', { channel: 'WHATSAPP', to: '9000000006' }); assert.equal(t.json.ok, true);
    const audit = (await ADMIN.get('/api/admin/audit-logs?action=SETTING_CHANGED')).json.rows; assert.ok(!JSON.stringify(audit).includes('SECRET-TOKEN'));
  });
  test('admin: role permissions, backup, login history, recovery contact change requires super-admin password', async () => {
    const roles = (await ADMIN.get('/api/admin/roles')).json; assert.equal(roles.roles.length, 6);
    assert.equal((await ADMIN.put('/api/admin/roles/ADMIN/permissions', { permissions: ['payment.view'] })).status, 400);
    assert.ok((await ADMIN.get('/api/admin/login-history')).json.length > 5);
    const bk = await ADMIN.post('/api/admin/backups'); assert.ok(bk.status === 200 || (bk.status === 400 && /pg_dump/.test(bk.json.error)), JSON.stringify(bk.json));
    assert.equal((await ADMIN.put('/api/admin/recovery', { mobile: '9812345678', password: 'wrong' })).status, 403);
    assert.equal((await ADMIN.put('/api/admin/recovery', { mobile: '12345', password: 'Demo@12345' })).status, 400);
    assert.equal((await ADMIN.put('/api/admin/recovery', { mobile: '9460201308', password: 'Demo@12345' })).status, 200);
  });
  test('user-friendly errors', async () => {
    const r = await A.post('/api/payments', payBody({ invoice_number: '' })); assert.equal(r.status, 400); assert.equal(r.json.error, 'Invoice number is required.');
    const v = await A.post('/api/payments', payBody({ company_id: undefined })); assert.match(v.json.error, /Company is required/);
    const n = await A.post('/api/payments', payBody({ gross_amount: 0 })); assert.match(n.json.error, /greater than zero/);
  });
});
