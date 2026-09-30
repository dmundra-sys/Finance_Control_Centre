import bcrypt from 'bcryptjs';
import { pool, query, one, tx } from '../db.js';
import { config } from '../config.js';
import { badRequest, forbidden, AppError } from '../lib/errors.js';
import { randomToken, sha256, encryptText, decryptText } from '../lib/crypto.js';
import { verifyTotp, newTotpSecret, otpauthUri } from '../lib/totp.js';
import { getSetting } from './settings.js';
import { loadUser, type SessionUser } from './access.js';
import { audit, type Ctx } from './audit.js';
import { emailHtml } from './notifications.js';

export interface ClientInfo { ip: string; ua: string }

export async function checkPasswordPolicy(pw: string): Promise<string | null> {
  const p = await getSetting<any>('password_policy');
  if (pw.length < p.min_length) return `Password must be at least ${p.min_length} characters long.`;
  if (p.require_upper && !/[A-Z]/.test(pw)) return 'Password must contain an upper-case letter.';
  if (p.require_lower && !/[a-z]/.test(pw)) return 'Password must contain a lower-case letter.';
  if (p.require_digit && !/\d/.test(pw)) return 'Password must contain a digit.';
  if (p.require_special && !/[^A-Za-z0-9]/.test(pw)) return 'Password must contain a special character.';
  if (pw.length > 128) return 'Password is too long.';
  return null;
}
export const hashPassword = (pw: string) => bcrypt.hash(pw, config.bcryptRounds);

async function logAttempt(userId: number | null, loginId: string, success: boolean, reason: string | null, c: ClientInfo) {
  await pool.query('INSERT INTO login_history(user_id,login_id,success,reason,ip,user_agent) VALUES($1,$2,$3,$4,$5,$6)', [userId, loginId.slice(0, 80), success, reason, c.ip, c.ua]);
}

export async function login(c: ClientInfo, b: { userId: string; password: string; otp?: string; remember?: boolean }) {
  const loginId = (b.userId ?? '').trim();
  if (!loginId || !b.password) throw badRequest('User ID and password are required.');
  const policy = await getSetting<any>('password_policy');
  const u = await one<any>('SELECT * FROM users WHERE lower(login_id)=lower($1)', [loginId]);
  const generic = new AppError(401, 'Invalid User ID or password.', 'INVALID_CREDENTIALS');
  if (!u) { await bcrypt.compare(b.password, '$2a$12$abcdefghijklmnopqrstuuJ2mQ8J3bJ5xk7Ck2r1n1yQyS1p0nU8W'); await logAttempt(null, loginId, false, 'Unknown user', c); throw generic; }
  if (!u.is_active) { await logAttempt(u.id, loginId, false, 'Inactive user', c); throw new AppError(403, 'This account is inactive. Please contact the System Administrator.', 'INACTIVE'); }
  if (u.locked_until && new Date(u.locked_until) > new Date()) {
    await logAttempt(u.id, loginId, false, 'Account locked', c);
    throw new AppError(423, `Account temporarily locked after repeated failed attempts. Try again after ${new Date(u.locked_until).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' })} IST or contact the System Administrator.`, 'LOCKED');
  }
  const ok = await bcrypt.compare(b.password, u.password_hash);
  if (!ok) {
    const attempts = u.failed_attempts + 1;
    const lock = attempts >= policy.max_failed_attempts ? new Date(Date.now() + policy.lockout_minutes * 60000) : null;
    await pool.query('UPDATE users SET failed_attempts=$2, locked_until=$3 WHERE id=$1', [u.id, lock ? 0 : attempts, lock]);
    await logAttempt(u.id, loginId, false, lock ? 'Bad password – account locked' : 'Bad password', c);
    if (lock) throw new AppError(423, `Too many failed attempts. The account is locked for ${policy.lockout_minutes} minutes.`, 'LOCKED');
    throw generic;
  }
  if (u.two_factor_enabled) {
    if (!b.otp) return { requiresOtp: true as const };
    if (!verifyTotp(decryptText(u.two_factor_secret_enc), b.otp)) { await logAttempt(u.id, loginId, false, 'Bad OTP', c); throw new AppError(401, 'Invalid or expired verification code.', 'BAD_OTP'); }
  }
  const sess = await getSetting<any>('session');
  const token = randomToken(32); const csrf = randomToken(24);
  const expires = new Date(Date.now() + (b.remember ? sess.remember_me_days * 86400000 : sess.absolute_hours * 3600000));
  await pool.query('INSERT INTO sessions(id,user_id,csrf_token,remember,ip,user_agent,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7)', [sha256(token), u.id, csrf, !!b.remember, c.ip, c.ua, expires]);
  await pool.query('UPDATE users SET failed_attempts=0, locked_until=NULL, last_login_at=now() WHERE id=$1', [u.id]);
  await logAttempt(u.id, loginId, true, null, c);
  const expired = policy.expiry_days > 0 && Date.now() - new Date(u.password_changed_at).getTime() > policy.expiry_days * 86400000;
  if (expired && !u.must_change_password) await pool.query('UPDATE users SET must_change_password=true WHERE id=$1', [u.id]);
  return { requiresOtp: false as const, token, expires, remember: !!b.remember };
}

