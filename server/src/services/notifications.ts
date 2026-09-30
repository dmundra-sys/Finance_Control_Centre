import type { PoolClient } from 'pg';
import { pool, query, one, type Db } from '../db.js';
import { config } from '../config.js';
import { fill, formatINR, fmtDate, fmtDateTime } from '../lib/format.js';
import { getSetting } from './settings.js';
import { sendEmail, sendSms, sendWhatsApp } from './providers/messaging.js';
import { NOTIFICATION_EVENTS } from '../constants.js';
import type { Ctx } from './audit.js';

type Ev = (typeof NOTIFICATION_EVENTS)[number][0];

export interface PaymentBrief {
  id: number; pa_number: string; company_id: number; bank_account_id: number; vendor_id: number; created_by: number;
  net_payable: number; due_date: string; status: string; return_to_stage?: string | null; invoice_number: string; approval_plan?: any; approval_round?: number;
}

const ACTION_REQUIRED: Record<string, string> = {
  B_APPROVAL_PENDING: 'Review the Payment Advice and approve, reject or return it.',
  B_APPROVED: 'Original document verification and accounting verification by C.',
  B_REJECTED: 'Correct the issue / respond to the query and resubmit the same Payment Advice.',
  C_QUERY_RAISED: 'Resolve the query, upload corrected documents and resubmit to C.',
  A_RESUBMITTED: 'Verify the original documents again.',
  C_VERIFIED: 'Complete accounting verification and initiate the payment on the bank portal.',
  PAYMENT_INITIATED: 'Bank payment initiated – awaiting final bank approval.',
  D_APPROVAL_PENDING: 'Review the complete history and give the final bank approval.',
  D_APPROVED: 'Complete the payment on the bank portal and update UTR / bank status.',
  D_REJECTED: 'Correct the issue and resubmit for final approval.',
  PAYMENT_COMPLETED: 'No action required – payment completed.',
  PAYMENT_FAILED: 'Investigate the failure and re-initiate or cancel.',
  PAYMENT_CREATED: 'Complete the draft and submit to B.',
  PAYMENT_CANCELLED: 'No action required.',
  PAYMENT_ON_HOLD: 'Payment on hold / released – check remarks.',
  CANCELLATION_REQUESTED: 'Review and approve or reject the cancellation request.',
};

export const TEMPLATE_TITLES: Record<string, string> = {
  PAYMENT_CREATED: 'Payment Advice created – {{pa_no}}',
  B_APPROVAL_PENDING: 'Payment Approval Required – {{pa_no}} – {{amount}}',
  B_APPROVED: 'Approved by B – {{pa_no}} – {{amount}}',
  B_REJECTED: 'Returned by B – {{pa_no}}',
  C_QUERY_RAISED: 'C has raised a query – {{pa_no}}',
  A_RESUBMITTED: 'Resubmitted by A – {{pa_no}}',
  C_VERIFIED: 'Documents verified by C – {{pa_no}}',
  PAYMENT_INITIATED: 'Bank payment initiated – {{pa_no}}',
  D_APPROVAL_PENDING: 'Final Bank Approval Required – {{pa_no}} – {{amount}}',
  D_APPROVED: 'Payment Approved – {{pa_no}}',
  D_REJECTED: 'Rejected by D – {{pa_no}}',
  PAYMENT_COMPLETED: 'Payment completed – {{pa_no}} – {{amount}}',
  PAYMENT_FAILED: 'Payment FAILED – {{pa_no}} – {{amount}}',
  PAYMENT_CANCELLED: 'Payment cancelled – {{pa_no}}',
  PAYMENT_ON_HOLD: 'Payment hold update – {{pa_no}}',
  CANCELLATION_REQUESTED: 'Cancellation requested – {{pa_no}}',
};

export const WHATSAPP_D_APPROVED = `Payment Approved
Payment Advice No: {{pa_no}}
Company: {{company}}
Vendor: {{vendor}}
Amount: {{amount}}
Bank: {{bank}}
Approved By: {{approved_by}}
Approval Date: {{approval_date}}
Bank Reference: {{bank_reference}}
Status: FINAL PAYMENT APPROVED`;

