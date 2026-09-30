import crypto from 'node:crypto';
import { config } from '../config.js';

function keyBytes(): Buffer {
  const k = config.dataKey.trim();
  if (/^[0-9a-fA-F]{64}$/.test(k)) return Buffer.from(k, 'hex');
  const b = Buffer.from(k, 'base64');
  if (b.length === 32) return b;
  return crypto.createHash('sha256').update(k).digest();
}
const KEY = keyBytes();

export function encryptBuffer(plain: Buffer): Buffer {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const ct = Buffer.concat([c.update(plain), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), ct]);
}
export function decryptBuffer(blob: Buffer): Buffer {
  const iv = blob.subarray(0, 12);
  const tag = blob.subarray(12, 28);
  const d = crypto.createDecipheriv('aes-256-gcm', KEY, iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(blob.subarray(28)), d.final()]);
}
export function encryptText(plain: string): string {
  return 'v1:' + encryptBuffer(Buffer.from(plain, 'utf8')).toString('base64');
}
export function decryptText(enc: string): string {
  if (!enc.startsWith('v1:')) throw new Error('Unsupported ciphertext');
  return decryptBuffer(Buffer.from(enc.slice(3), 'base64')).toString('utf8');
}
export const sha256 = (s: string | Buffer) => crypto.createHash('sha256').update(s).digest('hex');
export const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');
export const timingSafeEq = (a: string, b: string) => {
  const A = Buffer.from(a); const B = Buffer.from(b);
  return A.length === B.length && crypto.timingSafeEqual(A, B);
};
export const maskAccount = (last4?: string | null) => (last4 ? `XXXX XXXX ${last4}` : '—');
