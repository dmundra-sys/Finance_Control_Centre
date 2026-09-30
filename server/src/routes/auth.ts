import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { config } from '../config.js';
import { query, tx } from '../db.js';
import { h, requireAuth, clientIp, work, mkCtx } from '../middleware/auth.js';
import * as auth from '../services/auth.js';
import { parse } from '../lib/validate.js';
import { userPermissions } from '../services/access.js';
import { getSetting } from '../services/settings.js';
import { audit } from '../services/audit.js';
import { dispatchSafely } from '../services/notifications.js';

export const authRouter = Router();
const limiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: config.isProd ? 30 : 500, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many attempts from this address. Please wait a few minutes and try again.', code: 'RATE_LIMIT' } });

authRouter.get('/public-config', h(async (_req, res) => {
  const out: any = { demoLogins: [] };
  if (config.showDemoLogins) {
    const app = await getSetting<any>('app');
    if (app.demo_mode) out.demoLogins = await query(`SELECT login_id, name, role_code FROM users WHERE is_demo AND is_active ORDER BY role_code, login_id`);
    out.demoPassword = process.env.DEMO_PASSWORD || 'Demo@12345';
  }
  res.json(out);
}));

authRouter.post('/login', limiter, h(async (req, res) => {
  const body = parse(z.object({ userId: z.string().min(1, 'User ID is required.'), password: z.string().min(1, 'Password is required.'), otp: z.string().optional(), remember: z.boolean().optional() }), req.body);
  const r = await auth.login({ ip: clientIp(req), ua: (req.header('user-agent') ?? '').slice(0, 300) }, body);
  if (r.requiresOtp) return res.json({ requiresOtp: true });
  res.cookie(config.sessionCookie, r.token, { httpOnly: true, sameSite: 'strict', secure: config.cookieSecure, path: '/', ...(r.remember ? { expires: r.expires } : {}) });
  res.json({ ok: true });
}));

authRouter.post('/logout', h(async (req, res) => {
  const t = req.cookies?.[config.sessionCookie]; if (t) await auth.revokeSession(t);
  res.clearCookie(config.sessionCookie, { path: '/' }); res.json({ ok: true });
}));

authRouter.post('/forgot', limiter, h(async (req, res) => {
  const b = parse(z.object({ identifier: z.string().min(1, 'Enter your User ID or e-mail address.') }), req.body);
  await auth.requestPasswordReset({ ip: clientIp(req), ua: req.header('user-agent') ?? '' }, b.identifier);
  await dispatchSafely();
  res.json({ ok: true, message: 'If the account exists, a password reset link has been sent to the registered e-mail address.' });
}));
authRouter.post('/reset', limiter, h(async (req, res) => {
  const b = parse(z.object({ token: z.string().min(10), password: z.string().min(1, 'Password is required.') }), req.body);
  await tx((db) => auth.resetPassword({ db, user: null, ip: clientIp(req), ua: req.header('user-agent') ?? '', now: new Date() }, b.token, b.password));
  res.json({ ok: true });
}));

authRouter.get('/me', requireAuth, h(async (req, res) => {
  const u = req.user!;
  const [permissions, app, session, statuses, unread] = await Promise.all([
    userPermissions(u), getSetting<any>('app'), getSetting<any>('session'),
    query('SELECT code,label,color,sort_order FROM status_config ORDER BY sort_order'),
    query<{ n: number }>('SELECT count(*)::int n FROM notifications WHERE user_id=$1 AND NOT is_read', [u.id]),
  ]);
  res.json({ user: { id: u.id, loginId: u.loginId, name: u.name, email: u.email, mobile: u.mobile, employeeCode: u.employeeCode, roleCode: u.roleCode, roles: u.roles, isSuperAdmin: u.isSuperAdmin,
      isSeniorApprover: u.isSeniorApprover, canViewFullAccount: u.canViewFullAccount, canOverrideDuplicate: u.canOverrideDuplicate, twoFactorEnabled: u.twoFactorEnabled, mustChangePassword: u.mustChangePassword },
    permissions, csrfToken: req.csrf, app: { demoMode: app.demo_mode, orgName: app.org_name }, idleMinutes: session.idle_minutes, statuses, unread: unread[0].n });
}));

authRouter.post('/change-password', requireAuth, h(async (req, res) => {
  const b = parse(z.object({ current: z.string().min(1, 'Current password is required.'), next: z.string().min(1, 'New password is required.') }), req.body);
  await work(req, (ctx, u) => auth.changePassword(ctx, u.id, b.current, b.next));
  res.json({ ok: true });
}));
authRouter.post('/2fa/setup', requireAuth, h(async (req, res) => res.json(await auth.twoFactorSetup(req.user!))));
authRouter.post('/2fa/enable', requireAuth, h(async (req, res) => { const b = parse(z.object({ code: z.string().min(6, 'Enter the 6-digit code.') }), req.body); await work(req, (ctx, u) => auth.twoFactorEnable(ctx, u, b.code)); res.json({ ok: true }); }));
authRouter.post('/2fa/disable', requireAuth, h(async (req, res) => { const b = parse(z.object({ password: z.string().min(1) }), req.body); await work(req, (ctx, u) => auth.twoFactorDisable(ctx, u, b.password)); res.json({ ok: true }); }));
authRouter.get('/sessions', requireAuth, h(async (req, res) => res.json(await query(`SELECT created_at,last_activity_at,ip,user_agent,(id=$2) AS current FROM sessions WHERE user_id=$1 AND revoked_at IS NULL AND expires_at>now() ORDER BY last_activity_at DESC`, [req.user!.id, req.sessionId]))));
void mkCtx; void audit;