export function defaultTemplates(): { event_code: string; channel: string; is_enabled: boolean; subject: string | null; body: string }[] {
  const out: any[] = [];
  for (const [ev] of NOTIFICATION_EVENTS) {
    const title = TEMPLATE_TITLES[ev];
    out.push({ event_code: ev, channel: 'INAPP', is_enabled: true, subject: title, body: 'Vendor {{vendor}} · {{company}} · {{amount}}. Stage: {{stage}}. {{action_required}}' });
    out.push({ event_code: ev, channel: 'EMAIL', is_enabled: ['B_APPROVAL_PENDING', 'D_APPROVAL_PENDING', 'D_APPROVED', 'C_QUERY_RAISED', 'B_REJECTED', 'PAYMENT_FAILED', 'PAYMENT_COMPLETED'].includes(ev), subject: title,
      body: 'Hello {{user_name}}, Payment Advice {{pa_no}} for {{vendor}} needs your attention.' });
    out.push({ event_code: ev, channel: 'WHATSAPP', is_enabled: ev === 'D_APPROVED', subject: null,
      body: ev === 'D_APPROVED' ? WHATSAPP_D_APPROVED : `${title}\nCompany: {{company}}\nVendor: {{vendor}}\nAmount: {{amount}}\nStatus: {{status}}` });
    out.push({ event_code: ev, channel: 'SMS', is_enabled: false, subject: null, body: `${title} - {{vendor}} - {{stage}}` });
  }
  return out;
}

async function usersByRole(db: Db, roles: string[], companyId: number, opts: { bankAccountId?: number; senior?: boolean } = {}) {
  return query<any>(
    `SELECT u.* FROM users u
      WHERE u.is_active AND (u.role_code = ANY($1) OR u.extra_roles && $1::text[])
        AND EXISTS (SELECT 1 FROM user_companies uc WHERE uc.user_id=u.id AND uc.company_id=$2)
        AND ($3::bigint IS NULL OR NOT EXISTS (SELECT 1 FROM user_bank_accounts x WHERE x.user_id=u.id) OR EXISTS (SELECT 1 FROM user_bank_accounts x WHERE x.user_id=u.id AND x.bank_account_id=$3))
        AND ($4::boolean IS NOT TRUE OR u.is_senior_approver)`,
    [roles, companyId, opts.bankAccountId ?? null, opts.senior ?? null], db);
}
const byIds = (db: Db, ids: number[]) => ids.length ? query<any>('SELECT * FROM users WHERE id = ANY($1) AND is_active', [ids], db) : Promise.resolve([] as any[]);

async function recipients(db: Db, ev: Ev, p: PaymentBrief): Promise<{ all: any[]; whatsapp?: any[] }> {
  const creator = await byIds(db, [p.created_by]);
  const cUsers = () => usersByRole(db, ['C'], p.company_id, { bankAccountId: p.bank_account_id });
  const dUsers = () => usersByRole(db, ['D'], p.company_id, { bankAccountId: p.bank_account_id });
  const initiators = async () => {
    const r = await query<{ initiated_by: number }>('SELECT initiated_by FROM bank_transactions WHERE payment_id=$1 AND is_current', [p.id], db);
    return byIds(db, r.map((x) => x.initiated_by));
  };
  const approvers = async (stage: 'B' | 'D') => {
    const r = await query<{ approver_id: number }>(`SELECT DISTINCT approver_id FROM payment_approvals WHERE payment_id=$1 AND stage=$2 AND decision='APPROVED'`, [p.id, stage], db);
    return byIds(db, r.map((x) => x.approver_id));
  };
  switch (ev) {
    case 'PAYMENT_CREATED': return { all: creator };
    case 'B_APPROVAL_PENDING': {
      const plan = p.approval_plan; const round = p.approval_round ?? 1;
      const done = await query<{ level_no: number }>(`SELECT level_no FROM payment_approvals WHERE payment_id=$1 AND stage='B' AND round_no=$2 AND decision='APPROVED'`, [p.id, round], db);
      let level = 1; const levels = plan?.b_levels ?? [{ senior: false, count: 1 }];
      for (let i = 0; i < levels.length; i++) { const n = done.filter((d) => d.level_no === i + 1).length; if (n < levels[i].count) { level = i + 1; break; } }
      const senior = !!levels[level - 1]?.senior;
      const users = (await usersByRole(db, ['B'], p.company_id, { senior })).filter((u) => u.id !== p.created_by);
      return { all: users };
    }
    case 'B_APPROVED': return { all: [...creator, ...(await cUsers())] };
    case 'B_REJECTED': case 'C_QUERY_RAISED': return { all: creator };
    case 'A_RESUBMITTED': return { all: await cUsers() };
    case 'C_VERIFIED': return { all: creator };
    case 'PAYMENT_INITIATED': return { all: [...creator, ...(await approvers('B'))] };
    case 'D_APPROVAL_PENDING': return { all: await dUsers() };
    case 'D_APPROVED': {
      const c = await initiators(); const fallback = c.length ? c : await cUsers();
      return { all: [...fallback, ...creator, ...(await approvers('B'))], whatsapp: fallback };
    }
    case 'D_REJECTED': return { all: p.return_to_stage === 'A' ? creator : [...(await initiators()), ...(await cUsers())] };
    case 'PAYMENT_COMPLETED': case 'PAYMENT_FAILED': return { all: [...creator, ...(await initiators()), ...(await approvers('D'))] };
    case 'PAYMENT_CANCELLED': case 'PAYMENT_ON_HOLD': return { all: [...creator, ...(await initiators())] };
    case 'CANCELLATION_REQUESTED': return { all: [...(await usersByRole(db, ['B', 'D'], p.company_id))] };
  }
  return { all: [] };
}

