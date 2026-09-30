import { z } from 'zod';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { pool, query, one } from '../db.js';
import { config } from '../config.js';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import { parse, optStr, reqStr, PAN_RE, GSTIN_RE, IFSC_RE, isEmail, money } from '../lib/validate.js';
import { encryptText, decryptText, maskAccount } from '../lib/crypto.js';
import { audit, diff, type Ctx } from './audit.js';
import { hasRole, clearPermissionCache, type SessionUser } from './access.js';
import { checkPasswordPolicy, hashPassword, revokeUserSessions } from './auth.js';
import { PERMISSIONS, ROLE_CODES } from '../constants.js';
import bcrypt from 'bcryptjs';

const execFileP = promisify(execFile);
const upper = (s: string | null) => (s ? s.toUpperCase().replace(/\s+/g, '') : s);

// =============================================================== companies
const companySchema = z.object({
  name: reqStr('Company name is required.', 200), short_name: reqStr('Short name is required.', 30),
  cin: optStr(30), pan: optStr(10), gstin: optStr(15), tan: optStr(10), address: optStr(500), is_active: z.boolean().default(true),
  logo_data: z.string().max(300_000).regex(/^data:image\/(png|jpeg);base64,/, 'Logo must be a PNG or JPEG image (max ~200 KB).').optional().nullable(),
});
export async function saveCompany(ctx: Ctx, idv: number | null, body: unknown) {
  const c = parse(companySchema, body);
  const pan = upper(c.pan); const gstin = upper(c.gstin);
  if (pan && !PAN_RE.test(pan)) throw badRequest('PAN format is invalid (expected e.g. ABCDE1234F).');
  if (gstin && !GSTIN_RE.test(gstin)) throw badRequest('GSTIN format is invalid.');
  const vals = [c.name, c.short_name, upper(c.cin), pan, gstin, upper(c.tan), c.address, c.is_active];
  try {
    if (idv == null) {
      const r = await ctx.db.query(`INSERT INTO companies(name,short_name,cin,pan,gstin,tan,address,is_active,logo_data) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`, [...vals, c.logo_data ?? null]);
      await audit(ctx, { action: 'COMPANY_CREATED', entityType: 'company', entityId: r.rows[0].id, new: { name: c.name, short_name: c.short_name } });
      return r.rows[0];
    }
    const old = await one<any>('SELECT * FROM companies WHERE id=$1', [idv], ctx.db); if (!old) throw notFound();
    const logo = c.logo_data === undefined ? old.logo_data : c.logo_data;
    const r = await ctx.db.query(`UPDATE companies SET name=$2,short_name=$3,cin=$4,pan=$5,gstin=$6,tan=$7,address=$8,is_active=$9,logo_data=$10,updated_at=now() WHERE id=$1 RETURNING *`, [idv, ...vals, logo]);
    const d = diff(old, r.rows[0], ['name', 'short_name', 'cin', 'pan', 'gstin', 'tan', 'address', 'is_active']);
    await audit(ctx, { action: 'COMPANY_UPDATED', entityType: 'company', entityId: idv, old: d.old, new: d.new });
    return r.rows[0];
  } catch (e: any) { if (e.code === '23505') throw conflict('A company with this name or short name already exists.'); throw e; }
}
export const listCompanies = (user: SessionUser) => query<any>(
  `SELECT id,name,short_name,cin,pan,gstin,tan,address,is_active,is_demo,(logo_data IS NOT NULL) AS has_logo FROM companies
    WHERE ($1::bigint[] = '{}' OR id = ANY($1)) ORDER BY name`, [hasRole(user, 'ADMIN', 'AUDITOR') && !user.companyIds.length ? [] : hasRole(user, 'ADMIN') && !user.companyIds.length ? [] : user.companyIds.length ? user.companyIds : [-1]]);