export async function validateSession(token: string): Promise<{ user: SessionUser; csrf: string; sessionId: string } | null> {
  const id = sha256(token);
  const s = await one<any>('SELECT * FROM sessions WHERE id=$1 AND revoked_at IS NULL', [id]);
  if (!s) return null;
  const sess = await getSetting<any>('session');
  const idleMs = (s.remember ? sess.remember_idle_hours * 60 : sess.idle_minutes) * 60000;
  const now = Date.now();
  if (new Date(s.expires_at).getTime() < now || new Date(s.last_activity_at).getTime() + idleMs < now) {
    await pool.query('UPDATE sessions SET revoked_at=now() WHERE id=$1', [id]); return null;
  }
  if (now - new Date(s.last_activity_at).getTime() > 30000) await pool.query('UPDATE sessions SET last_activity_at=now() WHERE id=$1', [id]);
  const user = await loadUser(s.user_id);
  const active = await one<any>('SELECT is_active FROM users WHERE id=$1', [s.user_id]);
  if (!user || !active?.is_active) return null;
  return { user, csrf: s.csrf_token, sessionId: id };
}
export const revokeSession = (token: string) => pool.query('UPDATE sessions SET revoked_at=now() WHERE id=$1', [sha256(token)]);
export const revokeUserSessions = (userId: number) => pool.query('UPDATE sessions SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL', [userId]);

export async function changePassword(ctx: Ctx, userId: number, current: string, next: string) {
  const u = await one<any>('SELECT * FROM users WHERE id=$1', [userId], ctx.db);
  if (!u || !(await bcrypt.compare(current, u.password_hash))) throw badRequest('Current password is incorrect.');
  const err = await checkPasswordPolicy(next); if (err) throw badRequest(err);
  if (await bcrypt.compare(next, u.password_hash)) throw badRequest('New password must be different from the current password.');
  await ctx.db.query('UPDATE users SET password_hash=$2, password_changed_at=now(), must_change_password=false, updated_at=now() WHERE id=$1', [userId, await hashPassword(next)]);
  await audit(ctx, { action: 'PASSWORD_CHANGED', entityType: 'user', entityId: userId, remarks: 'User changed own password.' });
}

