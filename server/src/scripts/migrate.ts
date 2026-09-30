import fs from 'node:fs';
import path from 'node:path';
import { pool } from '../db.js';
import { config } from '../config.js';
import { ROLES, DEFAULT_ROLE_PERMISSIONS, STATUSES } from '../constants.js';
import { SETTING_DEFAULTS } from '../services/settings.js';
import { defaultTemplates } from '../services/notifications.js';

export async function migrate(log = console.log) {
  await pool.query('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
  const files = fs.readdirSync(config.sqlDir).filter((f) => f.endsWith('.sql')).sort();
  for (const f of files) {
    const done = await pool.query('SELECT 1 FROM schema_migrations WHERE name=$1', [f]);
    if (done.rowCount) continue;
    const c = await pool.connect();
    try {
      await c.query('BEGIN'); await c.query(fs.readFileSync(path.join(config.sqlDir, f), 'utf8'));
      await c.query('INSERT INTO schema_migrations(name) VALUES($1)', [f]); await c.query('COMMIT'); log(`applied ${f}`);
    } catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); }
  }
  await seedReference();
}

/** Reference data required by any installation (idempotent). */
export async function seedReference() {
  for (const r of ROLES) await pool.query('INSERT INTO roles(code,name,description,sort_order) VALUES($1,$2,$3,$4) ON CONFLICT (code) DO UPDATE SET name=EXCLUDED.name, description=EXCLUDED.description', [r.code, r.name, r.description, r.sort]);
  const has = await pool.query('SELECT 1 FROM role_permissions LIMIT 1');
  if (!has.rowCount) for (const [role, perms] of Object.entries(DEFAULT_ROLE_PERMISSIONS)) for (const p of perms) await pool.query('INSERT INTO role_permissions(role_code,permission) VALUES($1,$2) ON CONFLICT DO NOTHING', [role, p]);
  for (const s of STATUSES) await pool.query('INSERT INTO status_config(code,label,color,sort_order,description,is_terminal) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT (code) DO NOTHING', [s.code, s.label, s.color, s.sort, s.description, !!s.terminal]);
  for (const [k, v] of Object.entries(SETTING_DEFAULTS)) await pool.query('INSERT INTO system_settings(key,value,description) VALUES($1,$2,$3) ON CONFLICT (key) DO NOTHING', [k, JSON.stringify(v.value), v.description]);
  for (const t of defaultTemplates()) await pool.query('INSERT INTO notification_templates(event_code,channel,is_enabled,subject,body) VALUES($1,$2,$3,$4,$5) ON CONFLICT (event_code,channel) DO NOTHING', [t.event_code, t.channel, t.is_enabled, t.subject, t.body]);
  const modes: [string, string, number | null, number | null, string[], boolean, number][] = [
    ['NEFT', 'NEFT', null, null, ['bank_ref_no'], true, 1], ['RTGS', 'RTGS', 200000, null, ['bank_ref_no'], true, 2], ['IMPS', 'IMPS', null, 500000, ['bank_ref_no'], true, 3],
    ['CHEQUE', 'Cheque', null, null, ['cheque_no', 'cheque_date'], false, 4], ['INTERNAL_TRANSFER', 'Internal Transfer', null, null, ['bank_ref_no'], false, 5],
    ['DEMAND_DRAFT', 'Demand Draft', null, null, ['dd_no', 'dd_favouring'], false, 6], ['UPI', 'UPI', null, 100000, ['bank_ref_no', 'upi_id'], false, 7], ['OTHER', 'Other', null, null, ['bank_ref_no'], false, 8],
  ];
  for (const m of modes) await pool.query('INSERT INTO payment_modes(code,name,min_amount,max_amount,required_fields,requires_beneficiary_bank,sort_order) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (code) DO NOTHING', m);
  const lists: Record<string, [string, string][]> = {
    GST_TREATMENT: [['REG_ITC', 'Registered – ITC eligible'], ['REG_BLOCKED', 'Registered – ITC blocked'], ['RCM', 'Reverse charge (RCM)'], ['EXEMPT', 'Exempt / Nil rated'], ['UNREG', 'Unregistered supplier'], ['IMPORT', 'Import of goods / services'], ['NA', 'Not applicable']],
    TDS_SECTION: [['NONE', 'Not applicable'], ['194C', '194C – Contractors'], ['194J', '194J – Professional / technical fees'], ['194H', '194H – Commission / brokerage'], ['194I', '194I – Rent'], ['194Q', '194Q – Purchase of goods'], ['192', '192 – Salary'], ['194A', '194A – Interest'], ['195', '195 – Non-resident']],
    DEPARTMENT: [['ACCOUNTS', 'Accounts & Finance'], ['PROCUREMENT', 'Procurement'], ['OPERATIONS', 'Operations'], ['ADMIN', 'Administration'], ['HR', 'Human Resources'], ['MARKETING', 'Marketing'], ['IT', 'Information Technology'], ['LEGAL', 'Legal & Compliance']],
    LEDGER: [['5001', '5001 – Raw material purchases'], ['5002', '5002 – Packing material'], ['5101', '5101 – Freight & logistics'], ['5201', '5201 – Professional fees'], ['5202', '5202 – Repairs & maintenance'], ['5203', '5203 – Rent'], ['5204', '5204 – Advertising & marketing'], ['5205', '5205 – Utilities'], ['5301', '5301 – Salaries & wages'], ['2101', '2101 – Sundry creditors'], ['2201', '2201 – Statutory dues payable'], ['2301', '2301 – Loans & interest payable'], ['1301', '1301 – Inter-company receivable']],
    COST_CENTRE: [['CC-HO', 'Head office'], ['CC-PLANT', 'Plant / manufacturing'], ['CC-SALES', 'Sales & distribution'], ['CC-PROJ', 'Projects'], ['CC-SHARED', 'Shared services']],
    PROJECT: [['NA', 'Not applicable'], ['PRJ-EXP', 'Capacity expansion'], ['PRJ-ERP', 'ERP roll-out'], ['PRJ-CSR', 'CSR programme']],
  };
  for (const [cat, items] of Object.entries(lists)) { let i = 0; for (const [code, name] of items) await pool.query('INSERT INTO master_data(category,code,name,sort_order) VALUES($1,$2,$3,$4) ON CONFLICT (category,code) DO NOTHING', [cat, code, name, i++]); }
  const m = await pool.query('SELECT 1 FROM approval_matrix LIMIT 1');
  if (!m.rowCount) {
    const rules: [string, number, number | null, any[], number, number][] = [
      ['Up to ₹1,00,000 – B + D', 0, 100000, [{ label: 'Payment Approver', senior: false, count: 1 }], 1, 1],
      ['₹1,00,001 – ₹5,00,000 – B + D', 100000.01, 500000, [{ label: 'Payment Approver', senior: false, count: 1 }], 1, 2],
      ['₹5,00,001 – ₹25,00,000 – Senior Approver + D', 500000.01, 2500000, [{ label: 'Senior Approver', senior: true, count: 1 }], 1, 3],
      ['Above ₹25,00,000 – B + Senior Approver + two D approvals', 2500000.01, null, [{ label: 'Payment Approver', senior: false, count: 1 }, { label: 'Senior Approver', senior: true, count: 1 }], 2, 4],
    ];
    for (const [name, min, max, levels, d, sort] of rules) await pool.query('INSERT INTO approval_matrix(name,min_amount,max_amount,b_levels,d_count,sort_order) VALUES($1,$2,$3,$4,$5,$6)', [name, min, max, JSON.stringify(levels), d, sort]);
  }
}

if (process.argv[1]?.endsWith('migrate.ts') || process.argv[1]?.endsWith('migrate.js')) {
  migrate().then(() => { console.log('Migration complete.'); return pool.end(); }).catch((e) => { console.error(e); process.exit(1); });
}
