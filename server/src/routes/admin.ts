import { Router } from 'express';
import { z } from 'zod';
import fs from 'node:fs';
import path from 'node:path';
import { query, one, pool } from '../db.js';
import { config } from '../config.js';
import { h, requirePerm, requireAuth, work } from '../middleware/auth.js';
import * as M from '../services/masters.js';
import { getSetting, putSetting, publicSetting, redactForAudit, SETTING_DEFAULTS } from '../services/settings.js';
import { audit, verifyAuditChain } from '../services/audit.js';
import { parse } from '../lib/validate.js';
import { badRequest, forbidden, notFound } from '../lib/errors.js';
import { sendWhatsApp, sendEmail } from '../services/providers/messaging.js';
import { dispatchSafely } from '../services/notifications.js';
import { NOTIFICATION_EVENTS } from '../constants.js';

export const adminRouter = Router();
const num = (v: any) => { const n = Number(v); if (!Number.isInteger(n) || n <= 0) throw badRequest('Invalid identifier.'); return n; };
// audit trail is readable by anyone holding audit.view (Auditor) — declared before the admin-only gate
adminRouter.get('/audit-logs', requirePerm('audit.view'), h(async (req, res) => {
  const p: any[] = []; const w: string[] = ['true']; const q = req.query as any;
  if (q.user) { p.push(`%${q.user}%`); w.push(`a.user_name ILIKE $${p.length}`); }
  if (q.action) { p.push(`%${q.action}%`); w.push(`a.action ILIKE $${p.length}`); }
  if (q.q) { p.push(`%${q.q}%`); w.push(`(a.remarks ILIKE $${p.length} OR pa.pa_number ILIKE $${p.length} OR a.entity_id ILIKE $${p.length})`); }
  if (q.date_from) { p.push(q.date_from); w.push(`(a.at AT TIME ZONE 'Asia/Kolkata')::date >= $${p.length}::date`); }
  if (q.date_to) { p.push(q.date_to); w.push(`(a.at AT TIME ZONE 'Asia/Kolkata')::date <= $${p.length}::date`); }
  const page = Math.max(1, Number(q.page ?? 1)); const size = 50;
  const total = (await one<{ n: number }>(`SELECT count(*)::int n FROM audit_logs a LEFT JOIN payment_advises pa ON pa.id=a.payment_id WHERE ${w.join(' AND ')}`, p))!.n;
  const rows = await query(`SELECT a.id,a.at,a.user_name,a.user_login,a.role_code,a.action,a.entity_type,a.entity_id,pa.pa_number,a.ip,a.user_agent,a.old_value,a.new_value,a.remarks
     FROM audit_logs a LEFT JOIN payment_advises pa ON pa.id=a.payment_id WHERE ${w.join(' AND ')} ORDER BY a.id DESC LIMIT ${size} OFFSET ${(page - 1) * size}`, p);
  res.json({ rows, total, page, pageSize: size });
}));
adminRouter.get('/audit-verify', requirePerm('audit.view'), h(async (_req, res) => res.json(await verifyAuditChain())));
adminRouter.use(requirePerm('admin.access'));

// users
adminRouter.get('/users', h(async (_req, res) => res.json(await M.listUsers())));
adminRouter.post('/users', h(async (req, res) => res.status(201).json(await work(req, (ctx, u) => M.createUser(ctx, u, req.body)))));
adminRouter.put('/users/:id', h(async (req, res) => { await work(req, (ctx, u) => M.updateUser(ctx, u, num(req.params.id), req.body)); res.json({ ok: true }); }));
adminRouter.post('/users/:id/reset-password', h(async (req, res) => { const b = parse(z.object({ password: z.string().min(1, 'Temporary password is required.') }), req.body); await work(req, (ctx) => M.adminResetPassword(ctx, num(req.params.id), b.password)); res.json({ ok: true }); }));
adminRouter.post('/users/:id/unlock', h(async (req, res) => { await work(req, (ctx) => M.unlockUser(ctx, num(req.params.id))); res.json({ ok: true }); }));

// roles & permissions
adminRouter.get('/roles', h(async (_req, res) => res.json(await M.rolesWithPermissions())));
adminRouter.put('/roles/:code/permissions', h(async (req, res) => { const b = parse(z.object({ permissions: z.array(z.string()) }), req.body); await work(req, (ctx) => M.setRolePermissions(ctx, req.params.code, b.permissions)); res.json({ ok: true }); }));

// approval matrix
adminRouter.get('/approval-matrix', h(async (_req, res) => res.json(await query(`SELECT m.*, c.short_name AS company_short, b.bank_name FROM approval_matrix m LEFT JOIN companies c ON c.id=m.company_id LEFT JOIN bank_accounts b ON b.id=m.bank_account_id ORDER BY m.sort_order, m.min_amount`))));
adminRouter.post('/approval-matrix', h(async (req, res) => res.status(201).json(await work(req, (ctx) => M.saveMatrix(ctx, null, req.body)))));
adminRouter.put('/approval-matrix/:id', h(async (req, res) => res.json(await work(req, (ctx) => M.saveMatrix(ctx, num(req.params.id), req.body)))));
adminRouter.post('/approval-matrix/preview', h(async (req, res) => {
  const b = parse(z.object({ company_id: z.coerce.number(), bank_account_id: z.coerce.number(), payment_type: z.string(), department: z.string().optional().nullable(), net_payable: z.coerce.number() }), req.body);
  res.json(await (await import('../services/matrix.js')).resolvePlan(b));
}));

