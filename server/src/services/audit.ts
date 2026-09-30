import crypto from 'node:crypto';
import type { PoolClient } from 'pg';
import { pool } from '../db.js';

export interface Actor { id: number; loginId: string; name: string; roleCode: string }
export interface Ctx {
  db: PoolClient;
  user: Actor | null;
  ip: string;
  ua: string;
  now: Date;
}

export function canon(v: any): string {
  if (v === undefined) return 'null';
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
  if (v instanceof Date) return JSON.stringify(v.toISOString());
  return '{' + Object.keys(v).filter((k) => v[k] !== undefined).sort().map((k) => JSON.stringify(k) + ':' + canon(v[k])).join(',') + '}';
}
function hashRow(prev: string, r: { at: Date; user_id: any; action: string; entity_type: any; entity_id: any; payment_id: any; old_value: any; new_value: any; remarks: any }) {
  return crypto.createHash('sha256').update(canon([prev, r.at, r.user_id ?? null, r.action, r.entity_type ?? null, r.entity_id ?? null, r.payment_id ?? null, r.old_value ?? null, r.new_value ?? null, r.remarks ?? null])).digest('hex');
}

export interface AuditEvent {
  action: string;
  entityType?: string;
  entityId?: string | number;
  paymentId?: number | null;
  old?: any;
  new?: any;
  remarks?: string | null;
}

/** Append an entry to the tamper-evident audit trail (hash chained). Must run inside a transaction. */
export async function audit(ctx: Ctx, e: AuditEvent) {
  await ctx.db.query('SELECT pg_advisory_xact_lock(90210)');
  const last = await ctx.db.query('SELECT hash FROM audit_logs ORDER BY id DESC LIMIT 1');
  const prev = last.rows[0]?.hash ?? 'GENESIS';
  const row = {
    at: ctx.now, user_id: ctx.user?.id ?? null, action: e.action, entity_type: e.entityType ?? null,
    entity_id: e.entityId != null ? String(e.entityId) : null, payment_id: e.paymentId ?? null,
    old_value: e.old ?? null, new_value: e.new ?? null, remarks: e.remarks ?? null,
  };
  const hash = hashRow(prev, row);
  await ctx.db.query(
    `INSERT INTO audit_logs(at,user_id,user_login,user_name,role_code,action,entity_type,entity_id,payment_id,ip,user_agent,old_value,new_value,remarks,prev_hash,hash)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
    [row.at, row.user_id, ctx.user?.loginId ?? null, ctx.user?.name ?? 'System', ctx.user?.roleCode ?? null, row.action, row.entity_type, row.entity_id, row.payment_id,
      ctx.ip, ctx.ua, row.old_value == null ? null : JSON.stringify(row.old_value), row.new_value == null ? null : JSON.stringify(row.new_value), row.remarks, prev, hash]);
}

/** Recompute the hash chain and report the first inconsistency, if any. */
export async function verifyAuditChain(): Promise<{ ok: boolean; checked: number; brokenAtId?: number }> {
  const { rows } = await pool.query('SELECT * FROM audit_logs ORDER BY id ASC');
  let prev = 'GENESIS';
  for (const r of rows) {
    const expected = hashRow(prev, { ...r, at: r.at });
    if (r.prev_hash !== prev || r.hash !== expected) return { ok: false, checked: rows.length, brokenAtId: Number(r.id) };
    prev = r.hash;
  }
  return { ok: true, checked: rows.length };
}

/** Compact diff of two flat objects – only changed keys. */
export function diff(oldObj: Record<string, any>, newObj: Record<string, any>, keys?: string[]) {
  const o: Record<string, any> = {}; const n: Record<string, any> = {};
  for (const k of keys ?? Object.keys(newObj)) {
    const a = oldObj[k]; const b = newObj[k];
    if (b === undefined) continue;
    if (canon(a ?? null) !== canon(b ?? null)) { o[k] = a ?? null; n[k] = b ?? null; }
  }
  return { old: o, new: n, changed: Object.keys(n) };
}
