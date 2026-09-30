import express, { type ErrorRequestHandler } from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import fs from 'node:fs';
import path from 'node:path';
import { ZodError } from 'zod';
import { config } from './config.js';
import { pool } from './db.js';
import { AppError } from './lib/errors.js';
import { requireAuth } from './middleware/auth.js';
import { authRouter } from './routes/auth.js';
import { paymentsRouter, documentsRouter } from './routes/payments.js';
import { mastersRouter } from './routes/masters.js';
import { adminRouter } from './routes/admin.js';
import { reportsRouter } from './routes/reports.js';
import { dispatchSafely } from './services/notifications.js';
import { getSetting } from './services/settings.js';
import { runBackup, pruneBackups } from './services/masters.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  if (config.trustProxy) app.set('trust proxy', 1);
  app.use(helmet({
    contentSecurityPolicy: { directives: { defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'", "'unsafe-inline'"], imgSrc: ["'self'", 'data:', 'blob:'], connectSrc: ["'self'"],
      frameSrc: ["'self'", 'blob:'], objectSrc: ["'self'", 'blob:'], fontSrc: ["'self'", 'data:'], frameAncestors: ["'self'"], baseUri: ["'self'"], formAction: ["'self'"] } },
    frameguard: { action: 'sameorigin' }, hsts: config.isProd, crossOriginEmbedderPolicy: false,
  }));
  app.use(cookieParser());
  app.use(express.json({ limit: '1mb' }));

  app.get('/api/health', async (_req, res) => { try { await pool.query('SELECT 1'); res.json({ ok: true }); } catch { res.status(503).json({ ok: false }); } });
  app.use('/api/auth', authRouter);
  app.use('/api/payments', requireAuth, paymentsRouter);
  app.use('/api/documents', requireAuth, documentsRouter);
  app.use('/api/admin', requireAuth, adminRouter);
  app.use('/api', requireAuth, mastersRouter);
  app.use('/api', requireAuth, reportsRouter);
  app.use('/api', (_req, res) => { res.status(404).json({ error: 'Endpoint not found.', code: 'NOT_FOUND' }); });

  // built frontend (single-container deployment)
  if (fs.existsSync(path.join(config.webDist, 'index.html'))) {
    app.use(express.static(config.webDist, { index: false, maxAge: '1h' }));
    app.get('*', (_req, res) => res.sendFile(path.join(config.webDist, 'index.html')));
  }

  const onError: ErrorRequestHandler = (err, req, res, _next) => {
    if (err instanceof AppError) return res.status(err.status).json({ error: err.message, code: err.code, details: err.details });
    if (err instanceof ZodError) return res.status(400).json({ error: err.issues[0]?.message ?? 'Invalid input.', code: 'BAD_REQUEST', details: err.issues });
    if (err?.code === '23505') return res.status(409).json({ error: 'This record already exists (duplicate value).', code: 'CONFLICT' });
    if (err?.code === '42501') return res.status(403).json({ error: 'This record is protected and cannot be modified or deleted.', code: 'IMMUTABLE' });
    if (err?.code === '23503') return res.status(409).json({ error: 'This record is referenced elsewhere and cannot be changed this way.', code: 'CONFLICT' });
    if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: 'Malformed request body.', code: 'BAD_REQUEST' });
    console.error(`[error] ${req.method} ${req.originalUrl}`, err);
    res.status(500).json({ error: 'Something went wrong on the server. Please try again or contact the System Administrator.', code: 'SERVER_ERROR' });
  };
  app.use(onError);
  return app;
}

export function startBackground() {
  setInterval(() => { void dispatchSafely(); }, 30_000).unref();
  setInterval(async () => {
    try {
      const cfg = await getSetting<any>('backup'); if (!cfg.enabled) return;
      const now = new Date().toLocaleTimeString('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' });
      if (now === cfg.time) { await runBackup(null, 'scheduler'); await pruneBackups(cfg.retention_days); }
    } catch (e) { console.error('[backup]', e); }
  }, 60_000).unref();
}