export async function requestPasswordReset(c: ClientInfo, ident: string) {
  const u = await one<any>('SELECT * FROM users WHERE is_active AND (lower(login_id)=lower($1) OR lower(email)=lower($1))', [ident.trim()]);
  if (!u) return; // never reveal whether the account exists
  const token = randomToken(32);
  await tx(async (db) => {
    await db.query('INSERT INTO password_reset_tokens(user_id,token_hash,expires_at) VALUES($1,$2,now() + interval \'1 hour\')', [u.id, sha256(token)]);
    const link = `${config.appBaseUrl}/reset-password?token=${token}`;
    const html = emailHtml({ title: 'Reset your password', intro: `Hello ${u.name}, use the button below to choose a new password. The link is valid for one hour. If you did not request this, ignore this e-mail.`, rows: [['User ID', u.login_id]], cta: 'Reset password', url: link });
    await db.query(`INSERT INTO notification_outbox(channel,recipient_user_id,to_address,event_code,subject,body,html,status) VALUES('EMAIL',$1,$2,'PASSWORD_RESET','Reset your password',$3,$4,'PENDING')`, [u.id, u.email, `Reset your password: ${link}`, html]);
    await audit({ db, user: { id: u.id, loginId: u.login_id, name: u.name, roleCode: u.role_code }, ip: c.ip, ua: c.ua, now: new Date() }, { action: 'PASSWORD_RESET_REQUESTED', entityType: 'user', entityId: u.id, remarks: 'Password reset link issued.' });
  });
}
export async function resetPassword(ctx: Ctx, token: string, next: string) {
  const t = await one<any>('SELECT * FROM password_reset_tokens WHERE token_hash=$1 AND used_at IS NULL AND expires_at > now()', [sha256(token)], ctx.db);
  if (!t) throw badRequest('This password reset link is invalid or has expired.');
  const err = await checkPasswordPolicy(next); if (err) throw badRequest(err);
  await ctx.db.query('UPDATE users SET password_hash=$2, password_changed_at=now(), must_change_password=false, failed_attempts=0, locked_until=NULL WHERE id=$1', [t.user_id, await hashPassword(next)]);
  await ctx.db.query('UPDATE password_reset_tokens SET used_at=now() WHERE id=$1', [t.id]);
  await ctx.db.query('UPDATE sessions SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL', [t.user_id]);
  const u = await one<any>('SELECT id,login_id,name,role_code FROM users WHERE id=$1', [t.user_id], ctx.db);
  await audit({ ...ctx, user: { id: u.id, loginId: u.login_id, name: u.name, roleCode: u.role_code } }, { action: 'PASSWORD_RESET_COMPLETED', entityType: 'user', entityId: u.id, remarks: 'Password reset via e-mailed link.' });
}

export async function twoFactorSetup(user: SessionUser) {
  const secret = newTotpSecret();
  await pool.query('UPDATE users SET two_factor_secret_enc=$2 WHERE id=$1 AND NOT two_factor_enabled', [user.id, encryptText(secret)]);
  const uri = otpauthUri(secret, user.loginId);
  const QR = (await import('qrcode')).default;
  return { secret, uri, qr: await QR.toDataURL(uri, { margin: 1, width: 220 }) };
}
export async function twoFactorEnable(ctx: Ctx, user: SessionUser, code: string) {
  const u = await one<any>('SELECT * FROM users WHERE id=$1', [user.id], ctx.db);
  if (!u?.two_factor_secret_enc) throw badRequest('Start the two-factor setup first.');
  if (!verifyTotp(decryptText(u.two_factor_secret_enc), code)) throw badRequest('Invalid verification code. Check the time on your phone and try again.');
  await ctx.db.query('UPDATE users SET two_factor_enabled=true WHERE id=$1', [user.id]);
  await audit(ctx, { action: 'TWO_FACTOR_ENABLED', entityType: 'user', entityId: user.id, remarks: 'Two-factor authentication enabled.' });
}
export async function twoFactorDisable(ctx: Ctx, user: SessionUser, password: string) {
  const u = await one<any>('SELECT * FROM users WHERE id=$1', [user.id], ctx.db);
  if (!(await bcrypt.compare(password, u.password_hash))) throw forbidden('Password is incorrect.');
  await ctx.db.query('UPDATE users SET two_factor_enabled=false, two_factor_secret_enc=NULL WHERE id=$1', [user.id]);
  await audit(ctx, { action: 'TWO_FACTOR_DISABLED', entityType: 'user', entityId: user.id, remarks: 'Two-factor authentication disabled.' });
}
export { query };
