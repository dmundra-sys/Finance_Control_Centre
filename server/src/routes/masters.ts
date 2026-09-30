import { Router } from 'express';
import { z } from 'zod';
import { query, one } from '../db.js';
import { h, requirePerm, work } from '../middleware/auth.js';
import * as M from '../services/masters.js';
import { hasRole } from '../services/access.js';
import { parse } from '../lib/validate.js';
import { notFound, badRequest } from '../lib/errors.js';

export const mastersRouter = Router();
const num = (v: any) => { const n = Number(v); if (!Number.isInteger(n) || n <= 0) throw badRequest('Invalid identifier.'); return n; };

// ---- companies
mastersRouter.get('/companies', requirePerm('master.view'), h(async (req, res) => res.json(await M.listCompanies(req.user!))));
mastersRouter.post('/companies', requirePerm('admin.access'), h(async (req, res) => res.status(201).json(await work(req, (ctx) => M.saveCompany(ctx, null, req.body)))));
mastersRouter.put('/companies/:id', requirePerm('admin.access'), h(async (req, res) => res.json(await work(req, (ctx) => M.saveCompany(ctx, num(req.params.id), req.body)))));

// ---- bank accounts (numbers masked; reveal is audited and flag-controlled)
mastersRouter.get('/bank-accounts', requirePerm('master.view'), h(async (req, res) => res.json(await M.listBankAccounts(req.user!))));
mastersRouter.post('/bank-accounts', requirePerm('admin.access'), h(async (req, res) => res.status(201).json(await work(req, (ctx) => M.saveBankAccount(ctx, null, req.body)))));
mastersRouter.put('/bank-accounts/:id', requirePerm('admin.access'), h(async (req, res) => res.json(await work(req, (ctx) => M.saveBankAccount(ctx, num(req.params.id), req.body)))));
mastersRouter.post('/bank-accounts/:id/reveal', requirePerm('master.view'), h(async (req, res) => res.json(await work(req, (ctx, u) => M.revealAccount(ctx, u, 'bank', num(req.params.id))))));

// ---- vendors
mastersRouter.get('/vendors', requirePerm('vendor.view'), h(async (req, res) => res.json(await M.listVendors(req.query as any))));
mastersRouter.post('/vendors', requirePerm('vendor.manage'), h(async (req, res) => res.status(201).json(await work(req, (ctx) => M.createVendor(ctx, req.body)))));
mastersRouter.put('/vendors/:id', requirePerm('vendor.manage'), h(async (req, res) => res.json(await work(req, (ctx) => M.updateVendor(ctx, num(req.params.id), req.body)))));
mastersRouter.get('/vendors/bank-requests', requirePerm('vendor.view'), h(async (req, res) => res.json(await M.vendorBankRequests(String(req.query.status ?? 'PENDING')))));
mastersRouter.get('/vendors/:id/history', requirePerm('vendor.view'), h(async (req, res) => res.json(await M.vendorHistory(num(req.params.id)))));
mastersRouter.post('/vendors/:id/bank-change', requirePerm('vendor.manage'), h(async (req, res) => res.status(201).json(await work(req, (ctx) => M.requestBankChange(ctx, num(req.params.id), req.body)))));
mastersRouter.post('/vendors/bank-requests/:rid/decision', requirePerm('vendor.authorise_bank'), h(async (req, res) => {
  const b = parse(z.object({ approve: z.boolean(), remarks: z.string().optional() }), req.body);
  await work(req, (ctx, u) => M.decideBankChange(ctx, u, num(req.params.rid), b.approve, b.remarks)); res.json({ ok: true });
}));
mastersRouter.post('/vendors/:id/reveal', requirePerm('vendor.view'), h(async (req, res) => res.json(await work(req, (ctx, u) => M.revealAccount(ctx, u, 'vendor', num(req.params.id))))));

// ---- lists (ledger, cost centre, ...) & modes & statuses
mastersRouter.get('/master-data/:category', h(async (req, res) => res.json(await query('SELECT * FROM master_data WHERE category=$1 ORDER BY sort_order,name', [req.params.category.toUpperCase()]))));
mastersRouter.post('/master-data/:category', requirePerm('admin.access'), h(async (req, res) => res.status(201).json(await work(req, (ctx) => M.saveMasterData(ctx, req.params.category.toUpperCase(), null, req.body)))));
mastersRouter.put('/master-data/:category/:id', requirePerm('admin.access'), h(async (req, res) => res.json(await work(req, (ctx) => M.saveMasterData(ctx, req.params.category.toUpperCase(), num(req.params.id), req.body)))));
mastersRouter.get('/payment-modes', h(async (_req, res) => res.json(await query('SELECT * FROM payment_modes ORDER BY sort_order'))));
mastersRouter.post('/payment-modes', requirePerm('admin.access'), h(async (req, res) => { await work(req, (ctx) => M.savePaymentMode(ctx, null, req.body)); res.status(201).json({ ok: true }); }));
mastersRouter.put('/payment-modes/:code', requirePerm('admin.access'), h(async (req, res) => { await work(req, (ctx) => M.savePaymentMode(ctx, req.params.code, req.body)); res.json({ ok: true }); }));
mastersRouter.get('/statuses', h(async (_req, res) => res.json(await query('SELECT * FROM status_config ORDER BY sort_order'))));
mastersRouter.get('/users-lookup', h(async (_req, res) => res.json(await query('SELECT id,name,role_code FROM users WHERE is_active ORDER BY name'))));
void hasRole; void one; void notFound;
