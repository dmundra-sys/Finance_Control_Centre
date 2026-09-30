import { pool, query, one, type Db } from '../db.js';
import { encryptText } from '../lib/crypto.js';

export const SETTING_DEFAULTS: Record<string, { value: any; description: string }> = {
  password_policy: {
    description: 'Password rules and login-attempt protection',
    value: { min_length: 10, require_upper: true, require_lower: true, require_digit: true, require_special: true, expiry_days: 90, max_failed_attempts: 5, lockout_minutes: 15 },
  },
  session: {
    description: 'Session timeout',
    value: { idle_minutes: 30, absolute_hours: 12, remember_me_days: 7, remember_idle_hours: 12 },
  },
  documents: {
    description: 'Document upload limits',
    value: { max_file_mb: 10, allowed_extensions: ['pdf', 'jpg', 'jpeg', 'png', 'xls', 'xlsx', 'doc', 'docx'] },
  },
  whatsapp: {
    description: 'WhatsApp Business API provider (credentials are stored encrypted, server-side only)',
    value: { provider: 'MOCK', phone_number_id: '', api_version: 'v20.0', template_name: '', template_language: 'en', webhook_url: '', access_token_enc: '' },
  },
  email: {
    description: 'Outgoing e-mail (SMTP)',
    value: { provider: 'MOCK', host: '', port: 587, secure: false, user: '', pass_enc: '', from_name: 'Payment Approval Workflow', from_email: 'no-reply@example.com' },
  },
  sms: {
    description: 'SMS gateway (future integration)',
    value: { provider: 'MOCK' },
  },
  recovery: {
    description: 'System administrator recovery / contact mobile (never shown publicly)',
    value: { mobile: '9460201308' },
  },
  backup: {
    description: 'Database backup settings',
    value: { enabled: false, time: '02:00', retention_days: 30 },
  },
  bank_integration: {
    description: 'Bank API integration (future-ready). MANUAL = C initiates on the bank portal and records the reference.',
    value: { provider: 'MANUAL' },
  },
  app: {
    description: 'General application settings',
    value: { demo_mode: true, org_name: 'Group Finance', two_factor_required_roles: [] },
  },
};

export const SECRET_FIELDS: Record<string, { plain: string; enc: string }[]> = {
  whatsapp: [{ plain: 'access_token', enc: 'access_token_enc' }],
  email: [{ plain: 'password', enc: 'pass_enc' }],
};

const cache = new Map<string, { at: number; value: any }>();
const TTL = 15_000;

export async function getSetting<T = any>(key: string, db: Db = pool): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL && db === pool) return hit.value as T;
  const row = await one<{ value: any }>('SELECT value FROM system_settings WHERE key=$1', [key], db);
  const def = SETTING_DEFAULTS[key]?.value ?? {};
  const value = { ...def, ...(row?.value ?? {}) };
  cache.set(key, { at: Date.now(), value });
  return value as T;
}
export function clearSettingsCache() { cache.clear(); }

export async function putSetting(key: string, incoming: Record<string, any>, userId: number | null, db: Db = pool) {
  if (!SETTING_DEFAULTS[key]) throw new Error(`Unknown setting ${key}`);
  const current = await getSetting(key, db);
  const next: Record<string, any> = { ...current };
  const secrets = SECRET_FIELDS[key] ?? [];
  for (const [k, v] of Object.entries(incoming)) {
    if (secrets.some((s) => s.enc === k)) continue; // never accept encrypted blobs from clients
    if (secrets.some((s) => s.plain === k)) continue;
    next[k] = v;
  }
  for (const s of secrets) {
    const plain = incoming[s.plain];
    if (typeof plain === 'string' && plain.trim() !== '') next[s.enc] = encryptText(plain.trim());
    if (incoming[`clear_${s.plain}`] === true) next[s.enc] = '';
  }
  await query(
    `INSERT INTO system_settings(key,value,description,updated_by,updated_at) VALUES($1,$2,$3,$4,now())
     ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_by=EXCLUDED.updated_by, updated_at=now()`,
    [key, JSON.stringify(next), SETTING_DEFAULTS[key].description, userId], db);
  cache.delete(key);
  return { before: current, after: next };
}

/** Return a client-safe view: encrypted secrets replaced by has_<field> flags. */
export function publicSetting(key: string, value: any) {
  const out = { ...value };
  for (const s of SECRET_FIELDS[key] ?? []) {
    out[`has_${s.plain}`] = !!out[s.enc];
    delete out[s.enc];
  }
  return out;
}
export function redactForAudit(key: string, value: any) {
  const out = { ...value };
  for (const s of SECRET_FIELDS[key] ?? []) if (out[s.enc]) out[s.enc] = '[ENCRYPTED]';
  return out;
}
