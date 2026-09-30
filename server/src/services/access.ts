import { pool, query, one, type Db } from '../db.js';
import { forbidden } from '../lib/errors.js';
import { DEFAULT_ROLE_PERMISSIONS, type RoleCode } from '../constants.js';

export interface SessionUser {
  id: number; loginId: string; name: string; email: string; mobile: string | null; employeeCode: string | null;
  roleCode: RoleCode; roles: RoleCode[];
  isSuperAdmin: boolean; isSeniorApprover: boolean; canViewFullAccount: boolean; canOverrideDuplicate: boolean; sodException: boolean;
  companyIds: number[]; bankAccountIds: number[] | null;
  mustChangePassword: boolean; twoFactorEnabled: boolean; passwordChangedAt: string;
}

export async function loadUser(id: number, db: Db = pool): Promise<SessionUser | null> {
  const u = await one<any>('SELECT * FROM users WHERE id=$1', [id], db);
  if (!u) return null;
  const comps = await query<{ company_id: number }>('SELECT company_id FROM user_companies WHERE user_id=$1', [id], db);
  const banks = await query<{ bank_account_id: number }>('SELECT bank_account_id FROM user_bank_accounts WHERE user_id=$1', [id], db);
  return {
    id: u.id, loginId: u.login_id, name: u.name, email: u.email, mobile: u.mobile, employeeCode: u.employee_code,
    roleCode: u.role_code, roles: Array.from(new Set([u.role_code, ...(u.extra_roles ?? [])])) as RoleCode[],
    isSuperAdmin: u.is_super_admin, isSeniorApprover: u.is_senior_approver, canViewFullAccount: u.can_view_full_account,
    canOverrideDuplicate: u.can_override_duplicate, sodException: u.sod_exception,
    companyIds: comps.map((c) => c.company_id), bankAccountIds: banks.length ? banks.map((b) => b.bank_account_id) : null,
    mustChangePassword: u.must_change_password, twoFactorEnabled: u.two_factor_enabled, passwordChangedAt: u.password_changed_at,
  };
}

// ---------------- permissions (DB-driven, cached) ----------------
let permCache: { at: number; map: Map<string, Set<string>> } | null = null;
export function clearPermissionCache() { permCache = null; }
async function permMap(): Promise<Map<string, Set<string>>> {
  if (permCache && Date.now() - permCache.at < 15_000) return permCache.map;
  const rows = await query<{ role_code: string; permission: string }>('SELECT role_code, permission FROM role_permissions');
  const map = new Map<string, Set<string>>();
  for (const r of rows) { if (!map.has(r.role_code)) map.set(r.role_code, new Set()); map.get(r.role_code)!.add(r.permission); }
  if (map.size === 0) for (const [role, perms] of Object.entries(DEFAULT_ROLE_PERMISSIONS)) map.set(role, new Set(perms));
  permCache = { at: Date.now(), map };
  return map;
}
export async function userPermissions(user: SessionUser): Promise<string[]> {
  const m = await permMap();
  const s = new Set<string>();
  for (const r of user.roles) for (const p of m.get(r) ?? []) s.add(p);
  return [...s];
}
export async function can(user: SessionUser, perm: string): Promise<boolean> {
  const m = await permMap();
  return user.roles.some((r) => m.get(r)?.has(perm));
}
export async function assertCan(user: SessionUser, perm: string, msg?: string) {
  if (!(await can(user, perm))) throw forbidden(msg);
}
export const hasRole = (u: SessionUser, ...roles: string[]) => u.roles.some((r) => roles.includes(r));

// ---------------- data scope ----------------
/** SQL predicate limiting payment rows to those the user may see. Pushes params. */
export function paymentScope(user: SessionUser, alias: string, params: any[]): string {
  const a = alias;
  if (hasRole(user, 'ADMIN', 'AUDITOR')) {
    if (!user.companyIds.length) return 'true';
    params.push(user.companyIds); return `${a}.company_id = ANY($${params.length}::bigint[])`;
  }
  const parts: string[] = [];
  if (hasRole(user, 'A')) { params.push(user.id); parts.push(`${a}.created_by = $${params.length}`); }
  if (hasRole(user, 'B', 'C', 'D')) {
    params.push(user.companyIds); let p = `${a}.company_id = ANY($${params.length}::bigint[])`;
    if (hasRole(user, 'C', 'D') && !hasRole(user, 'B') && user.bankAccountIds) { params.push(user.bankAccountIds); p += ` AND ${a}.bank_account_id = ANY($${params.length}::bigint[])`; }
    parts.push(`(${p})`);
  }
  return parts.length ? `(${parts.join(' OR ')})` : 'false';
}

export async function canSeeCompany(user: SessionUser, companyId: number) {
  if (hasRole(user, 'ADMIN', 'AUDITOR') && !user.companyIds.length) return true;
  return user.companyIds.includes(companyId);
}

// ---------------- segregation of duties ----------------
export interface StageActors { creator: number; b: Set<number>; c: Set<number>; d: Set<number> }
export async function stageActors(db: Db, paymentId: number): Promise<StageActors> {
  const p = await one<{ created_by: number }>('SELECT created_by FROM payment_advises WHERE id=$1', [paymentId], db);
  const rows = await query<{ stage: string; uid: number }>(
    `SELECT 'B' AS stage, approver_id AS uid FROM payment_approvals WHERE payment_id=$1 AND stage='B'
     UNION SELECT 'D', approver_id FROM payment_approvals WHERE payment_id=$1 AND stage='D'
     UNION SELECT 'C', verifier_id FROM document_verifications WHERE payment_id=$1
     UNION SELECT 'C', initiated_by FROM bank_transactions WHERE payment_id=$1
     UNION SELECT 'C', verified_by FROM accounting_entries WHERE payment_id=$1 AND verified_by IS NOT NULL
     UNION SELECT 'C', updated_by FROM accounting_entries WHERE payment_id=$1 AND updated_by IS NOT NULL`, [paymentId], db);
  const s: StageActors = { creator: p!.created_by, b: new Set(), c: new Set(), d: new Set() };
  for (const r of rows) (r.stage === 'B' ? s.b : r.stage === 'C' ? s.c : s.d).add(r.uid);
  return s;
}

/** Throws a friendly error if `user` may not act at `stage` on this payment. Returns a message instead when `soft`. */
export async function checkSod(db: Db, paymentId: number, user: SessionUser, stage: 'B' | 'C' | 'D', soft = false): Promise<string | null> {
  const s = await stageActors(db, paymentId);
  let msg: string | null = null;
  if (s.creator === user.id) {
    msg = stage === 'B' ? 'Payment cannot be approved by the same user who created it.'
      : stage === 'C' ? 'The user who created a Payment Advice cannot verify or process it.'
      : 'Payment cannot be approved by the same user who created it.';
  } else if (stage === 'B') {
    if (s.c.has(user.id) || s.d.has(user.id)) msg = 'Segregation of duties: you have already acted on this payment at a later stage and cannot approve it as B.';
  } else if (stage === 'C') {
    if (s.d.has(user.id)) msg = "Segregation of duties: C cannot perform D's approval and D cannot process the payment.";
    else if (s.b.has(user.id) && !user.sodException) msg = 'Segregation of duties: B cannot perform the C verification for the same payment unless specifically authorised.';
  } else if (stage === 'D') {
    if (s.c.has(user.id)) msg = "Segregation of duties: C cannot perform D's final approval for a payment they processed.";
    else if (s.b.has(user.id)) msg = 'Segregation of duties: a B approver of this payment cannot give the final bank approval.';
  }
  if (msg && !soft) throw forbidden(msg);
  return msg;
}