// =============================================================== bank accounts
const bankSchema = z.object({
  company_id: z.coerce.number().int().positive('Company is required.'), bank_name: reqStr('Bank name is required.', 100), account_name: reqStr('Account name is required.', 200),
  account_number: z.string().trim().regex(/^\d{6,24}$/, 'Account number must be 6–24 digits.').optional().or(z.literal('').transform(() => undefined)),
  ifsc: reqStr('IFSC is required.', 11), branch: optStr(100), account_type: z.enum(['CURRENT', 'SAVINGS', 'CASH_CREDIT', 'OVERDRAFT', 'ESCROW']).default('CURRENT'),
  bank_portal: optStr(150), is_active: z.boolean().default(true),
});
export async function saveBankAccount(ctx: Ctx, idv: number | null, body: unknown) {
  const b = parse(bankSchema, body); const ifsc = upper(b.ifsc)!;
  if (!IFSC_RE.test(ifsc)) throw badRequest('IFSC format is invalid (expected e.g. KKBK0000123).');
  if (idv == null) {
    if (!b.account_number) throw badRequest('Account number is required.');
    const r = await ctx.db.query(`INSERT INTO bank_accounts(company_id,bank_name,account_name,account_number_enc,account_last4,ifsc,branch,account_type,bank_portal,is_active) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
      [b.company_id, b.bank_name, b.account_name, encryptText(b.account_number), b.account_number.slice(-4), ifsc, b.branch, b.account_type, b.bank_portal, b.is_active]);
    await audit(ctx, { action: 'BANK_ACCOUNT_CREATED', entityType: 'bank_account', entityId: r.rows[0].id, new: { company_id: b.company_id, bank: b.bank_name, account: maskAccount(b.account_number.slice(-4)) } });
    return r.rows[0];
  }
  const old = await one<any>('SELECT * FROM bank_accounts WHERE id=$1', [idv], ctx.db); if (!old) throw notFound();
  const enc = b.account_number ? encryptText(b.account_number) : old.account_number_enc; const last4 = b.account_number ? b.account_number.slice(-4) : old.account_last4;
  await ctx.db.query(`UPDATE bank_accounts SET company_id=$2,bank_name=$3,account_name=$4,account_number_enc=$5,account_last4=$6,ifsc=$7,branch=$8,account_type=$9,bank_portal=$10,is_active=$11,updated_at=now() WHERE id=$1`,
    [idv, b.company_id, b.bank_name, b.account_name, enc, last4, ifsc, b.branch, b.account_type, b.bank_portal, b.is_active]);
  await audit(ctx, { action: 'BANK_ACCOUNT_UPDATED', entityType: 'bank_account', entityId: idv, old: { bank: old.bank_name, ifsc: old.ifsc, account: maskAccount(old.account_last4), active: old.is_active }, new: { bank: b.bank_name, ifsc, account: maskAccount(last4), active: b.is_active } });
  return { id: idv };
}
export async function listBankAccounts(user: SessionUser, opts: { forPayment?: boolean } = {}) {
  const rows = await query<any>(`SELECT b.id,b.company_id,c.short_name AS company_short,c.name AS company_name,b.bank_name,b.account_name,b.account_last4,b.ifsc,b.branch,b.account_type,b.bank_portal,b.is_active,b.is_demo
      FROM bank_accounts b JOIN companies c ON c.id=b.company_id ORDER BY c.name,b.bank_name`);
  const scoped = rows.filter((b) => (hasRole(user, 'ADMIN', 'AUDITOR') && !user.companyIds.length) || user.companyIds.includes(b.company_id))
    .filter((b) => !user.bankAccountIds || hasRole(user, 'ADMIN', 'AUDITOR') || user.bankAccountIds.includes(b.id))
    .filter((b) => !opts.forPayment || b.is_active);
  return scoped.map((b) => ({ ...b, account_masked: maskAccount(b.account_last4) }));
}
/** Full account numbers are only released to users flagged as authorised – and every reveal is audited. */
export async function revealAccount(ctx: Ctx, user: SessionUser, kind: 'bank' | 'vendor' | 'payment', idv: number) {
  if (!user.canViewFullAccount) throw forbidden('You are not authorised to view full bank account numbers.');
  let enc: string | null = null; let label = '';
  if (kind === 'bank') { const r = await one<any>('SELECT account_number_enc, bank_name FROM bank_accounts WHERE id=$1', [idv], ctx.db); enc = r?.account_number_enc; label = `bank account of ${r?.bank_name}`; }
  else if (kind === 'vendor') { const r = await one<any>('SELECT bank_account_enc, name FROM vendors WHERE id=$1', [idv], ctx.db); enc = r?.bank_account_enc; label = `bank account of vendor ${r?.name}`; }
  else { const r = await one<any>('SELECT beneficiary_account_enc, pa_number FROM payment_advises WHERE id=$1', [idv], ctx.db); enc = r?.beneficiary_account_enc; label = `beneficiary account of ${r?.pa_number}`; }
  if (!enc) throw notFound('No account number is recorded.');
  await audit(ctx, { action: 'ACCOUNT_NUMBER_REVEALED', entityType: kind, entityId: idv, paymentId: kind === 'payment' ? idv : null, remarks: `${user.name} viewed the full ${label}.` });
  return { account_number: decryptText(enc) };
}

// =============================================================== vendors
const vendorSchema = z.object({
  vendor_code: optStr(30), name: reqStr('Vendor name is required.', 200),
  party_type: z.enum(['VENDOR', 'SUPPLIER', 'CUSTOMER', 'EMPLOYEE', 'STATUTORY', 'LOAN', 'INTER_COMPANY', 'OTHER']).default('VENDOR'),
  pan: optStr(10), gstin: optStr(15), address: optStr(500), contact_person: optStr(120), email: optStr(150), mobile: optStr(20),
  msme_status: z.enum(['NOT_MSME', 'MICRO', 'SMALL', 'MEDIUM']).default('NOT_MSME'), tds_section: optStr(20),
  gst_registration: z.enum(['REGISTERED', 'UNREGISTERED', 'COMPOSITION', 'SEZ', 'OVERSEAS']).default('REGISTERED'), is_active: z.boolean().default(true),
  bank_name: optStr(100), bank_account_number: z.string().trim().regex(/^\d{6,24}$/, 'Account number must be 6–24 digits.').optional().or(z.literal('').transform(() => undefined)), ifsc: optStr(11),
  account_type: z.enum(['CURRENT', 'SAVINGS', 'CASH_CREDIT', 'OVERDRAFT', 'ESCROW']).optional().nullable(),
});
function vendorChecks(v: z.infer<typeof vendorSchema>) {
  const pan = upper(v.pan); const gstin = upper(v.gstin);
  if (pan && !PAN_RE.test(pan)) throw badRequest('PAN format is invalid (expected e.g. ABCDE1234F).');
  if (gstin && !GSTIN_RE.test(gstin)) throw badRequest('GSTIN format is invalid.');
  if (v.email && !isEmail(v.email)) throw badRequest('E-mail address is invalid.');
  if (v.mobile && !/^(\+91)?[\s-]?[6-9]\d{9}$/.test(v.mobile.replace(/\s/g, ''))) throw badRequest('Mobile number must be a valid 10-digit Indian mobile number.');
  const ifsc = upper(v.ifsc); if (ifsc && !IFSC_RE.test(ifsc)) throw badRequest('IFSC format is invalid (expected e.g. HDFC0001234).');
  return { pan, gstin, ifsc };
}
const vhist = (ctx: Ctx, vendorId: number, type: string, field: string | null, o: any, n: any, remarks?: string) =>
  ctx.db.query('INSERT INTO vendor_history(vendor_id,changed_by,changed_at,change_type,field_name,old_value,new_value,remarks) VALUES($1,$2,$3,$4,$5,$6,$7,$8)', [vendorId, ctx.user?.id ?? null, ctx.now, type, field, o == null ? null : String(o), n == null ? null : String(n), remarks ?? null]);

export async function createVendor(ctx: Ctx, body: unknown) {
  const v = parse(vendorSchema, body); const { pan, gstin, ifsc } = vendorChecks(v);
  let code = v.vendor_code;
  if (!code) { const n = await one<{ n: number }>('SELECT COALESCE(MAX(id),0)+1 AS n FROM vendors', [], ctx.db); code = `VND-${String(n!.n).padStart(4, '0')}`; }
  try {
    const r = await ctx.db.query(`INSERT INTO vendors(vendor_code,name,party_type,pan,gstin,address,contact_person,email,mobile,msme_status,tds_section,gst_registration,is_active,created_by,created_at,updated_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$15) RETURNING *`,
      [code, v.name, v.party_type, pan, gstin, v.address, v.contact_person, v.email, v.mobile, v.msme_status, v.tds_section, v.gst_registration, v.is_active, ctx.user!.id, ctx.now]);
    const vendor = r.rows[0];
    await vhist(ctx, vendor.id, 'CREATED', null, null, v.name, 'Vendor created');
    await audit(ctx, { action: 'VENDOR_CREATED', entityType: 'vendor', entityId: vendor.id, new: { code, name: v.name, pan, gstin } });
    if (v.bank_account_number && v.bank_name && ifsc && v.account_type) await requestBankChange(ctx, vendor.id, { bank_name: v.bank_name, account_number: v.bank_account_number, ifsc, account_type: v.account_type, reason: 'Initial bank details for new vendor' });
    return vendor;
  } catch (e: any) { if (e.code === '23505') throw conflict(`Vendor code ${code} already exists.`); throw e; }
}
export async function updateVendor(ctx: Ctx, idv: number, body: unknown) {
  const v = parse(vendorSchema, body); const { pan, gstin } = vendorChecks(v);
  const old = await one<any>('SELECT * FROM vendors WHERE id=$1', [idv], ctx.db); if (!old) throw notFound();
  const next = { name: v.name, party_type: v.party_type, pan, gstin, address: v.address, contact_person: v.contact_person, email: v.email, mobile: v.mobile, msme_status: v.msme_status, tds_section: v.tds_section, gst_registration: v.gst_registration, is_active: v.is_active };
  const d = diff(old, next, Object.keys(next));
  if (v.vendor_code && v.vendor_code !== old.vendor_code) throw badRequest('Vendor code cannot be changed.');
  if (!d.changed.length) return old;
  await ctx.db.query(`UPDATE vendors SET ${d.changed.map((c, i) => `${c}=$${i + 2}`).join(', ')}, updated_at=$${d.changed.length + 2} WHERE id=$1`, [idv, ...d.changed.map((c) => (next as any)[c]), ctx.now]);
  for (const c of d.changed) await vhist(ctx, idv, c === 'is_active' ? 'STATUS' : 'UPDATED', c, d.old[c], d.new[c]);
  await audit(ctx, { action: 'VENDOR_UPDATED', entityType: 'vendor', entityId: idv, old: d.old, new: d.new });
  return one('SELECT * FROM vendors WHERE id=$1', [idv], ctx.db);
}
export async function requestBankChange(ctx: Ctx, vendorId: number, b: { bank_name: string; account_number: string; ifsc: string; account_type: string; reason: string }) {
  const bs = parse(z.object({ bank_name: reqStr('Bank name is required.', 100), account_number: z.string().trim().regex(/^\d{6,24}$/, 'Account number must be 6–24 digits.'),
    ifsc: reqStr('IFSC is required.', 11), account_type: z.enum(['CURRENT', 'SAVINGS', 'CASH_CREDIT', 'OVERDRAFT', 'ESCROW']), reason: reqStr('A reason for the bank detail change is required.', 500) }), b);
  const ifsc = upper(bs.ifsc)!; if (!IFSC_RE.test(ifsc)) throw badRequest('IFSC format is invalid.');
  const v = await one<any>('SELECT * FROM vendors WHERE id=$1', [vendorId], ctx.db); if (!v) throw notFound();
  const pend = await one('SELECT id FROM vendor_bank_change_requests WHERE vendor_id=$1 AND status=$2', [vendorId, 'PENDING'], ctx.db);
  if (pend) throw conflict('A bank detail change for this vendor is already awaiting authorisation.');
  const r = await ctx.db.query(`INSERT INTO vendor_bank_change_requests(vendor_id,requested_by,requested_at,new_bank_name,new_account_enc,new_account_last4,new_ifsc,new_account_type,reason) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
    [vendorId, ctx.user!.id, ctx.now, bs.bank_name, encryptText(bs.account_number), bs.account_number.slice(-4), ifsc, bs.account_type, bs.reason]);
  await vhist(ctx, vendorId, 'BANK_CHANGE_REQUESTED', 'bank_account', maskAccount(v.bank_account_last4), maskAccount(bs.account_number.slice(-4)), bs.reason);
  await audit(ctx, { action: 'VENDOR_BANK_CHANGE_REQUESTED', entityType: 'vendor', entityId: vendorId, old: { bank: v.bank_name, account: maskAccount(v.bank_account_last4), ifsc: v.ifsc }, new: { bank: bs.bank_name, account: maskAccount(bs.account_number.slice(-4)), ifsc }, remarks: bs.reason });
  return { id: r.rows[0].id };
}
export async function decideBankChange(ctx: Ctx, user: SessionUser, reqId: number, approve: boolean, remarks?: string) {
  const r = await one<any>('SELECT * FROM vendor_bank_change_requests WHERE id=$1 FOR UPDATE', [reqId], ctx.db);
  if (!r || r.status !== 'PENDING') throw badRequest('This request is no longer pending.');
  if (r.requested_by === user.id) throw forbidden('Bank detail changes must be authorised by a different user than the one who requested them.');
  if (!approve && !remarks?.trim()) throw badRequest('Please give a reason for rejecting the request.');
  const v = (await one<any>('SELECT * FROM vendors WHERE id=$1', [r.vendor_id], ctx.db))!;
  await ctx.db.query(`UPDATE vendor_bank_change_requests SET status=$2, decided_by=$3, decided_at=$4, decision_remarks=$5 WHERE id=$1`, [reqId, approve ? 'APPROVED' : 'REJECTED', user.id, ctx.now, remarks ?? null]);
  if (approve) {
    await ctx.db.query(`UPDATE vendors SET bank_name=$2,bank_account_enc=$3,bank_account_last4=$4,ifsc=$5,account_type=$6,bank_authorised_at=$7,bank_authorised_by=$8,updated_at=$7 WHERE id=$1`,
      [v.id, r.new_bank_name, r.new_account_enc, r.new_account_last4, r.new_ifsc, r.new_account_type, ctx.now, user.id]);
  }
  await vhist(ctx, v.id, approve ? 'BANK_CHANGE_APPROVED' : 'BANK_CHANGE_REJECTED', 'bank_account', maskAccount(v.bank_account_last4), maskAccount(r.new_account_last4), remarks);
  await audit(ctx, { action: approve ? 'VENDOR_BANK_CHANGE_APPROVED' : 'VENDOR_BANK_CHANGE_REJECTED', entityType: 'vendor', entityId: v.id, new: { bank: r.new_bank_name, account: maskAccount(r.new_account_last4) }, remarks: remarks ?? undefined });
}
export async function listVendors(f: { q?: string; active?: string; pending?: string }) {
  const p: any[] = []; const w: string[] = ['true'];
  if (f.q) { p.push(`%${f.q}%`); w.push(`(v.name ILIKE $${p.length} OR v.vendor_code ILIKE $${p.length} OR v.pan ILIKE $${p.length} OR v.gstin ILIKE $${p.length})`); }
  if (f.active === 'true' || f.active === 'false') { p.push(f.active === 'true'); w.push(`v.is_active = $${p.length}`); }
  const rows = await query<any>(`SELECT v.id,v.vendor_code,v.name,v.party_type,v.pan,v.gstin,v.address,v.contact_person,v.email,v.mobile,v.bank_name,v.bank_account_last4,v.ifsc,v.account_type,
      v.msme_status,v.tds_section,v.gst_registration,v.is_active,v.is_demo,(v.bank_authorised_at IS NOT NULL) AS bank_authorised,
      EXISTS(SELECT 1 FROM vendor_bank_change_requests r WHERE r.vendor_id=v.id AND r.status='PENDING') AS bank_change_pending
      FROM vendors v WHERE ${w.join(' AND ')} ORDER BY v.name LIMIT 500`, p);
  return rows.map((r) => ({ ...r, bank_account_masked: maskAccount(r.bank_account_last4) }));
}
export async function vendorBankRequests(status = 'PENDING') {
  const rows = await query<any>(`SELECT r.id,r.vendor_id,v.name AS vendor,v.vendor_code,r.requested_at,u.name AS requested_by_name,r.requested_by,r.new_bank_name,r.new_account_last4,r.new_ifsc,r.new_account_type,r.reason,r.status,
      v.bank_name AS old_bank_name, v.bank_account_last4 AS old_last4, v.ifsc AS old_ifsc, d.name AS decided_by_name, r.decided_at, r.decision_remarks
      FROM vendor_bank_change_requests r JOIN vendors v ON v.id=r.vendor_id JOIN users u ON u.id=r.requested_by LEFT JOIN users d ON d.id=r.decided_by WHERE ($1='ALL' OR r.status=$1) ORDER BY r.id DESC LIMIT 200`, [status]);
  return rows.map((r) => ({ ...r, new_account_masked: maskAccount(r.new_account_last4), old_account_masked: maskAccount(r.old_last4) }));
}
export const vendorHistory = (vid: number) => query<any>(`SELECT h.*, u.name AS changed_by_name FROM vendor_history h LEFT JOIN users u ON u.id=h.changed_by WHERE h.vendor_id=$1 ORDER BY h.id DESC`, [vid]);

// =============================================================== master data / modes / status
export async function saveMasterData(ctx: Ctx, category: string, idv: number | null, body: any) {
  const b = parse(z.object({ code: reqStr('Code is required.', 40), name: reqStr('Name is required.', 200), is_active: z.boolean().default(true), sort_order: z.coerce.number().int().default(0), meta: z.record(z.any()).default({}) }), body);
  try {
    if (idv == null) { const r = await ctx.db.query('INSERT INTO master_data(category,code,name,is_active,sort_order,meta) VALUES($1,$2,$3,$4,$5,$6) RETURNING *', [category, b.code.toUpperCase(), b.name, b.is_active, b.sort_order, JSON.stringify(b.meta)]); await audit(ctx, { action: 'MASTER_DATA_CREATED', entityType: category, entityId: r.rows[0].id, new: b }); return r.rows[0]; }
    const old = await one<any>('SELECT * FROM master_data WHERE id=$1 AND category=$2', [idv, category], ctx.db); if (!old) throw notFound();
    const r = await ctx.db.query('UPDATE master_data SET code=$3,name=$4,is_active=$5,sort_order=$6,meta=$7 WHERE id=$1 AND category=$2 RETURNING *', [idv, category, b.code.toUpperCase(), b.name, b.is_active, b.sort_order, JSON.stringify(b.meta)]);
    await audit(ctx, { action: 'MASTER_DATA_UPDATED', entityType: category, entityId: idv, old: { code: old.code, name: old.name, active: old.is_active }, new: { code: b.code, name: b.name, active: b.is_active } });
    return r.rows[0];
  } catch (e: any) { if (e.code === '23505') throw conflict('This code already exists in the list.'); throw e; }
}
export async function savePaymentMode(ctx: Ctx, code: string | null, body: any) {
  const b = parse(z.object({ code: reqStr('Code is required.', 30), name: reqStr('Name is required.', 100), min_amount: z.coerce.number().min(0).nullable().optional().or(z.literal('').transform(() => null)), max_amount: z.coerce.number().min(0).nullable().optional().or(z.literal('').transform(() => null)),
    required_fields: z.array(z.string()).default([]), requires_beneficiary_bank: z.boolean().default(true), is_active: z.boolean().default(true), sort_order: z.coerce.number().int().default(0) }), body);
  const c = b.code.toUpperCase().replace(/\s+/g, '_');
  if (code == null) { await ctx.db.query('INSERT INTO payment_modes(code,name,min_amount,max_amount,required_fields,requires_beneficiary_bank,is_active,sort_order) VALUES($1,$2,$3,$4,$5,$6,$7,$8)', [c, b.name, b.min_amount ?? null, b.max_amount ?? null, b.required_fields, b.requires_beneficiary_bank, b.is_active, b.sort_order]); }
  else await ctx.db.query('UPDATE payment_modes SET name=$2,min_amount=$3,max_amount=$4,required_fields=$5,requires_beneficiary_bank=$6,is_active=$7,sort_order=$8 WHERE code=$1', [code, b.name, b.min_amount ?? null, b.max_amount ?? null, b.required_fields, b.requires_beneficiary_bank, b.is_active, b.sort_order]);
  await audit(ctx, { action: code == null ? 'PAYMENT_MODE_CREATED' : 'PAYMENT_MODE_UPDATED', entityType: 'payment_mode', entityId: code ?? c, new: b });
}
export async function saveStatusConfig(ctx: Ctx, code: string, body: any) {
  const b = parse(z.object({ label: reqStr('Label is required.', 60), color: z.enum(['slate', 'blue', 'amber', 'green', 'red', 'teal', 'indigo', 'orange', 'purple']), description: optStr(200), is_active: z.boolean().default(true) }), body);
  const old = await one<any>('SELECT * FROM status_config WHERE code=$1', [code], ctx.db); if (!old) throw notFound();
  await ctx.db.query('UPDATE status_config SET label=$2,color=$3,description=$4,is_active=$5 WHERE code=$1', [code, b.label, b.color, b.description, b.is_active]);
  await audit(ctx, { action: 'STATUS_CONFIG_UPDATED', entityType: 'status', entityId: code, old: { label: old.label, color: old.color }, new: { label: b.label, color: b.color } });
}

// =============================================================== approval matrix
const matrixSchema = z.object({
  name: reqStr('Rule name is required.', 120),
  company_id: z.coerce.number().int().positive().nullable().optional().or(z.literal('').transform(() => null)),
  department: optStr(80), bank_account_id: z.coerce.number().int().positive().nullable().optional().or(z.literal('').transform(() => null)), payment_type: optStr(40),
  min_amount: money('Minimum amount'), max_amount: z.coerce.number().min(0).nullable().optional().or(z.literal('').transform(() => null)),
  b_levels: z.array(z.object({ label: reqStr('Approval level name is required.', 80), senior: z.boolean().default(false), count: z.coerce.number().int().min(1).max(5).default(1) })).min(1, 'At least one B approval level is required.').max(6),
  d_count: z.coerce.number().int().min(1).max(5).default(1), sort_order: z.coerce.number().int().default(0), is_active: z.boolean().default(true),
});
export async function saveMatrix(ctx: Ctx, idv: number | null, body: unknown) {
  const m = parse(matrixSchema, body);
  if (m.max_amount != null && m.max_amount < m.min_amount) throw badRequest('Maximum amount cannot be lower than the minimum amount.');
  const vals = [m.name, m.company_id ?? null, m.department, m.bank_account_id ?? null, m.payment_type, m.min_amount, m.max_amount ?? null, JSON.stringify(m.b_levels), m.d_count, m.sort_order, m.is_active];
  if (idv == null) {
    const r = await ctx.db.query(`INSERT INTO approval_matrix(name,company_id,department,bank_account_id,payment_type,min_amount,max_amount,b_levels,d_count,sort_order,is_active) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`, vals);
    await audit(ctx, { action: 'APPROVAL_RULE_CREATED', entityType: 'approval_matrix', entityId: r.rows[0].id, new: m }); return r.rows[0];
  }
  const old = await one<any>('SELECT * FROM approval_matrix WHERE id=$1', [idv], ctx.db); if (!old) throw notFound();
  await ctx.db.query(`UPDATE approval_matrix SET name=$2,company_id=$3,department=$4,bank_account_id=$5,payment_type=$6,min_amount=$7,max_amount=$8,b_levels=$9,d_count=$10,sort_order=$11,is_active=$12,updated_at=now() WHERE id=$1`, [idv, ...vals]);
  await audit(ctx, { action: 'APPROVAL_RULE_UPDATED', entityType: 'approval_matrix', entityId: idv, old: { name: old.name, min: old.min_amount, max: old.max_amount, b_levels: old.b_levels, d_count: old.d_count, active: old.is_active }, new: m });
  return { id: idv };
}

// =============================================================== users & roles
const userBase = z.object({
  name: reqStr('Name is required.', 120), email: reqStr('E-mail is required.', 150), mobile: optStr(20), employee_code: optStr(30),
  role_code: z.enum(ROLE_CODES), extra_roles: z.array(z.enum(ROLE_CODES)).default([]), is_active: z.boolean().default(true),
  is_senior_approver: z.boolean().default(false), can_view_full_account: z.boolean().default(false), can_override_duplicate: z.boolean().default(false), sod_exception: z.boolean().default(false),
  is_super_admin: z.boolean().default(false), company_ids: z.array(z.coerce.number().int()).default([]), bank_account_ids: z.array(z.coerce.number().int()).default([]),
});
const userCreate = userBase.extend({ login_id: z.string().trim().regex(/^[A-Za-z0-9._-]{3,40}$/, 'User ID must be 3–40 characters (letters, digits, . _ -).'), password: z.string().min(1, 'Password is required.'), must_change_password: z.boolean().default(true) });
export async function createUser(ctx: Ctx, actor: SessionUser, body: unknown, opts: { demo?: boolean } = {}) {
  const u = parse(userCreate, body);
  if (!isEmail(u.email)) throw badRequest('E-mail address is invalid.');
  if (u.is_super_admin && !actor.isSuperAdmin) throw forbidden('Only a super-admin can create another super-admin.');
  const err = await checkPasswordPolicy(u.password); if (err) throw badRequest(err);
  try {
    const r = await ctx.db.query(`INSERT INTO users(login_id,password_hash,name,email,mobile,employee_code,role_code,extra_roles,is_active,is_super_admin,is_senior_approver,can_view_full_account,can_override_duplicate,sod_exception,must_change_password,is_demo)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING id`,
      [u.login_id, await hashPassword(u.password), u.name, u.email, u.mobile, u.employee_code, u.role_code, u.extra_roles.filter((r) => r !== u.role_code), u.is_active, u.is_super_admin, u.is_senior_approver, u.can_view_full_account, u.can_override_duplicate, u.sod_exception, u.must_change_password, !!opts.demo]);
    const id = r.rows[0].id;
    await setUserAccess(ctx, id, u.company_ids, u.bank_account_ids);
    await audit(ctx, { action: 'USER_CREATED', entityType: 'user', entityId: id, new: { login_id: u.login_id, name: u.name, role: u.role_code, extra_roles: u.extra_roles, companies: u.company_ids } });
    return { id };
  } catch (e: any) { if (e.code === '23505') throw conflict('A user with this User ID or Employee Code already exists.'); throw e; }
}
async function setUserAccess(ctx: Ctx, id: number, companies: number[], banks: number[]) {
  await ctx.db.query('DELETE FROM user_companies WHERE user_id=$1', [id]);
  for (const c of new Set(companies)) await ctx.db.query('INSERT INTO user_companies(user_id,company_id) VALUES($1,$2)', [id, c]);
  await ctx.db.query('DELETE FROM user_bank_accounts WHERE user_id=$1', [id]);
  for (const b of new Set(banks)) await ctx.db.query('INSERT INTO user_bank_accounts(user_id,bank_account_id) VALUES($1,$2)', [id, b]);
}
export async function updateUser(ctx: Ctx, actor: SessionUser, idv: number, body: unknown) {
  const u = parse(userBase, body);
  if (!isEmail(u.email)) throw badRequest('E-mail address is invalid.');
  const old = await one<any>('SELECT * FROM users WHERE id=$1', [idv], ctx.db); if (!old) throw notFound();
  if ((u.is_super_admin !== old.is_super_admin) && !actor.isSuperAdmin) throw forbidden('Only a super-admin can change super-admin status.');
  if (idv === actor.id && (!u.is_active || u.role_code !== old.role_code)) throw badRequest('You cannot deactivate yourself or change your own role.');
  if (old.is_super_admin && (!u.is_active || !u.is_super_admin)) {
    const others = await one<{ n: number }>('SELECT count(*)::int n FROM users WHERE is_super_admin AND is_active AND id<>$1', [idv], ctx.db);
    if (!others || others.n === 0) throw badRequest('At least one active super-admin must remain.');
  }
  await ctx.db.query(`UPDATE users SET name=$2,email=$3,mobile=$4,employee_code=$5,role_code=$6,extra_roles=$7,is_active=$8,is_senior_approver=$9,can_view_full_account=$10,can_override_duplicate=$11,sod_exception=$12,is_super_admin=$13,updated_at=now() WHERE id=$1`,
    [idv, u.name, u.email, u.mobile, u.employee_code, u.role_code, u.extra_roles.filter((r) => r !== u.role_code), u.is_active, u.is_senior_approver, u.can_view_full_account, u.can_override_duplicate, u.sod_exception, u.is_super_admin]);
  await setUserAccess(ctx, idv, u.company_ids, u.bank_account_ids);
  if (!u.is_active) await ctx.db.query('UPDATE sessions SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL', [idv]);
  const d = diff(old, { name: u.name, email: u.email, mobile: u.mobile, employee_code: u.employee_code, role_code: u.role_code, is_active: u.is_active, is_senior_approver: u.is_senior_approver, can_view_full_account: u.can_view_full_account, can_override_duplicate: u.can_override_duplicate, sod_exception: u.sod_exception, is_super_admin: u.is_super_admin });
  await audit(ctx, { action: 'USER_UPDATED', entityType: 'user', entityId: idv, old: d.old, new: { ...d.new, extra_roles: u.extra_roles, companies: u.company_ids, banks: u.bank_account_ids } });
}
export async function adminResetPassword(ctx: Ctx, idv: number, password: string) {
  const err = await checkPasswordPolicy(password); if (err) throw badRequest(err);
  await ctx.db.query('UPDATE users SET password_hash=$2, must_change_password=true, password_changed_at=now(), failed_attempts=0, locked_until=NULL WHERE id=$1', [idv, await hashPassword(password)]);
  await ctx.db.query('UPDATE sessions SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL', [idv]);
  await audit(ctx, { action: 'USER_PASSWORD_RESET_BY_ADMIN', entityType: 'user', entityId: idv, remarks: 'Administrator set a temporary password; user must change it at next login.' });
}
export async function unlockUser(ctx: Ctx, idv: number) {
  await ctx.db.query('UPDATE users SET failed_attempts=0, locked_until=NULL WHERE id=$1', [idv]);
  await audit(ctx, { action: 'USER_UNLOCKED', entityType: 'user', entityId: idv });
}
export async function listUsers() {
  return query<any>(`SELECT u.id,u.login_id,u.name,u.email,u.mobile,u.employee_code,u.role_code,u.extra_roles,u.is_active,u.is_super_admin,u.is_senior_approver,u.can_view_full_account,u.can_override_duplicate,u.sod_exception,
      u.two_factor_enabled,u.last_login_at,u.locked_until,u.failed_attempts,u.is_demo,
      COALESCE((SELECT array_agg(company_id) FROM user_companies WHERE user_id=u.id),'{}') AS company_ids,
      COALESCE((SELECT array_agg(bank_account_id) FROM user_bank_accounts WHERE user_id=u.id),'{}') AS bank_account_ids
      FROM users u ORDER BY u.role_code, u.name`);
}
export async function rolesWithPermissions() {
  const roles = await query<any>('SELECT * FROM roles ORDER BY sort_order');
  const perms = await query<any>('SELECT * FROM role_permissions');
  return { roles: roles.map((r) => ({ ...r, permissions: perms.filter((p) => p.role_code === r.code).map((p) => p.permission) })), catalog: PERMISSIONS };
}
export async function setRolePermissions(ctx: Ctx, code: string, permissions: string[]) {
  if (!ROLE_CODES.includes(code as any)) throw notFound();
  const valid = new Set(PERMISSIONS.map((p) => p.key));
  const list = permissions.filter((p) => valid.has(p));
  if (code === 'ADMIN' && !list.includes('admin.access')) throw badRequest('The System Administrator role must keep the administration permission.');
  const old = (await query<any>('SELECT permission FROM role_permissions WHERE role_code=$1', [code], ctx.db)).map((r) => r.permission);
  await ctx.db.query('DELETE FROM role_permissions WHERE role_code=$1', [code]);
  for (const p of list) await ctx.db.query('INSERT INTO role_permissions(role_code,permission) VALUES($1,$2)', [code, p]);
  clearPermissionCache();
  await audit(ctx, { action: 'ROLE_PERMISSIONS_UPDATED', entityType: 'role', entityId: code, old: { permissions: old }, new: { permissions: list } });
}

// =============================================================== templates & recovery & backups
export async function saveTemplate(ctx: Ctx, idv: number, body: any) {
  const b = parse(z.object({ is_enabled: z.boolean(), subject: optStr(300), body: reqStr('Template text is required.', 4000) }), body);
  const old = await one<any>('SELECT * FROM notification_templates WHERE id=$1', [idv], ctx.db); if (!old) throw notFound();
  await ctx.db.query('UPDATE notification_templates SET is_enabled=$2, subject=$3, body=$4, updated_at=now() WHERE id=$1', [idv, b.is_enabled, b.subject, b.body]);
  await audit(ctx, { action: 'NOTIFICATION_TEMPLATE_UPDATED', entityType: 'notification_template', entityId: idv, old: { enabled: old.is_enabled, body: old.body }, new: { enabled: b.is_enabled, body: b.body }, remarks: `${old.event_code} / ${old.channel}` });
}
export async function changeRecoveryMobile(ctx: Ctx, actor: SessionUser, mobile: string, password: string) {
  if (!actor.isSuperAdmin) throw forbidden('Only a super-admin can change the recovery contact number.');
  const u = (await one<any>('SELECT password_hash FROM users WHERE id=$1', [actor.id], ctx.db))!;
  if (!(await bcrypt.compare(password ?? '', u.password_hash))) throw forbidden('Password is incorrect.');
  const m = (mobile ?? '').replace(/[\s-]/g, '').replace(/^\+91/, '');
  if (!/^[6-9]\d{9}$/.test(m)) throw badRequest('Enter a valid 10-digit Indian mobile number.');
  const old = await one<any>(`SELECT value FROM system_settings WHERE key='recovery'`, [], ctx.db);
  await ctx.db.query(`INSERT INTO system_settings(key,value,description,updated_by) VALUES('recovery',$1,'System administrator recovery / contact mobile',$2) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_by=EXCLUDED.updated_by, updated_at=now()`, [JSON.stringify({ mobile: m }), actor.id]);
  await audit(ctx, { action: 'RECOVERY_CONTACT_CHANGED', entityType: 'setting', entityId: 'recovery', old: { mobile: old?.value?.mobile ? `XXXXXX${String(old.value.mobile).slice(-4)}` : null }, new: { mobile: `XXXXXX${m.slice(-4)}` } });
}

export async function runBackup(ctx: Ctx | null, by: string) {
  await fs.mkdir(config.backupDir, { recursive: true });
  const u = new URL(config.databaseUrl);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = path.join(config.backupDir, `pawf-${stamp}.dump`);
  try {
    await execFileP('pg_dump', ['-h', u.hostname, '-p', u.port || '5432', '-U', decodeURIComponent(u.username), '-d', u.pathname.slice(1), '-Fc', '-f', file], { env: { ...process.env, PGPASSWORD: decodeURIComponent(u.password) }, timeout: 120000 });
  } catch (e: any) { throw badRequest(`Backup failed: ${e.code === 'ENOENT' ? 'pg_dump is not installed on the server' : (e.stderr || e.message).toString().slice(0, 300)}`); }
  const st = await fs.stat(file);
  if (ctx) await audit(ctx, { action: 'BACKUP_CREATED', entityType: 'backup', entityId: path.basename(file), new: { size: st.size, by } });
  return { file: path.basename(file), size: st.size };
}
export async function listBackups() {
  try {
    const files = await fs.readdir(config.backupDir);
    const out = [];
    for (const f of files.filter((x) => x.endsWith('.dump')).sort().reverse()) { const s = await fs.stat(path.join(config.backupDir, f)); out.push({ file: f, size: s.size, created_at: s.mtime }); }
    return out;
  } catch { return []; }
}
export async function pruneBackups(days: number) {
  const cutoff = Date.now() - days * 86400000;
  for (const b of await listBackups()) if (new Date(b.created_at).getTime() < cutoff) await fs.unlink(path.join(config.backupDir, b.file)).catch(() => {});
}
void pool; void revokeUserSessions;
