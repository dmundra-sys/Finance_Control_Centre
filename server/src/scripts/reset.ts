/** Development helper: drops every table and rebuilds the schema. Never runs in production. */
import { pool } from '../db.js';
import { config } from '../config.js';
import { migrate } from './migrate.js';
if (config.isProd) { console.error('Refusing to reset a production database.'); process.exit(1); }
await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
await migrate();
console.log('Database reset and migrated.');
await pool.end();
