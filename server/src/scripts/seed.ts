/**
 * Demo data seed – every record below is clearly DEMO DATA (is_demo = true).
 * The payments are created by driving the real workflow services with back-dated timestamps, so the
 * audit trail, status history, approvals and notifications are exactly what the live system produces.
 */
import PDFDocument from 'pdfkit';
import bcrypt from 'bcryptjs';
import { pool, tx, query, one } from '../db.js';
import { migrate } from './migrate.js';
import { encryptText } from '../lib/crypto.js';
import { loadUser, type SessionUser } from '../services/access.js';
import type { Ctx } from '../services/audit.js';
import { createPayment } from '../services/payments.js';
import * as W from '../services/workflow.js';
import { storeDocument } from '../services/documents.js';
import { dispatchOutbox } from '../services/notifications.js';
import { C_DOC_CHECKLIST, D_CHECKLIST } from '../constants.js';
import { isoDate } from '../lib/format.js';

const PASSWORD = process.env.DEMO_PASSWORD || 'Demo@12345';
const IST = '+05:30';
const at = (date: string, time = '10:00') => new Date(`${date}T${time}:00${IST}`);
const addHours = (d: Date, h: number) => new Date(d.getTime() + h * 3600_000);

function rng(seed: number) { let s = seed; return () => { s = (s * 1664525 + 1013904223) % 4294967296; return s / 4294967296; }; }
const rand = rng(20260930);
const pick = <T,>(a: T[]) => a[Math.floor(rand() * a.length)];

function pdf(title: string, lines: string[]): Promise<Buffer> {
  return new Promise((res) => {
    const d = new PDFDocument({ size: 'A5', margin: 28 }); const ch: Buffer[] = []; d.on('data', (c) => ch.push(c)); d.on('end', () => res(Buffer.concat(ch)));
    d.fontSize(14).text(title, { underline: true }).moveDown(); d.fontSize(9); lines.forEach((l) => d.text(l)); d.moveDown().fontSize(7).fillColor('#888').text('DEMO DATA – generated for demonstration only'); d.end();
  });
}

