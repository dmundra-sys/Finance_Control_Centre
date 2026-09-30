import { createApp, startBackground } from './index.js';
import { config } from './config.js';
import { migrate } from './scripts/migrate.js';
import { one } from './db.js';

async function main() {
  await migrate((m) => console.log('[migrate]', m));
  // Optional one-time demo data for trial deployments. Runs ONLY on a completely empty database
  // (no users at all), so it can never touch a real installation. Remove the variable afterwards.
  if (process.env.SEED_DEMO_DATA === 'true') {
    const u = await one<{ n: number }>('SELECT count(*)::int n FROM users');
    if (u && u.n === 0) { const { seedDemo } = await import('./scripts/seed.js'); await seedDemo((m: string) => console.log('[seed]', m)); }
  }
  const app = createApp();
  app.listen(config.port, () => {
    console.log(`Payment Approval & Banking Workflow listening on http://localhost:${config.port} (${config.env})`);
    startBackground();
  });
}
main().catch((e) => { console.error(e); process.exit(1); });