// notification templates, statuses
adminRouter.get('/notification-templates', h(async (_req, res) => res.json({ templates: await query('SELECT * FROM notification_templates ORDER BY event_code, channel'), events: NOTIFICATION_EVENTS })));
adminRouter.put('/notification-templates/:id', h(async (req, res) => { await work(req, (ctx) => M.saveTemplate(ctx, num(req.params.id), req.body)); res.json({ ok: true }); }));
adminRouter.put('/statuses/:code', h(async (req, res) => { await work(req, (ctx) => M.saveStatusConfig(ctx, req.params.code, req.body)); res.json({ ok: true }); }));

// settings (secrets never leave the server)
adminRouter.get('/settings', h(async (req, res) => {
  const out: any = {};
  for (const k of Object.keys(SETTING_DEFAULTS)) { if (k === 'recovery') continue; out[k] = { description: SETTING_DEFAULTS[k].description, value: publicSetting(k, await getSetting(k)) }; }
  res.json(out);
}));
adminRouter.put('/settings/:key', h(async (req, res) => {
  const key = req.params.key; if (!SETTING_DEFAULTS[key] || key === 'recovery') throw notFound('Unknown setting.');
  if (key === 'password_policy') parse(z.object({ min_length: z.coerce.number().int().min(8).max(64) }).passthrough(), req.body);
  if (key === 'session') parse(z.object({ idle_minutes: z.coerce.number().int().min(5).max(480) }).passthrough(), req.body);
  if (key === 'documents') parse(z.object({ max_file_mb: z.coerce.number().min(1).max(50) }).passthrough(), req.body);
  await work(req, async (ctx, u) => {
    const r = await putSetting(key, req.body, u.id, ctx.db);
    await audit(ctx, { action: 'SETTING_CHANGED', entityType: 'setting', entityId: key, old: redactForAudit(key, r.before), new: redactForAudit(key, r.after) });
  });
  res.json({ ok: true });
}));
adminRouter.post('/settings/test-message', h(async (req, res) => {
  const b = parse(z.object({ channel: z.enum(['WHATSAPP', 'EMAIL']), to: z.string().min(3, 'Enter a recipient.') }), req.body);
  const r = b.channel === 'WHATSAPP'
    ? await sendWhatsApp(await getSetting('whatsapp'), { to: b.to, text: 'Test message from Payment Approval & Banking Workflow.', vars: {} })
    : await sendEmail(await getSetting('email'), { to: b.to, subject: 'Test e-mail – Payment Approval Workflow', text: 'This is a test e-mail.', html: '<p>This is a test e-mail from Payment Approval &amp; Banking Workflow.</p>' });
  res.json(r);
}));

// recovery contact (super-admin only, never public)
adminRouter.get('/recovery', h(async (req, res) => res.json({ mobile: (await getSetting<any>('recovery')).mobile, can_change: req.user!.isSuperAdmin })));
adminRouter.put('/recovery', h(async (req, res) => { const b = parse(z.object({ mobile: z.string(), password: z.string() }), req.body); await work(req, (ctx, u) => M.changeRecoveryMobile(ctx, u, b.mobile, b.password)); res.json({ ok: true }); }));

// outbox & backups & logs
adminRouter.get('/outbox', h(async (req, res) => {
  const p: any[] = []; const w: string[] = ['true'];
  if (req.query.channel) { p.push(req.query.channel); w.push(`o.channel=$${p.length}`); }
  res.json(await query(`SELECT o.id,o.channel,o.to_address,o.event_code,o.subject,o.body,o.status,o.attempts,o.provider,o.provider_ref,o.error,o.created_at,o.sent_at,u.name AS recipient, pa.pa_number
     FROM notification_outbox o LEFT JOIN users u ON u.id=o.recipient_user_id LEFT JOIN payment_advises pa ON pa.id=o.payment_id WHERE ${w.join(' AND ')} ORDER BY o.id DESC LIMIT 200`, p));
}));
adminRouter.post('/outbox/flush', h(async (_req, res) => { await dispatchSafely(); res.json({ ok: true }); }));
adminRouter.get('/backups', h(async (_req, res) => res.json({ files: await M.listBackups(), dir: config.backupDir })));
adminRouter.post('/backups', h(async (req, res) => res.json(await work(req, (ctx, u) => M.runBackup(ctx, u.name)))));
adminRouter.get('/backups/:file', h(async (req, res) => {
  const f = path.basename(req.params.file); const abs = path.join(config.backupDir, f);
  if (!f.endsWith('.dump') || !fs.existsSync(abs)) throw notFound('Backup not found.');
  await work(req, (ctx, u) => audit(ctx, { action: 'BACKUP_DOWNLOADED', entityType: 'backup', entityId: f, remarks: `${u.name} downloaded backup ${f}.` }));
  res.download(abs);
}));
adminRouter.get('/login-history', h(async (_req, res) => res.json(await query(`SELECT l.id,l.at,l.login_id,l.success,l.reason,l.ip,l.user_agent,u.name FROM login_history l LEFT JOIN users u ON u.id=l.user_id ORDER BY l.id DESC LIMIT 200`))));
void pool; void forbidden; void requireAuth;