export async function seedDemo(log = console.log) {
  await migrate(() => {});
  if ((await one('SELECT 1 x FROM users WHERE login_id=$1', ['admin']))) { log('Demo data already present – skipping. (Run "npm run db:reset" first to start over.)'); return; }
  const hash = await bcrypt.hash(PASSWORD, 10);

  // ------------------------------------------------------------- companies & bank accounts
  const companies = [
    ['Betul Oil Limited', 'BOL', 'U15140MP1995PLC009876', 'AAACB4521K', '23AAACB4521K1Z5', 'BPLB12345A', 'DEMO DATA – Registered office, Betul, Madhya Pradesh'],
    ['Eyal Commodeal Private Limited', 'ECPL', 'U51909MH2012PTC231456', 'AABCE7788M', '27AABCE7788M1ZP', 'MUME54321B', 'DEMO DATA – Registered office, Mumbai, Maharashtra'],
    ['Backpack International Private Limited', 'BIPL', 'U74999MH2016PTC284412', 'AAECB2190N', '27AAECB2190N1Z2', 'MUMB98765C', 'DEMO DATA – Registered office, Mumbai, Maharashtra'],
    ['Shreans Daga Foundation (SDF)', 'SDF', 'U85300MH2010NPL204118', 'AAATS3345Q', '27AAATS3345Q1Z8', 'MUMS11223D', 'DEMO DATA – Registered office, Mumbai, Maharashtra'],
    ['Dermarich Aesthetics LLP', 'DERMA', 'AAB-4417', 'AAQFD9051R', '27AAQFD9051R1ZX', 'MUMD44556E', 'DEMO DATA – Registered office, Mumbai, Maharashtra'],
  ];
  const cid: Record<string, number> = {};
  for (const [name, short, cin, pan, gstin, tan, addr] of companies) cid[short] = (await pool.query('INSERT INTO companies(name,short_name,cin,pan,gstin,tan,address,is_demo) VALUES($1,$2,$3,$4,$5,$6,$7,true) RETURNING id', [name, short, cin, pan, gstin, tan, addr])).rows[0].id;
  const bankDefs: [string, string, string, string, string, string, string, string][] = [
    ['BOL', 'Kotak Mahindra Bank', 'Betul Oil Limited – Operations A/c', '4471209843214521', 'KKBK0000958', 'Nariman Point, Mumbai', 'Kotak Biz – Corporate Internet Banking', 'KOTAK'],
    ['BOL', 'HDFC Bank', 'Betul Oil Limited – Collections A/c', '50200034561378', 'HDFC0000060', 'Fort, Mumbai', 'HDFC Bank NetBanking (Corporate)', 'HDFC'],
    ['ECPL', 'ICICI Bank', 'Eyal Commodeal Pvt Ltd – Current A/c', '039105001742', 'ICIC0000391', 'BKC, Mumbai', 'ICICI CIB – Corporate Internet Banking', 'ICICI'],
    ['BIPL', 'Axis Bank', 'Backpack International Pvt Ltd – Current A/c', '918020056743211', 'UTIB0000004', 'Fort, Mumbai', 'Axis Bank Corporate Internet Banking', 'AXIS'],
    ['BIPL', 'Kotak Mahindra Bank', 'Backpack International Pvt Ltd – Payables A/c', '7712094410098', 'KKBK0000958', 'Nariman Point, Mumbai', 'Kotak Biz – Corporate Internet Banking', 'KOTAK'],
    ['SDF', 'State Bank of India', 'Shreans Daga Foundation – Main A/c', '38122096745', 'SBIN0000300', 'Mumbai Main Branch', 'SBI CINB – Corporate Internet Banking', 'SBI'],
    ['DERMA', 'HDFC Bank', 'Dermarich Aesthetics LLP – Current A/c', '50200087651422', 'HDFC0000240', 'Bandra West, Mumbai', 'HDFC Bank NetBanking (Corporate)', 'HDFC'],
  ];
  const bankIds: number[] = []; const bankMeta: { id: number; short: string; prefix: string }[] = [];
  for (const [short, bank, acName, acNo, ifsc, branch, portal, prefix] of bankDefs) {
    const id = (await pool.query('INSERT INTO bank_accounts(company_id,bank_name,account_name,account_number_enc,account_last4,ifsc,branch,account_type,bank_portal,is_demo) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,true) RETURNING id', [cid[short], bank, acName, encryptText(acNo), acNo.slice(-4), ifsc, branch, 'CURRENT', portal])).rows[0].id;
    bankIds.push(id); bankMeta.push({ id, short, prefix });
  }

  // ------------------------------------------------------------- users
  const allCompanies = Object.values(cid);
  const userDefs: any[] = [
    ['admin', 'System Administrator (DEMO)', 'ADMIN', { is_super_admin: true, can_view_full_account: true }, '9000000001'],
    ['a.anil', 'Anil Verma', 'A', {}, '9000000002'], ['a.priya', 'Priya Nair', 'A', { can_override_duplicate: true }, '9000000003'],
    ['b.rajesh', 'Rajesh Kumar', 'B', {}, '9000000004'], ['b.meera', 'Meera Iyer', 'B', { is_senior_approver: true }, '9000000005'],
    ['c.sunil', 'Sunil Patil', 'C', { can_view_full_account: true }, '9000000006'], ['c.kavita', 'Kavita Deshmukh', 'C', {}, '9000000007'],
    ['d.vikram', 'Vikram Singh', 'D', { can_view_full_account: true }, '9000000008'], ['d.sneha', 'Sneha Kapoor', 'D', {}, '9000000009'],
    ['auditor', 'Ravi Menon (Auditor)', 'AUDITOR', {}, '9000000010'],
  ];
  const uid: Record<string, number> = {}; let emp = 1001;
  for (const [login, name, role, flags, mobile] of userDefs) {
    const r = await pool.query(`INSERT INTO users(login_id,password_hash,name,email,mobile,employee_code,role_code,is_super_admin,is_senior_approver,can_view_full_account,can_override_duplicate,is_demo,must_change_password)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,true,false) RETURNING id`,
      [login, hash, name, `${login.replace('.', '_')}@example.com`, mobile, `DEMO-${emp++}`, role, !!flags.is_super_admin, !!flags.is_senior_approver, !!flags.can_view_full_account, !!flags.can_override_duplicate]);
    uid[login] = r.rows[0].id;
    for (const c of allCompanies) await pool.query('INSERT INTO user_companies(user_id,company_id) VALUES($1,$2)', [uid[login], c]);
  }
  const U: Record<string, SessionUser> = {};
  for (const k of Object.keys(uid)) U[k] = (await loadUser(uid[k]))!;

  // ------------------------------------------------------------- vendors (bank details pre-authorised for the demo)
  const vendorDefs: [string, string, string, string, string, string, string, string, string][] = [
    // code, name, pan, gstin, tds, msme, bank, acct, ifsc
    ['V-0001', 'ABC Suppliers', 'AAFCA1234B', '27AAFCA1234B1Z9', 'NONE', 'SMALL', 'HDFC Bank', '50100234567891', 'HDFC0001234'],
    ['V-0002', 'XYZ Ltd', 'AABCX5678D', '27AABCX5678D1ZQ', '194C', 'NOT_MSME', 'ICICI Bank', '000405123456', 'ICIC0000004'],
    ['V-0003', 'Sharma Logistics', 'AJKPS4321L', '23AJKPS4321L1Z3', '194C', 'MICRO', 'State Bank of India', '30987654321', 'SBIN0001234'],
    ['V-0004', 'Om Packaging Industries', 'AAHFO8899P', '23AAHFO8899P1ZV', 'NONE', 'MEDIUM', 'Axis Bank', '917020034512345', 'UTIB0001102'],
    ['V-0005', 'Pinnacle IT Solutions Pvt Ltd', 'AAECP3345T', '27AAECP3345T1Z1', '194J', 'NOT_MSME', 'Kotak Mahindra Bank', '6511230098765', 'KKBK0000632'],
    ['V-0006', 'Green Valley Agro Products', 'AAGFG7788E', '23AAGFG7788E1ZK', 'NONE', 'SMALL', 'Bank of Baroda', '12340100012345', 'BARB0BETULX'],
    ['V-0007', 'Ganga Transport Co.', 'ABCPG2345H', '09ABCPG2345H1Z7', '194C', 'MICRO', 'Punjab National Bank', '3456000100123456', 'PUNB0345600'],
    ['V-0008', 'Bright Ads & Media', 'AAOFB6677K', '27AAOFB6677K1ZC', '194C', 'SMALL', 'HDFC Bank', '50200011223344', 'HDFC0000090'],
    ['V-0009', 'Vardhaman Chemicals Pvt Ltd', 'AABCV9900M', '24AABCV9900M1ZS', 'NONE', 'NOT_MSME', 'ICICI Bank', '002205008899', 'ICIC0000022'],
    ['V-0010', 'Nirmal Legal Associates', 'AAAFN1122G', '27AAAFN1122G1ZD', '194J', 'NOT_MSME', 'Axis Bank', '912010045612378', 'UTIB0000267'],
    ['V-0011', 'Sunrise Facility Services', 'AAGCS5544R', '27AAGCS5544R1ZH', '194C', 'SMALL', 'Kotak Mahindra Bank', '2312009988771', 'KKBK0000751'],
    ['V-0012', 'Delta Electricals', 'AAJFD3321N', '23AAJFD3321N1ZP', 'NONE', 'MICRO', 'State Bank of India', '35012345678', 'SBIN0000456'],
    ['V-0013', 'Kaveri Printers', 'AAKFK7766J', '29AAKFK7766J1ZM', '194C', 'MICRO', 'Canara Bank', '1234101009876', 'CNRB0001234'],
    ['V-0014', 'Apex Consulting LLP', 'AAQFA2233B', '27AAQFA2233B1ZF', '194J', 'NOT_MSME', 'HDFC Bank', '50200099887766', 'HDFC0000335'],
  ];
  const vid: Record<string, number> = {};
  for (const [code, name, pan, gstin, tds, msme, bank, acct, ifsc] of vendorDefs) {
    const r = await pool.query(`INSERT INTO vendors(vendor_code,name,party_type,pan,gstin,address,contact_person,email,mobile,bank_name,bank_account_enc,bank_account_last4,ifsc,account_type,bank_authorised_at,bank_authorised_by,msme_status,tds_section,is_demo,created_by)
      VALUES($1,$2,'VENDOR',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'CURRENT',now(),$13,$14,$15,true,$16) RETURNING id`,
      [code, name, pan, gstin, 'DEMO DATA – vendor address', 'Accounts Contact', `accounts@${name.toLowerCase().replace(/[^a-z]/g, '').slice(0, 14)}.example`, '9800000000', bank, encryptText(acct), acct.slice(-4), ifsc, uid['b.meera'], msme, tds, uid['c.sunil']]);
    vid[code] = r.rows[0].id;
    await pool.query(`INSERT INTO vendor_history(vendor_id,changed_by,change_type,new_value,remarks) VALUES($1,$2,'CREATED',$3,'Demo vendor created with authorised bank details')`, [vid[code], uid['c.sunil'], name]);
  }
  // a party awaiting bank authorisation (try approving it as B / Admin; the requester cannot authorise their own request)
  await tx(async (db) => {
    const ctx = mkCtx(db, U['c.kavita'], at('2026-09-28', '15:30'));
    const { createVendor } = await import('../services/masters.js');
    await createVendor(ctx, { vendor_code: 'V-0015', name: 'Zenith Interiors (new vendor – bank pending authorisation)', pan: 'AAEFZ4455C', gstin: '27AAEFZ4455C1Z6', address: 'DEMO DATA', contact_person: 'Ms. Zenith', email: 'accounts@zenith.example', mobile: '9811111111', tds_section: '194C', msme_status: 'SMALL',
      bank_name: 'Bank of Maharashtra', bank_account_number: '60123456789', ifsc: 'MAHB0000123', account_type: 'CURRENT' });
    await db.query(`UPDATE vendors SET is_demo=true WHERE vendor_code='V-0015'`);
  });

  // ------------------------------------------------------------- an inter-company party, plus employee/statutory parties
  for (const [code, name, type, tds, acct, ifsc, bank] of [
    ['P-0001', 'Backpack International Pvt Ltd (Inter-company)', 'INTER_COMPANY', 'NONE', '918020056743211', 'UTIB0000004', 'Axis Bank'],
    ['P-0002', 'Income Tax Department – TDS (Statutory)', 'STATUTORY', 'NONE', '0510008701112', 'SBIN0000300', 'State Bank of India'],
    ['P-0003', 'Employee reimbursements – Payroll pool', 'EMPLOYEE', 'NONE', '50200055667788', 'HDFC0000060', 'HDFC Bank'],
  ]) {
    const r = await pool.query(`INSERT INTO vendors(vendor_code,name,party_type,pan,address,email,mobile,bank_name,bank_account_enc,bank_account_last4,ifsc,account_type,bank_authorised_at,bank_authorised_by,tds_section,is_demo,created_by)
      VALUES($1,$2,$3,'AAAAA0000A','DEMO DATA','pay@example.com','9800000001',$4,$5,$6,$7,'CURRENT',now(),$8,$9,true,$10) RETURNING id`, [code, name, type, bank, encryptText(acct), acct.slice(-4), ifsc, uid['b.meera'], tds, uid['c.sunil']]);
    vid[code as string] = r.rows[0].id;
  }

  // ------------------------------------------------------------- workflow helpers
  function mkCtx(db: any, user: SessionUser, when: Date): Ctx {
    const c: any = { db, user: { id: user.id, loginId: user.loginId, name: user.name, roleCode: user.roleCode }, ip: `10.10.${(user.id % 200) + 1}.${(user.id * 7) % 250 + 2}`, ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/125 – DEMO seed', now: when, demo: true };
    return c;
  }
  const run = <T,>(user: SessionUser, when: Date, fn: (ctx: Ctx) => Promise<T>) => tx((db) => fn(mkCtx(db, user, when)));
  const CHECK_ALL = Object.fromEntries(C_DOC_CHECKLIST.map(([k]) => [k, true]));
  const D_ALL = Object.fromEntries(D_CHECKLIST.map(([k]) => [k, true]));
  let bankSeq = 24560;

  interface Spec { company: string; bankIdx: number; vendor: string; amount: number; gstPct?: number; tds?: number; mode?: string; dept: string; invoice: string; invoiceDate: string; created: string; due: string; purpose: string;
    state: string; creator?: string; priority?: string; payType?: string; ledger?: string; overrideDup?: string }

  async function build(spec: Spec) {
    const A = U[spec.creator ?? pick(['a.anil', 'a.priya'])];
    let t = at(spec.created, `${String(9 + Math.floor(rand() * 4)).padStart(2, "0")}:${pick(["05", "20", "40", "55"])}`);
    const gst = Math.round((spec.amount * (spec.gstPct ?? 0)) / (100 + (spec.gstPct ?? 0)) * 100) / 100;
    const bank = bankMeta[spec.bankIdx];
    const id = await run(A, t, async (ctx) => {
      const p = await createPayment(ctx, A, { company_id: cid[spec.company], bank_account_id: bank.id, vendor_id: vid[spec.vendor], payment_type: spec.payType ?? 'VENDOR', payment_mode: spec.mode ?? 'NEFT', priority: spec.priority ?? 'NORMAL',
        department: spec.dept, invoice_number: spec.invoice, invoice_date: spec.invoiceDate, po_number: `PO/${spec.invoice.slice(-4)}`, grn_reference: `GRN/${spec.invoice.slice(-4)}`, gross_amount: spec.amount, gst_amount: gst, tds_amount: spec.tds ?? 0, other_deduction: 0, advance_adjustment: 0,
        due_date: spec.due, purpose: spec.purpose, remarks: 'DEMO DATA', items: [{ description: spec.purpose, hsn_sac: '9987', quantity: 1, rate: spec.amount - gst, amount: spec.amount - gst, gst_rate: spec.gstPct ?? 0 }] });
      const inv = await pdf(`TAX INVOICE ${spec.invoice}`, [`Vendor: ${spec.vendor}`, `Invoice date: ${spec.invoiceDate}`, `Amount: INR ${spec.amount}`, `Purpose: ${spec.purpose}`]);
      await storeDocument(ctx, p.id, { originalname: `${spec.invoice.replace(/[^A-Za-z0-9]/g, '_')}.pdf`, buffer: inv }, { doc_type: 'Invoice', doc_name: `Invoice ${spec.invoice}`, payment_version_no: 1 });
      if (rand() > 0.4) await storeDocument(ctx, p.id, { originalname: 'purchase_order.pdf', buffer: await pdf('PURCHASE ORDER', [`PO/${spec.invoice.slice(-4)}`, spec.purpose]) }, { doc_type: 'Purchase Order', payment_version_no: 1 });
      return p.id as number;
    });
    if (spec.state === 'DRAFT') return id;
    const step = (h = 2 + Math.floor(rand() * 8)) => (t = addHours(t, h));
    await run(A, step(1), (ctx) => W.submitPayment(ctx, A, id, { override_reason: spec.overrideDup }));
    if (spec.state === 'PENDING_B') return id;
    const p0 = (await one<any>('SELECT approval_plan FROM payment_advises WHERE id=$1', [id]))!;
    const levels: any[] = p0.approval_plan.b_levels; const dCount: number = p0.approval_plan.d_count;
    if (spec.state === 'PENDING_B_L2') { await run(U['b.rajesh'], step(), (ctx) => W.bDecision(ctx, U['b.rajesh'], id, { decision: 'APPROVE', remarks: 'Level 1 approved – forwarded to Senior Approver' })); return id; }
    if (spec.state === 'B_REJECTED') { await run(U['b.rajesh'], step(), (ctx) => W.bDecision(ctx, U['b.rajesh'], id, { decision: pick(['REJECT', 'RETURN']), reason: 'Invoice value does not match the PO – please attach the approved PO and rate contract.', remarks: 'Kindly recheck rates.', required_document: 'Approved PO / rate contract' })); return id; }
    // B approvals (sequential by level)
    for (let i = 0; i < levels.length; i++) {
      const b = levels[i].senior ? U['b.meera'] : U['b.rajesh'];
      await run(b, step(), (ctx) => W.bDecision(ctx, b, id, { decision: 'APPROVE', remarks: pick(['Approved as per PO.', 'Approved. Ensure timely payment.', 'Verified against contract.', 'OK to process.']) }));
    }
    if (spec.state === 'PENDING_C') return id;
    const C = U[pick(['c.sunil', 'c.kavita'])];
    if (spec.state === 'C_QUERY' || spec.state === 'A_RESUBMITTED' || spec.state === 'CANCEL_PENDING') {
      await run(C, step(), (ctx) => W.cReview(ctx, C, id, { result: 'DISCREPANCY', checklist: { original_invoice: true, purchase_order: true }, remarks: 'GST number on the invoice copy is not legible and the goods receipt note is missing.', required_document: 'Legible tax invoice copy and signed GRN' }));
      if (spec.state === 'C_QUERY') return id;
      if (spec.state === 'CANCEL_PENDING') { await run(C, step(), (ctx) => W.cancelPayment(ctx, C, id, 'Vendor has raised a credit note; invoice no longer payable.')); return id; }
      await run(A, step(), async (ctx) => { await storeDocument(ctx, id, { originalname: 'invoice_clear_copy.pdf', buffer: await pdf('TAX INVOICE (legible copy)', [spec.invoice]) }, { doc_type: 'Corrected Document', doc_name: 'Invoice – legible copy', payment_version_no: 1 }); await W.resubmitToC(ctx, A, id, { remarks: 'Uploaded a legible invoice copy and the signed GRN.' }); });
      return id;
    }
    await run(C, step(), (ctx) => W.cReview(ctx, C, id, { result: 'VERIFIED', checklist: CHECK_ALL, remarks: 'Originals verified against Payment Advice.' }));
    if (spec.state === 'C_VERIFIED') return id;
    const ledger = spec.ledger ?? '5002';
    await run(C, step(1), async (ctx) => {
      await W.saveAccounting(ctx, C, id, { ledger_account: ledger, cost_centre: 'CC-PLANT', department: spec.dept, project: 'NA', gst_treatment: gst ? 'REG_ITC' : 'NA', tds_section: spec.tds ? '194C' : 'NONE',
        voucher_no: `PV/${spec.company}/26-27/${1100 + id}`, accounting_date: isoDate(t), erp_reference: `ERP-PV-${458000 + id}`, vendor_ledger_checked: true, debit_credit_note_checked: true });
      await W.verifyAccounting(ctx, C, id, { confirm: true });
    });
    if (spec.state === 'ACCOUNTING_VERIFIED') return id;
    const ref = `${bank.prefix}${26}${String(bankSeq++)}`;
    await run(C, step(1), (ctx) => W.initiateBank(ctx, C, id, { bank_ref_no: ref, mode_details: spec.mode === 'CHEQUE' ? { cheque_no: `${bankSeq}`, cheque_date: isoDate(t) } : {}, remarks: 'Initiated on bank portal' }));
    if (spec.state === 'PENDING_D') return id;
    if (spec.state === 'PENDING_D_PARTIAL') { await run(U['d.vikram'], step(), (ctx) => W.dDecision(ctx, U['d.vikram'], id, { decision: 'APPROVE', checklist: D_ALL, remarks: 'First final approval recorded.' })); return id; }
    if (spec.state === 'D_REJECTED_C' || spec.state === 'D_REJECTED_A') {
      await run(U['d.sneha'], step(), (ctx) => W.dDecision(ctx, U['d.sneha'], id, { decision: 'REJECT', reason: spec.state === 'D_REJECTED_C' ? 'Bank reference on the portal does not match the beneficiary IFSC – re-check and re-initiate.' : 'Beneficiary name on invoice differs from bank account holder – vendor to confirm.', return_to: spec.state === 'D_REJECTED_C' ? 'C' : 'A', checklist: {} }));
      return id;
    }
    const Ds = dCount > 1 ? [U['d.vikram'], U['d.sneha']] : [U[pick(['d.vikram', 'd.sneha'])]];
    for (const d of Ds) await run(d, step(), (ctx) => W.dDecision(ctx, d, id, { decision: 'APPROVE', checklist: D_ALL, remarks: pick(['All checks satisfied.', 'Approved for release.', 'Reviewed complete history – approved.']) }));
    if (spec.state === 'D_APPROVED') return id;
    if (spec.state === 'ON_HOLD') { await run(U['b.meera'], step(), (ctx) => W.holdPayment(ctx, U['b.meera'], id, 'Hold requested by management pending vendor dispute resolution.')); return id; }
    const utr = `${bank.prefix}N${26}${String(Math.floor(rand() * 9e8) + 1e8)}`;
    if (spec.state === 'FAILED') { await run(C, step(6), (ctx) => W.updateBankStatus(ctx, C, id, { bank_status: 'FAILED', remarks: 'Beneficiary account frozen – rejected by beneficiary bank.' })); return id; }
    await run(C, step(4), (ctx) => W.updateBankStatus(ctx, C, id, { bank_status: 'PROCESSED', utr, bank_txn_id: `TXN${Math.floor(rand() * 1e9)}`, actual_debit_date: isoDate(t), actual_debit_amount: spec.amount - (spec.tds ?? 0) }));
    if (spec.state === 'RECONCILED') await run(C, step(24), (ctx) => W.updateBankStatus(ctx, C, id, { bank_status: 'RECONCILED', remarks: 'Matched with bank statement.' }));
    return id;
  }

  // ------------------------------------------------------------- 1. the headline demo: PA-2026-000001  (full A → B → C → query → A → C → bank → D flow)
  {
    const A = U['a.anil']; const B = U['b.meera']; const C = U['c.sunil']; const D = U['d.vikram'];
    let t = at('2026-09-24', '10:15');
    const id = await run(A, t, async (ctx) => {
      const p = await createPayment(ctx, A, { company_id: cid.BOL, bank_account_id: bankMeta[0].id, vendor_id: vid['V-0001'], payment_type: 'SUPPLIER', payment_mode: 'NEFT', priority: 'HIGH', department: 'PROCUREMENT',
        invoice_number: 'ABC/26-27/0873', invoice_date: '2026-09-20', po_number: 'PO/BOL/4471', grn_reference: 'GRN/BOL/2291', gross_amount: 525000, gst_amount: 56250, tds_amount: 0, other_deduction: 0, advance_adjustment: 0,
        due_date: '2026-10-05', purpose: 'Purchase of packing material – September batch', remarks: 'DEMO DATA – headline demonstration workflow',
        items: [{ description: 'Corrugated cartons 5-ply (3,000 nos)', hsn_sac: '4819', quantity: 3000, rate: 112.5, amount: 337500, gst_rate: 12 }, { description: 'BOPP tape & shrink film', hsn_sac: '3919', quantity: 1, rate: 131250, amount: 131250, gst_rate: 12 }] });
      await storeDocument(ctx, p.id, { originalname: 'ABC_invoice_0873.pdf', buffer: await pdf('TAX INVOICE ABC/26-27/0873', ['ABC Suppliers → Betul Oil Limited', 'Taxable value INR 4,68,750', 'GST @12% INR 56,250', 'Total INR 5,25,000', '(scan – partially cut off)']) }, { doc_type: 'Invoice', doc_name: 'Tax invoice ABC/26-27/0873', payment_version_no: 1 });
      await storeDocument(ctx, p.id, { originalname: 'PO_BOL_4471.pdf', buffer: await pdf('PURCHASE ORDER PO/BOL/4471', ['Packing material – September batch']) }, { doc_type: 'Purchase Order', payment_version_no: 1 });
      return p.id as number;
    });
    await run(A, addHours(t, 1), (ctx) => W.submitPayment(ctx, A, id, {})); t = addHours(t, 1);
    await run(B, (t = addHours(t, 3)), (ctx) => W.bDecision(ctx, B, id, { decision: 'APPROVE', remarks: 'Rates verified against PO 4471. Approved.' }));
    await run(C, (t = addHours(t, 5)), (ctx) => W.cReview(ctx, C, id, { result: 'DISCREPANCY', checklist: { original_invoice: false, purchase_order: true }, remarks: 'Original invoice copy is illegible (GSTIN cut off) and the signed goods receipt note is not attached.', required_document: 'Legible copy of tax invoice + signed GRN' }));
    await run(A, (t = addHours(t, 20)), async (ctx) => {
      const orig = (await ctx.db.query(`SELECT id FROM payment_documents WHERE payment_id=$1 AND doc_type='Invoice' AND status='ACTIVE'`, [id])).rows[0].id;
      await storeDocument(ctx, id, { originalname: 'ABC_invoice_0873_clear.pdf', buffer: await pdf('TAX INVOICE ABC/26-27/0873 (corrected copy)', ['ABC Suppliers → Betul Oil Limited', 'GSTIN 27AAFCA1234B1Z9', 'Total INR 5,25,000']) }, { doc_type: 'Invoice', doc_name: 'Tax invoice ABC/26-27/0873', replaces_id: orig, payment_version_no: 1 });
      await storeDocument(ctx, id, { originalname: 'GRN_BOL_2291_signed.pdf', buffer: await pdf('GOODS RECEIPT NOTE GRN/BOL/2291', ['Received in full – stores signed']) }, { doc_type: 'Goods/Service Receipt', payment_version_no: 1 });
      await W.resubmitToC(ctx, A, id, { remarks: 'Uploaded legible invoice (v2) and the signed GRN. Please re-verify.' });
    });
    await run(C, (t = addHours(t, 4)), (ctx) => W.cReview(ctx, C, id, { result: 'VERIFIED', checklist: CHECK_ALL, remarks: 'All originals verified against the corrected documents.' }));
    await run(C, (t = addHours(t, 2)), async (ctx) => {
      await W.saveAccounting(ctx, C, id, { ledger_account: '5002', cost_centre: 'CC-PLANT', department: 'PROCUREMENT', project: 'NA', gst_treatment: 'REG_ITC', tds_section: 'NONE', voucher_no: 'PV/BOL/26-27/1184', accounting_date: '2026-09-26', erp_reference: 'ERP-PV-458812', vendor_ledger_checked: true, debit_credit_note_checked: true });
      await W.verifyAccounting(ctx, C, id, { confirm: true });
    });
    await run(C, (t = addHours(t, 2)), (ctx) => W.initiateBank(ctx, C, id, { bank_ref_no: 'KKBK2627001245', remarks: 'NEFT initiated on Kotak Biz portal – awaiting final authorisation.' }));
    await run(D, (t = addHours(t, 3)), (ctx) => W.dDecision(ctx, D, id, { decision: 'APPROVE', checklist: D_ALL, remarks: 'Reviewed the complete history – A request, B approval, C verification and bank details. Approved.' }));
  }

  // ------------------------------------------------------------- 2. a spread of other payments across every state
  const S: Spec[] = [
    // completed / reconciled (older – drives trends)
    { company: 'BOL', bankIdx: 0, vendor: 'V-0004', amount: 236000, gstPct: 18, dept: 'PROCUREMENT', invoice: 'OPI/1188', invoiceDate: '2026-07-10', created: '2026-07-14', due: '2026-07-30', purpose: 'Pouches & laminates – July', state: 'RECONCILED' },
    { company: 'BOL', bankIdx: 1, vendor: 'V-0007', amount: 84500, gstPct: 5, tds: 1690, dept: 'OPERATIONS', invoice: 'GT/0412', invoiceDate: '2026-07-18', created: '2026-07-21', due: '2026-08-05', purpose: 'Freight – Betul to Indore lot (July)', state: 'COMPLETED', ledger: '5101', mode: 'IMPS' },
    { company: 'ECPL', bankIdx: 2, vendor: 'V-0002', amount: 1250000, gstPct: 18, tds: 21186, dept: 'OPERATIONS', invoice: 'XYZ/2026/771', invoiceDate: '2026-07-25', created: '2026-07-28', due: '2026-08-12', purpose: 'Commodity handling charges – Q1', state: 'COMPLETED', mode: 'RTGS', priority: 'HIGH' },
    { company: 'BIPL', bankIdx: 3, vendor: 'V-0008', amount: 177000, gstPct: 18, tds: 3000, dept: 'MARKETING', invoice: 'BAM/0932', invoiceDate: '2026-08-02', created: '2026-08-04', due: '2026-08-20', purpose: 'Campaign creatives & media – Aug', state: 'RECONCILED', ledger: '5204' },
    { company: 'SDF', bankIdx: 5, vendor: 'V-0010', amount: 59000, gstPct: 18, tds: 5000, dept: 'LEGAL', invoice: 'NLA/26/118', invoiceDate: '2026-08-05', created: '2026-08-07', due: '2026-08-22', purpose: 'Trust deed amendment – professional fees', state: 'COMPLETED', ledger: '5201', mode: 'NEFT' },
    { company: 'DERMA', bankIdx: 6, vendor: 'V-0011', amount: 42480, gstPct: 18, tds: 720, dept: 'ADMIN', invoice: 'SFS/0221', invoiceDate: '2026-08-09', created: '2026-08-11', due: '2026-08-25', purpose: 'Housekeeping contract – Aug', state: 'COMPLETED', ledger: '5202' },
    { company: 'BOL', bankIdx: 0, vendor: 'V-0009', amount: 3240000, gstPct: 18, dept: 'PROCUREMENT', invoice: 'VCP/26/0441', invoiceDate: '2026-08-12', created: '2026-08-14', due: '2026-08-30', purpose: 'Refining chemicals – bulk lot', state: 'COMPLETED', ledger: '5001', mode: 'RTGS', priority: 'URGENT' },
    { company: 'ECPL', bankIdx: 2, vendor: 'V-0006', amount: 468000, gstPct: 5, dept: 'PROCUREMENT', invoice: 'GVA/0771', invoiceDate: '2026-08-16', created: '2026-08-18', due: '2026-09-02', purpose: 'Seed & agro inputs', state: 'RECONCILED', mode: 'RTGS' },
    { company: 'BIPL', bankIdx: 4, vendor: 'V-0005', amount: 354000, gstPct: 18, tds: 6000, dept: 'IT', invoice: 'PIT/2026/338', invoiceDate: '2026-08-20', created: '2026-08-22', due: '2026-09-05', purpose: 'Managed IT services – Aug', state: 'COMPLETED', ledger: '5201', mode: 'RTGS' },
    { company: 'BOL', bankIdx: 1, vendor: 'V-0012', amount: 91700, gstPct: 18, dept: 'OPERATIONS', invoice: 'DE/5521', invoiceDate: '2026-08-24', created: '2026-08-26', due: '2026-09-08', purpose: 'Motor rewinding & electrical spares', state: 'COMPLETED', ledger: '5202', mode: 'NEFT' },
    { company: 'SDF', bankIdx: 5, vendor: 'V-0013', amount: 23600, gstPct: 18, tds: 400, dept: 'MARKETING', invoice: 'KP/0771', invoiceDate: '2026-08-28', created: '2026-08-31', due: '2026-09-10', purpose: 'Annual report printing', state: 'COMPLETED', ledger: '5204' },
    { company: 'DERMA', bankIdx: 6, vendor: 'V-0014', amount: 295000, gstPct: 18, tds: 5000, dept: 'ACCOUNTS', invoice: 'ACL/26/051', invoiceDate: '2026-09-01', created: '2026-09-03', due: '2026-09-18', purpose: 'Advisory retainer – Aug/Sep', state: 'COMPLETED', ledger: '5201', mode: 'NEFT' },
    { company: 'BOL', bankIdx: 0, vendor: 'V-0003', amount: 112000, gstPct: 5, tds: 2000, dept: 'OPERATIONS', invoice: 'SL/8891', invoiceDate: '2026-09-02', created: '2026-09-04', due: '2026-09-19', purpose: 'Outbound logistics – Aug', state: 'COMPLETED', ledger: '5101', mode: 'NEFT' },
    { company: 'BIPL', bankIdx: 3, vendor: 'V-0004', amount: 640000, gstPct: 18, dept: 'PROCUREMENT', invoice: 'OPI/1240', invoiceDate: '2026-09-05', created: '2026-09-07', due: '2026-09-22', purpose: 'Backpack packaging – festive order', state: 'COMPLETED', mode: 'RTGS' },
    // approved, awaiting bank completion
    { company: 'ECPL', bankIdx: 2, vendor: 'V-0002', amount: 728000, gstPct: 18, tds: 12331, dept: 'OPERATIONS', invoice: 'XYZ/2026/802', invoiceDate: '2026-09-15', created: '2026-09-17', due: '2026-09-30', purpose: 'Handling charges – Sept fortnight 1', state: 'D_APPROVED', mode: 'RTGS' },
    { company: 'BOL', bankIdx: 1, vendor: 'V-0007', amount: 66100, gstPct: 5, tds: 1322, dept: 'OPERATIONS', invoice: 'GT/0458', invoiceDate: '2026-09-18', created: '2026-09-21', due: '2026-10-03', purpose: 'Freight – Sept lot', state: 'D_APPROVED', ledger: '5101' },
    // pending D
    { company: 'BOL', bankIdx: 0, vendor: 'V-0009', amount: 3875000, gstPct: 18, dept: 'PROCUREMENT', invoice: 'VCP/26/0489', invoiceDate: '2026-09-22', created: '2026-09-25', due: '2026-10-08', purpose: 'Refining chemicals – Oct lot (needs two final approvals)', state: 'PENDING_D_PARTIAL', ledger: '5001', mode: 'RTGS', priority: 'URGENT' },
    { company: 'BIPL', bankIdx: 3, vendor: 'V-0008', amount: 141600, gstPct: 18, tds: 2400, dept: 'MARKETING', invoice: 'BAM/0977', invoiceDate: '2026-09-23', created: '2026-09-25', due: '2026-10-07', purpose: 'Diwali campaign – digital media', state: 'PENDING_D', ledger: '5204' },
    { company: 'SDF', bankIdx: 5, vendor: 'V-0011', amount: 47200, gstPct: 18, tds: 800, dept: 'ADMIN', invoice: 'SFS/0244', invoiceDate: '2026-09-24', created: '2026-09-26', due: '2026-10-09', purpose: 'Facility services – Sept', state: 'PENDING_D', ledger: '5202', mode: 'IMPS' },
    // C stage
    { company: 'ECPL', bankIdx: 2, vendor: 'V-0005', amount: 413000, gstPct: 18, tds: 7000, dept: 'IT', invoice: 'PIT/2026/361', invoiceDate: '2026-09-24', created: '2026-09-26', due: '2026-10-10', purpose: 'Cloud hosting & support – Q3', state: 'ACCOUNTING_VERIFIED', ledger: '5201', mode: 'NEFT' },
    { company: 'DERMA', bankIdx: 6, vendor: 'V-0012', amount: 78300, gstPct: 18, dept: 'OPERATIONS', invoice: 'DE/5588', invoiceDate: '2026-09-25', created: '2026-09-27', due: '2026-10-10', purpose: 'Clinic electrical upgrade', state: 'C_VERIFIED', ledger: '5202' },
    { company: 'BOL', bankIdx: 0, vendor: 'V-0006', amount: 385000, gstPct: 5, dept: 'PROCUREMENT', invoice: 'GVA/0802', invoiceDate: '2026-09-25', created: '2026-09-27', due: '2026-10-11', purpose: 'Oil-seed advance lot', state: 'PENDING_C', mode: 'NEFT', priority: 'HIGH' },
    { company: 'BIPL', bankIdx: 4, vendor: 'V-0013', amount: 29500, gstPct: 18, tds: 500, dept: 'MARKETING', invoice: 'KP/0789', invoiceDate: '2026-09-26', created: '2026-09-28', due: '2026-10-12', purpose: 'Catalogue printing', state: 'PENDING_C' },
    { company: 'SDF', bankIdx: 5, vendor: 'V-0014', amount: 118000, gstPct: 18, tds: 2000, dept: 'ACCOUNTS', invoice: 'ACL/26/066', invoiceDate: '2026-09-26', created: '2026-09-28', due: '2026-10-12', purpose: 'Audit support – FY 26-27 interim', state: 'C_QUERY', ledger: '5201' },
    { company: 'ECPL', bankIdx: 2, vendor: 'V-0003', amount: 96000, gstPct: 5, tds: 1600, dept: 'OPERATIONS', invoice: 'SL/8934', invoiceDate: '2026-09-27', created: '2026-09-28', due: '2026-10-13', purpose: 'Port-to-warehouse freight', state: 'A_RESUBMITTED' },
    // pending B
    { company: 'BOL', bankIdx: 1, vendor: 'V-0004', amount: 172000, gstPct: 18, dept: 'PROCUREMENT', invoice: 'OPI/1301', invoiceDate: '2026-09-28', created: '2026-09-29', due: '2026-10-14', purpose: 'Sachets – 2 lakh units', state: 'PENDING_B', priority: 'HIGH' },
    { company: 'BIPL', bankIdx: 3, vendor: 'V-0005', amount: 892000, gstPct: 18, tds: 15000, dept: 'IT', invoice: 'PIT/2026/377', invoiceDate: '2026-09-28', created: '2026-09-29', due: '2026-10-15', purpose: 'ERP customisation – milestone 2', state: 'PENDING_B', ledger: '5201', mode: 'RTGS' },
    { company: 'BOL', bankIdx: 0, vendor: 'V-0009', amount: 3250000, gstPct: 18, dept: 'PROCUREMENT', invoice: 'VCP/26/0502', invoiceDate: '2026-09-28', created: '2026-09-29', due: '2026-10-16', purpose: 'Bulk chemicals – multi-level approval demo (above ₹25 lakh)', state: 'PENDING_B_L2', mode: 'RTGS', priority: 'URGENT' },
    { company: 'DERMA', bankIdx: 6, vendor: 'V-0008', amount: 38940, gstPct: 18, tds: 660, dept: 'MARKETING', invoice: 'BAM/0990', invoiceDate: '2026-09-29', created: '2026-09-30', due: '2026-10-15', purpose: 'Instagram creative package', state: 'PENDING_B' },
    { company: 'SDF', bankIdx: 5, vendor: 'V-0010', amount: 35400, gstPct: 18, tds: 3000, dept: 'LEGAL', invoice: 'NLA/26/131', invoiceDate: '2026-09-29', created: '2026-09-30', due: '2026-10-15', purpose: 'FCRA compliance filing', state: 'PENDING_B' },
    // returned / rejected / exceptions
    { company: 'ECPL', bankIdx: 2, vendor: 'V-0006', amount: 210000, gstPct: 5, dept: 'PROCUREMENT', invoice: 'GVA/0790', invoiceDate: '2026-09-22', created: '2026-09-24', due: '2026-10-09', purpose: 'Seed grading services', state: 'B_REJECTED' },
    { company: 'BOL', bankIdx: 1, vendor: 'V-0012', amount: 54000, gstPct: 18, dept: 'OPERATIONS', invoice: 'DE/5570', invoiceDate: '2026-09-20', created: '2026-09-22', due: '2026-10-05', purpose: 'Transformer maintenance', state: 'D_REJECTED_C', ledger: '5202', mode: 'NEFT' },
    { company: 'BIPL', bankIdx: 3, vendor: 'V-0011', amount: 68000, gstPct: 18, tds: 1150, dept: 'ADMIN', invoice: 'SFS/0239', invoiceDate: '2026-09-19', created: '2026-09-22', due: '2026-10-04', purpose: 'Security services – Sept', state: 'D_REJECTED_A', ledger: '5202' },
    { company: 'BOL', bankIdx: 0, vendor: 'V-0003', amount: 133000, gstPct: 5, tds: 2200, dept: 'OPERATIONS', invoice: 'SL/8870', invoiceDate: '2026-09-10', created: '2026-09-13', due: '2026-09-28', purpose: 'Bulk oil tanker freight', state: 'FAILED', ledger: '5101' },
    { company: 'ECPL', bankIdx: 2, vendor: 'V-0013', amount: 18800, gstPct: 18, dept: 'ADMIN', invoice: 'KP/0755', invoiceDate: '2026-09-12', created: '2026-09-14', due: '2026-09-28', purpose: 'Stationery & forms', state: 'ON_HOLD' },
    { company: 'BOL', bankIdx: 0, vendor: 'V-0014', amount: 71000, gstPct: 18, tds: 1200, dept: 'ACCOUNTS', invoice: 'ACL/26/044', invoiceDate: '2026-09-08', created: '2026-09-10', due: '2026-09-25', purpose: 'Tax advisory – cancelled (credit note)', state: 'CANCEL_PENDING', ledger: '5201' },
    { company: 'SDF', bankIdx: 5, vendor: 'V-0012', amount: 26500, gstPct: 18, dept: 'OPERATIONS', invoice: 'DE/5601', invoiceDate: '2026-09-29', created: '2026-09-30', due: '2026-10-14', purpose: 'Draft – LED lighting for hall', state: 'DRAFT', creator: 'a.anil' },
    { company: 'BIPL', bankIdx: 3, vendor: 'V-0004', amount: 320000, gstPct: 18, dept: 'PROCUREMENT', invoice: 'OPI/1188B', invoiceDate: '2026-09-27', created: '2026-09-29', due: '2026-10-14', purpose: 'Draft – Backpack cartons (re-order)', state: 'DRAFT', creator: 'a.priya' },
  ];
  const ids: Record<string, number> = {};
  for (const s of S) { ids[s.invoice] = await build(s); }

  // the one cancelled payment: C requested, B (different person) approves the cancellation
  {
    const id = ids['ACL/26/044']; const C = U['c.sunil'];
    const req = (await one<any>('SELECT id FROM cancellation_requests WHERE payment_id=$1 AND status=$2', [id, 'PENDING']));
    const B = U['b.meera'];
    if (req) {
      const st = await one<any>('SELECT updated_at FROM payment_advises WHERE id=$1', [id]);
      await run(B, addHours(new Date(st.updated_at), 3), (ctx) => W.decideCancellation(ctx, B, id, req.id, { approve: true, remarks: 'Confirmed – credit note received from the vendor.' }));
    }
    void C;
  }
  // a payment created after a duplicate warning was overridden by an authorised maker (Priya)
  await build({ company: 'BOL', bankIdx: 0, vendor: 'V-0001', amount: 525000, gstPct: 12, dept: 'PROCUREMENT', invoice: 'ABC/26-27/0873', invoiceDate: '2026-09-20', created: '2026-09-30', due: '2026-10-08', purpose: 'Re-billed packing material (duplicate warning overridden – see audit)', state: 'PENDING_B', creator: 'a.priya', overrideDup: 'Vendor issued a replacement invoice with the same number after a GST correction; original is under credit-note cancellation.' }).catch((e) => log(`duplicate demo skipped: ${e.message}`));

  await dispatchOutbox(200);
  const n = await one<{ n: number }>('SELECT count(*)::int n FROM payment_advises');
  log(`Demo data loaded: ${n!.n} payment advices. Login with any demo user – ${PASSWORD === "Demo@12345" ? 'password "Demo@12345"' : "password as set in DEMO_PASSWORD"}.`);
}

if (process.argv[1]?.endsWith('seed.ts') || process.argv[1]?.endsWith('seed.js')) {
  seedDemo().then(() => pool.end()).catch(async (e) => { console.error(e); await pool.end(); process.exit(1); });
}
void query;
