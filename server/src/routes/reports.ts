import { Router } from 'express';
import { tx, query } from '../db.js';
import { h, requirePerm, mkCtx } from '../middleware/auth.js';
import { reportList, runReport, reportXlsx, reportPdf } from '../services/reports.js';
import { roleDashboard, managementDashboard } from '../services/dashboard.js';
import { listPayments } from '../services/payments.js';
import { audit } from '../services/audit.js';

export const reportsRouter = Router();
reportsRouter.get('/reports', requirePerm('report.view'), h(async (_req, res) => res.json(reportList())));
reportsRouter.get('/reports/:key', requirePerm('report.view'), h(async (req, res) => res.json(await runReport(req.user!, req.params.key, req.query as any))));
reportsRouter.get('/reports/:key/export.xlsx', requirePerm('report.view'), h(async (req, res) => {
  const buf = await reportXlsx(req.user!, req.params.key, req.query as any);
  await tx((db) => audit(mkCtx(req, db), { action: 'REPORT_EXPORTED', entityType: 'report', entityId: req.params.key, new: { format: 'xlsx', filters: req.query }, remarks: `${req.user!.name} exported report ${req.params.key} to Excel.` }));
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'); res.setHeader('Content-Disposition', `attachment; filename="${req.params.key}.xlsx"`); res.send(buf);
}));
reportsRouter.get('/reports/:key/export.pdf', requirePerm('report.view'), h(async (req, res) => {
  const buf = await reportPdf(req.user!, req.params.key, req.query as any);
  await tx((db) => audit(mkCtx(req, db), { action: 'REPORT_EXPORTED', entityType: 'report', entityId: req.params.key, new: { format: 'pdf', filters: req.query }, remarks: `${req.user!.name} exported report ${req.params.key} to PDF.` }));
  res.setHeader('Content-Type', 'application/pdf'); res.setHeader('Content-Disposition', `attachment; filename="${req.params.key}.pdf"`); res.send(buf);
}));
reportsRouter.get('/dashboard', h(async (req, res) => res.json(await roleDashboard(req.user!))));
reportsRouter.get('/dashboard/management', requirePerm('dashboard.management'), h(async (req, res) => res.json(await managementDashboard(req.user!, req.query as any))));

reportsRouter.get('/search', h(async (req, res) => {
  const q = String(req.query.q ?? '').trim();
  if (q.length < 2) return res.json({ payments: [], vendors: [] });
  const pay = await listPayments(req.user!, { q, page_size: '8', sort: 'updated_at' });
  const vendors = await query(`SELECT id,vendor_code,name FROM vendors WHERE name ILIKE $1 OR vendor_code ILIKE $1 ORDER BY name LIMIT 5`, [`%${q}%`]);
  res.json({ payments: pay.rows, vendors, total: pay.total });
}));

reportsRouter.get('/notifications', h(async (req, res) => {
  const rows = await query(`SELECT id,payment_id,event_code,title,body,link,is_read,created_at FROM notifications WHERE user_id=$1 ORDER BY id DESC LIMIT 60`, [req.user!.id]);
  const unread = (await query<{ n: number }>('SELECT count(*)::int n FROM notifications WHERE user_id=$1 AND NOT is_read', [req.user!.id]))[0].n;
  res.json({ rows, unread });
}));
reportsRouter.post('/notifications/read', h(async (req, res) => {
  const ids: number[] | undefined = req.body?.ids;
  await query(`UPDATE notifications SET is_read=true WHERE user_id=$1 AND ($2::bigint[] IS NULL OR id=ANY($2))`, [req.user!.id, ids ?? null]);
  res.json({ ok: true });
}));