export function emailHtml(o: { title: string; intro: string; rows: [string, string][]; cta: string; url: string; footer?: string }) {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<!doctype html><html><body style="margin:0;background:#f3f5f9;font-family:Segoe UI,Arial,sans-serif;color:#1e293b">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#fff;border:1px solid #e2e8f0;border-radius:10px;overflow:hidden">
<tr><td style="background:#0f2a4a;color:#fff;padding:18px 24px;font-size:13px;letter-spacing:.06em">PAYMENT APPROVAL &amp; BANKING WORKFLOW</td></tr>
<tr><td style="padding:24px"><h2 style="margin:0 0 8px;font-size:18px;color:#0f2a4a">${esc(o.title)}</h2><p style="margin:0 0 16px;font-size:14px;line-height:1.5">${esc(o.intro)}</p>
<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:14px">${o.rows.map(([k, v]) => `<tr><td style="padding:8px 10px;border-bottom:1px solid #eef2f7;color:#64748b;width:38%">${esc(k)}</td><td style="padding:8px 10px;border-bottom:1px solid #eef2f7;font-weight:600">${esc(v)}</td></tr>`).join('')}</table>
<p style="margin:24px 0 8px"><a href="${o.url}" style="display:inline-block;background:#1d4ed8;color:#fff;text-decoration:none;padding:12px 22px;border-radius:6px;font-weight:600;font-size:14px">${esc(o.cta)}</a></p>
<p style="margin:16px 0 0;font-size:12px;color:#94a3b8">${esc(o.footer ?? 'This is an automated message. Never share your password or OTP with anyone.')}</p></td></tr></table></td></tr></table></body></html>`;
}

export interface NotifyExtra { remarks?: string; reason?: string; approvedBy?: string; approvalDate?: string; bankReference?: string; bankName?: string }

/** Create in-app notifications + outbox rows for a workflow event. Runs inside the caller's transaction. */
export async function notify(ctx: Ctx, ev: Ev, p: PaymentBrief, extra: NotifyExtra = {}) {
  const db = ctx.db;
  const full = await one<any>(
    `SELECT c.name AS company, v.name AS vendor, b.bank_name, s.label AS status_label
       FROM companies c, vendors v, bank_accounts b, status_config s
      WHERE c.id=$1 AND v.id=$2 AND b.id=$3 AND s.code=$4`, [p.company_id, p.vendor_id, p.bank_account_id, p.status], db);
  const rcpt = await recipients(db, ev, p);
  const templates = await query<any>('SELECT * FROM notification_templates WHERE event_code=$1 AND is_enabled', [ev], db);
  const link = `${config.appBaseUrl}/payments/${p.id}`;
  const seen = new Set<string>();
  const actorId = ctx.user?.id;

  for (const tpl of templates) {
    const list = tpl.channel === 'WHATSAPP' && rcpt.whatsapp ? rcpt.whatsapp : rcpt.all;
    for (const u of list) {
      if (!u || (u.id === actorId && tpl.channel === 'INAPP' && ev !== 'PAYMENT_CREATED')) continue;
      if (u.id === actorId && tpl.channel !== 'INAPP') continue;
      const key = `${tpl.channel}:${u.id}`; if (seen.has(key)) continue; seen.add(key);
      const vars = {
        user_name: u.name, pa_no: p.pa_number, company: full?.company, vendor: full?.vendor, amount: formatINR(p.net_payable), net_payable: formatINR(p.net_payable),
        due_date: fmtDate(p.due_date), stage: full?.status_label, status: full?.status_label, action_required: ACTION_REQUIRED[ev] ?? '', bank: extra.bankName ?? full?.bank_name,
        approved_by: extra.approvedBy ?? ctx.user?.name ?? '', approval_date: extra.approvalDate ?? fmtDate(ctx.now), bank_reference: extra.bankReference ?? '—',
        invoice_no: p.invoice_number, reason: extra.reason ?? '', remarks: extra.remarks ?? '', link,
      };
      const subject = fill(tpl.subject ?? TEMPLATE_TITLES[ev] ?? ev, vars);
      const body = fill(tpl.body, vars);
      if (tpl.channel === 'INAPP') {
        await db.query('INSERT INTO notifications(user_id,payment_id,event_code,title,body,link,created_at) VALUES($1,$2,$3,$4,$5,$6,$7)',
          [u.id, p.id, ev, subject, body, `/payments/${p.id}`, ctx.now]);
      } else {
        const to = tpl.channel === 'EMAIL' ? u.email : u.mobile;
        let html: string | null = null; let text = body;
        if (tpl.channel === 'EMAIL') {
          html = emailHtml({ title: subject, intro: body, cta: 'Open in Payment Workflow', url: link, rows: [
            ['Payment Advice Number', p.pa_number], ['Vendor', vars.vendor ?? ''], ['Company', vars.company ?? ''], ['Amount', vars.amount], ['Due Date', vars.due_date],
            ['Current Stage', vars.stage ?? ''], ['Required Action', vars.action_required], ...(extra.reason ? [['Reason', extra.reason] as [string, string]] : []),
          ] });
          text = `${body}\n\nPayment Advice: ${p.pa_number}\nVendor: ${vars.vendor}\nCompany: ${vars.company}\nAmount: ${vars.amount}\nDue: ${vars.due_date}\nStage: ${vars.stage}\nAction: ${vars.action_required}\n\nOpen: ${link}`;
        }
        await db.query(
          `INSERT INTO notification_outbox(channel,recipient_user_id,to_address,event_code,payment_id,subject,body,html,status,error,response,created_at)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
          [tpl.channel, u.id, to ?? null, ev, p.id, subject, text, html, to ? 'PENDING' : 'SKIPPED', to ? null : `No ${tpl.channel === 'EMAIL' ? 'e-mail address' : 'mobile number'} on file`,
            JSON.stringify({ vars }), ctx.now]);
      }
    }
  }
}

