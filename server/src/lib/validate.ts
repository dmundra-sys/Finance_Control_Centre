import { z } from 'zod';
import { badRequest } from './errors.js';

export function parse<T extends z.ZodTypeAny>(schema: T, data: unknown): z.infer<T> {
  const r = schema.safeParse(data);
  if (!r.success) {
    const issue = r.error.issues[0];
    throw badRequest(issue.message, r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })));
  }
  return r.data;
}
export const optStr = (max = 500) => z.string().trim().max(max).optional().nullable().transform((v) => (v ? v : null));
export const reqStr = (msg: string, max = 500) => z.string({ required_error: msg, invalid_type_error: msg }).trim().min(1, msg).max(max);
export const money = (label: string) => z.coerce.number({ invalid_type_error: `${label} must be a valid number.` }).finite(`${label} must be a valid number.`).min(0, `${label} cannot be negative.`);
export const dateStr = (label: string) => z.string({ required_error: `${label} is required.`, invalid_type_error: `${label} is required.` }).regex(/^\d{4}-\d{2}-\d{2}$/, `${label} is required.`);
export const id = (label: string) => z.coerce.number({ invalid_type_error: `${label} is required.` }).int().positive(`${label} is required.`);
export const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
export const GSTIN_RE = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
export const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/;
export const isEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
