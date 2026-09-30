import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const serverRoot = path.resolve(here, '..');

const env = process.env.NODE_ENV ?? 'development';
const isProd = env === 'production';

function must(name: string, devFallback: string): string {
  const v = process.env[name];
  if (v) return v;
  if (isProd) throw new Error(`Missing required environment variable ${name}`);
  return devFallback;
}

export const config = {
  env,
  isProd,
  port: Number(process.env.PORT ?? 4000),
  databaseUrl: process.env.DATABASE_URL ?? 'postgres://pawf:pawf_dev_pw@localhost:5432/pawf',
  /** 32-byte key (hex or base64) used for AES-256-GCM encryption of bank numbers, 2FA secrets, provider tokens, stored files */
  dataKey: must('DATA_ENCRYPTION_KEY', '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'),
  storageDir: path.resolve(process.env.STORAGE_DIR ?? path.join(serverRoot, 'storage')),
  backupDir: path.resolve(process.env.BACKUP_DIR ?? path.join(serverRoot, 'backups')),
  appBaseUrl: (process.env.APP_BASE_URL ?? process.env.RENDER_EXTERNAL_URL ?? 'http://localhost:4000').replace(/\/$/, ''),
  cookieSecure: (process.env.COOKIE_SECURE ?? (isProd ? 'true' : 'false')) === 'true',
  trustProxy: process.env.TRUST_PROXY === 'true',
  showDemoLogins: (process.env.SHOW_DEMO_LOGINS ?? (isProd ? 'false' : 'true')) === 'true',
  sessionCookie: 'pawf_sid',
  webDist: path.resolve(process.env.WEB_DIST ?? path.join(serverRoot, '..', 'web', 'dist')),
  fontsDir: path.join(serverRoot, 'assets', 'fonts'),
  sqlDir: path.join(here, 'sql'),
  bcryptRounds: Number(process.env.BCRYPT_ROUNDS ?? 12),
};
