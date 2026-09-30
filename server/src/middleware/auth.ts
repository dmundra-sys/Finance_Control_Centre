import type { Request, Response, NextFunction, RequestHandler } from 'express';
import type { PoolClient } from 'pg';
import { config } from '../config.js';
import { tx } from '../db.js';
import { unauthorized, forbidden, AppError } from '../lib/errors.js';
import { timingSafeEq } from '../lib/crypto.js';
import { validateSession } from '../services/auth.js';
import { can, type SessionUser } from '../services/access.js';
import type { Ctx } from '../services/audit.js';
import { dispatchSafely } from '../services/notifications.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express { interface Request { user?: SessionUser; csrf?: string; sessionId?: string } }
}

export const h = (fn: (req: Request, res: Response, next: NextFunction) => Promise<any>): RequestHandler => (req, res, next) => { fn(req, res, next).catch(next); };

export const clientIp = (req: Request) => (req.ip ?? req.socket.remoteAddress ?? '').replace('::ffff:', '');

export const requireAuth: RequestHandler = h(async (req, _res, next) => {
  const token = req.cookies?.[config.sessionCookie];
  if (!token) throw unauthorized();
  const s = await validateSession(token);
  if (!s) throw unauthorized('Your session has expired. Please sign in again.');
  req.user = s.user; req.csrf = s.csrf; req.sessionId = s.sessionId;
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    const hdr = req.header('x-csrf-token');
    if (!hdr || !timingSafeEq(hdr, s.csrf)) throw new AppError(403, 'Security check failed (CSRF). Please refresh the page and try again.', 'CSRF');
  }
  if (s.user.mustChangePassword && !req.path.startsWith('/auth/') && !req.originalUrl.startsWith('/api/auth/')) throw new AppError(403, 'You must change your password before continuing.', 'PASSWORD_CHANGE_REQUIRED');
  next();
});

export const requirePerm = (perm: string): RequestHandler => h(async (req, _res, next) => {
  if (!req.user || !(await can(req.user, perm))) throw forbidden();
  next();
});

export function mkCtx(req: Request, db: PoolClient): Ctx {
  const u = req.user!;
  return { db, user: { id: u.id, loginId: u.loginId, name: u.name, roleCode: u.roleCode }, ip: clientIp(req), ua: (req.header('user-agent') ?? '').slice(0, 300), now: new Date() };
}

/** Run a unit of work in a transaction with an audit context, then flush notifications. */
export async function work<T>(req: Request, fn: (ctx: Ctx, user: SessionUser) => Promise<T>): Promise<T> {
  const out = await tx((db) => fn(mkCtx(req, db), req.user!));
  await dispatchSafely();
  return out;
}