/** Send pending outbox rows through the configured providers (called after commit and by a timer). */
export async function dispatchOutbox(limit = 50): Promise<number> {
  const rows = await query<any>(`SELECT * FROM notification_outbox WHERE status='PENDING' OR (status='FAILED' AND attempts < 3 AND created_at > now() - interval '1 day') ORDER BY id LIMIT $1`, [limit]);
  let sent = 0;
  for (const r of rows) {
    let res;
    if (r.channel === 'WHATSAPP') res = await sendWhatsApp(await getSetting('whatsapp'), { to: r.to_address, text: r.body, vars: r.response?.vars ?? {} });
    else if (r.channel === 'EMAIL') res = await sendEmail(await getSetting('email'), { to: r.to_address, subject: r.subject, text: r.body, html: r.html ?? r.body });
    else res = await sendSms(await getSetting('sms'), { to: r.to_address, text: r.body });
    await pool.query(
      `UPDATE notification_outbox SET status=$2, attempts=attempts+1, provider=$3, provider_ref=$4, error=$5, sent_at=CASE WHEN $2='SENT' THEN now() ELSE sent_at END,
              response = COALESCE(response,'{}'::jsonb) || $6::jsonb WHERE id=$1`,
      [r.id, res.ok ? 'SENT' : 'FAILED', res.provider, res.ref ?? null, res.error ?? null, JSON.stringify({ provider_response: res.response ?? null })]);
    if (res.ok) sent++;
  }
  return sent;
}
export async function dispatchSafely() {
  try { await Promise.race([dispatchOutbox(), new Promise((r) => setTimeout(r, 8000))]); } catch (e) { console.error('[outbox]', e); }
}
export type { PoolClient };
export { fmtDateTime };
