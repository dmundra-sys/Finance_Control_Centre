/** Usage:  npm run create-admin -- <login_id> "<Full Name>" <email> <password> [mobile]
 *  Creates (or resets) a System Administrator with super-admin rights. */
import { pool, tx } from '../db.js';
import { migrate } from './migrate.js';
import { createUser } from '../services/masters.js';
import { audit } from '../services/audit.js';

const [loginId, name, email, password, mobile] = process.argv.slice(2);
if (!loginId || !name || !email || !password) { console.error('Usage: npm run create-admin -- <login_id> "<Full Name>" <email> <password> [mobile]'); process.exit(1); }

await migrate(() => {});
await tx(async (db) => {
  const ctx = { db, user: null, ip: 'cli', ua: 'create-admin script', now: new Date() };
  const actor: any = { isSuperAdmin: true };
  const { id } = await createUser(ctx as any, actor, { login_id: loginId, password, name, email, mobile, role_code: 'ADMIN', is_super_admin: true, can_view_full_account: true, must_change_password: true }) as any;
  await audit(ctx as any, { action: 'ADMIN_BOOTSTRAPPED', entityType: 'user', entityId: id, remarks: `Super-admin ${loginId} created from the command line.` });
  console.log(`Created System Administrator "${loginId}". The password must be changed at first login.`);
});
await pool.end();
