import { query, one } from '../db.js';
import { paymentScope, hasRole, type SessionUser } from './access.js';
import { PAYMENT_FROM, buildPaymentWhere, stageOwnerSql, type PaymentFilters } from './paymentQuery.js';

const CARDS: Record<string, { key: string; label: string; queue: string; tone: string; amount?: boolean }[]> = {
  A: [
    { key: 'a_my', label: 'My Payment Requests', queue: 'a_my', tone: 'blue' }, { key: 'a_draft', label: 'Draft', queue: 'a_draft', tone: 'slate' },
    { key: 'a_pending_b', label: 'Pending B Approval', queue: 'a_pending_b', tone: 'amber', amount: true }, { key: 'a_b_rejected', label: 'B Rejected', queue: 'a_b_rejected', tone: 'red' },
    { key: 'a_c_query', label: 'C Query', queue: 'a_c_query', tone: 'red' }, { key: 'a_resubmitted', label: 'Resubmitted', queue: 'a_resubmitted', tone: 'indigo' },
    { key: 'a_completed', label: 'Completed', queue: 'a_completed', tone: 'green', amount: true },
  ],
  B: [
    { key: 'b_pending', label: 'Pending Approval', queue: 'b_pending', tone: 'amber', amount: true }, { key: 'b_today', label: 'Approved Today', queue: 'b_approved_today', tone: 'green', amount: true },
    { key: 'b_approved', label: 'Approved (all)', queue: 'b_approved', tone: 'green' }, { key: 'b_rejected', label: 'Rejected', queue: 'b_rejected', tone: 'red' }, { key: 'b_returned', label: 'Returned', queue: 'b_returned', tone: 'orange' },
  ],
  C: [
    { key: 'c_verification', label: 'Pending Verification', queue: 'c_verification', tone: 'amber', amount: true }, { key: 'c_query', label: 'Query Raised', queue: 'c_query', tone: 'red' },
    { key: 'c_ready', label: 'Ready for Payment', queue: 'c_ready', tone: 'teal', amount: true }, { key: 'c_pending_d', label: 'Pending D Approval', queue: 'c_pending_d', tone: 'indigo', amount: true },
    { key: 'c_approved', label: 'Approved – Awaiting Bank Completion', queue: 'c_approved', tone: 'green', amount: true }, { key: 'c_completed', label: 'Completed', queue: 'c_completed', tone: 'green', amount: true },
  ],
  D: [
    { key: 'd_pending', label: 'Pending Final Approval', queue: 'd_pending', tone: 'amber', amount: true }, { key: 'd_today', label: 'Approved Today', queue: 'd_approved_today', tone: 'green', amount: true },
    { key: 'd_rejected', label: 'Rejected', queue: 'd_rejected', tone: 'red' }, { key: 'd_approved', label: 'Approved (all)', queue: 'd_approved', tone: 'green' },
  ],
};
const ACTION_QUEUE: Record<string, string> = { A: 'a_c_query', B: 'b_pending', C: 'c_verification', D: 'd_pending' };

async function count(u: SessionUser, queue: string) {
  const params: any[] = []; const where = buildPaymentWhere(u, { queue }, params);
  return (await one<{ n: number; amt: number }>(`SELECT count(*)::int n, COALESCE(sum(p.net_payable),0) amt ${PAYMENT_FROM} WHERE ${where}`, params))!;
}
async function recent(u: SessionUser, queue: string, limit = 8) {
  const params: any[] = []; const where = buildPaymentWhere(u, { queue }, params);
  return query<any>(`SELECT p.id, p.pa_number, v.name AS vendor, c.short_name AS company, p.net_payable, p.due_date, p.priority, s.label AS status_label, s.color AS status_color, p.updated_at
      ${PAYMENT_FROM} WHERE ${where} ORDER BY array_position(ARRAY['URGENT','HIGH','NORMAL','LOW'], p.priority), p.due_date LIMIT ${limit}`, params);
}

export async function roleDashboard(u: SessionUser) {
  const out: any = { roles: [], sections: {} };
  for (const role of ['A', 'B', 'C', 'D'] as const) {
    if (!hasRole(u, role)) continue;
    out.roles.push(role);
    const cards = [];
    for (const card of CARDS[role]) { const r = await count(u, card.queue); cards.push({ ...card, count: r.n, amount: card.amount ? r.amt : undefined }); }
    const sec: any = { cards, action_queue: ACTION_QUEUE[role], action_items: await recent(u, ACTION_QUEUE[role]) };
    if (role === 'B') {
      const params: any[] = []; const where = buildPaymentWhere(u, { queue: 'b_pending' }, params);
      sec.pending_by_priority = await query<any>(`SELECT p.priority AS key, count(*)::int AS count, COALESCE(sum(p.net_payable),0) AS amount ${PAYMENT_FROM} WHERE ${where} GROUP BY p.priority ORDER BY array_position(ARRAY['URGENT','HIGH','NORMAL','LOW'], p.priority)`, params);
      const p2: any[] = []; const w2 = buildPaymentWhere(u, { queue: 'b_pending' }, p2);
      sec.pending_by_company = await query<any>(`SELECT c.name AS key, count(*)::int AS count, COALESCE(sum(p.net_payable),0) AS amount ${PAYMENT_FROM} WHERE ${w2} GROUP BY c.name ORDER BY amount DESC`, p2);
    }
    if (role === 'C') {
      const p3: any[] = []; const w3 = buildPaymentWhere(u, { queue: 'c_ready' }, p3);
      sec.ready_queue = await query<any>(`SELECT p.id,p.pa_number,c.short_name AS company,v.name AS vendor,p.net_payable,s.label AS status_label, s.color AS status_color FROM payment_advises p JOIN companies c ON c.id=p.company_id JOIN vendors v ON v.id=p.vendor_id JOIN status_config s ON s.code=p.status WHERE ${w3} ORDER BY p.due_date LIMIT 8`, p3);
    }
    out.sections[role] = sec;
  }
  if (hasRole(u, 'ADMIN', 'AUDITOR') && !out.roles.length) out.roles.push('OVERVIEW');
  return out;
}

/** The C "Payment Processing Queue". */
export async function processingQueue(u: SessionUser, f: PaymentFilters) {
  const params: any[] = []; const where = buildPaymentWhere(u, { ...f }, params);
  return query<any>(`SELECT p.id, p.pa_number, c.name AS company, v.name AS party, p.net_payable, p.status, s.label AS status_label, s.color AS status_color,
      (SELECT max(a.decided_at) FROM payment_approvals a WHERE a.payment_id=p.id AND a.stage='B' AND a.decision='APPROVED') AS b_approval_date,
      (SELECT string_agg(u2.name, ', ') FROM payment_approvals a JOIN users u2 ON u2.id=a.approver_id WHERE a.payment_id=p.id AND a.stage='B' AND a.decision='APPROVED' AND a.round_no=p.approval_round) AS b_approver,
      (SELECT a.remarks FROM payment_approvals a WHERE a.payment_id=p.id AND a.stage='B' AND a.decision='APPROVED' ORDER BY a.id DESC LIMIT 1) AS b_remarks,
      CASE WHEN EXISTS(SELECT 1 FROM document_verifications d WHERE d.payment_id=p.id AND d.version_no=p.version_no AND d.result='VERIFIED') THEN 'VERIFIED'
           WHEN p.status='C_QUERY' THEN 'QUERY RAISED' ELSE 'PENDING' END AS doc_status,
      CASE WHEN ae.verified THEN 'VERIFIED' WHEN ae.id IS NOT NULL THEN 'IN PROGRESS' ELSE 'PENDING' END AS accounting_status,
      CASE WHEN bt.id IS NULL THEN 'NOT INITIATED' ELSE bt.bank_status END AS bank_status, p.priority, p.due_date
    ${PAYMENT_FROM} LEFT JOIN accounting_entries ae ON ae.payment_id=p.id LEFT JOIN bank_transactions bt ON bt.payment_id=p.id AND bt.is_current
    WHERE ${where} AND p.status IN ('PENDING_C_VERIFICATION','A_RESUBMITTED','C_QUERY','C_VERIFIED','ACCOUNTING_VERIFIED','PAYMENT_INITIATED','PENDING_D_APPROVAL','D_APPROVED','D_REJECTED','PAYMENT_FAILED')
    ORDER BY array_position(ARRAY['URGENT','HIGH','NORMAL','LOW'], p.priority), p.due_date LIMIT 300`, params);
}

export async function managementDashboard(u: SessionUser, f: { date_from?: string; date_to?: string; company_id?: string }) {
  const flt: PaymentFilters = { date_from: f.date_from, date_to: f.date_to, company_id: f.company_id };
  const w = (extra = 'true') => { const params: any[] = []; const where = buildPaymentWhere(u, flt, params); return { where: `${where} AND ${extra}`, params }; };
  const run = async (sql: (where: string) => string, extra = 'true') => { const x = w(extra); return query<any>(sql(x.where), x.params); };
  const kpi = (await run((wh) => `SELECT
      count(*) FILTER (WHERE p.status<>'DRAFT')::int AS total_payments, COALESCE(sum(p.net_payable) FILTER (WHERE p.status NOT IN ('DRAFT','CANCELLED')),0) AS total_amount,
      count(*) FILTER (WHERE p.status IN ('SUBMITTED','PENDING_B_APPROVAL'))::int AS pending_b, COALESCE(sum(p.net_payable) FILTER (WHERE p.status IN ('SUBMITTED','PENDING_B_APPROVAL')),0) AS pending_b_amount,
      count(*) FILTER (WHERE p.status IN ('PENDING_C_VERIFICATION','A_RESUBMITTED','C_QUERY','B_APPROVED'))::int AS pending_c, COALESCE(sum(p.net_payable) FILTER (WHERE p.status IN ('PENDING_C_VERIFICATION','A_RESUBMITTED','C_QUERY','B_APPROVED')),0) AS pending_c_amount,
      count(*) FILTER (WHERE p.status IN ('C_VERIFIED','ACCOUNTING_VERIFIED') OR (p.status='D_REJECTED' AND p.return_to_stage='C') OR p.status='PAYMENT_FAILED')::int AS pending_bank,
      COALESCE(sum(p.net_payable) FILTER (WHERE p.status IN ('C_VERIFIED','ACCOUNTING_VERIFIED') OR (p.status='D_REJECTED' AND p.return_to_stage='C') OR p.status='PAYMENT_FAILED'),0) AS pending_bank_amount,
      count(*) FILTER (WHERE p.status IN ('PAYMENT_INITIATED','PENDING_D_APPROVAL'))::int AS pending_d, COALESCE(sum(p.net_payable) FILTER (WHERE p.status IN ('PAYMENT_INITIATED','PENDING_D_APPROVAL')),0) AS pending_d_amount,
      count(*) FILTER (WHERE p.status IN ('D_APPROVED','PAYMENT_COMPLETED'))::int AS completed, COALESCE(sum(p.net_payable) FILTER (WHERE p.status IN ('D_APPROVED','PAYMENT_COMPLETED')),0) AS completed_amount,
      count(*) FILTER (WHERE p.status IN ('B_REJECTED','D_REJECTED','CANCELLED'))::int AS rejected, count(*) FILTER (WHERE p.status='ON_HOLD')::int AS on_hold,
      count(*) FILTER (WHERE p.status IN ('PAYMENT_FAILED','PAYMENT_REVERSED'))::int AS failed
      ${PAYMENT_FROM} WHERE ${wh}`))[0];
  const grp = (expr: string, lim = 12) => run((wh) => `SELECT ${expr} AS name, count(*)::int AS count, COALESCE(sum(p.net_payable),0) AS amount ${PAYMENT_FROM} WHERE ${wh} GROUP BY 1 ORDER BY amount DESC LIMIT ${lim}`, `p.status NOT IN ('DRAFT','CANCELLED')`);
  const [byCompany, byBank, byVendor, byMode, byStatus] = await Promise.all([
    grp('c.short_name'), grp(`bk.bank_name`), grp('v.name', 10), grp('p.payment_mode'),
    run((wh) => `SELECT s.label AS name, s.color, count(*)::int AS count, COALESCE(sum(p.net_payable),0) AS amount ${PAYMENT_FROM} WHERE ${wh} GROUP BY s.label, s.color, s.sort_order ORDER BY s.sort_order`, `p.status <> 'DRAFT'`),
  ]);
  const daily = await run((wh) => `SELECT to_char((p.created_at AT TIME ZONE 'Asia/Kolkata')::date,'YYYY-MM-DD') AS day, count(*)::int AS count, COALESCE(sum(p.net_payable),0) AS amount ${PAYMENT_FROM} WHERE ${wh} GROUP BY 1 ORDER BY 1`, `p.status NOT IN ('DRAFT','CANCELLED')`);
  const monthly = await run((wh) => `SELECT to_char((p.created_at AT TIME ZONE 'Asia/Kolkata'),'YYYY-MM') AS month, count(*)::int AS count, COALESCE(sum(p.net_payable),0) AS amount ${PAYMENT_FROM} WHERE ${wh} GROUP BY 1 ORDER BY 1`, `p.status NOT IN ('DRAFT','CANCELLED')`);
  const byStage = await run((wh) => `SELECT ${stageOwnerSql} AS stage, count(*)::int AS count, COALESCE(sum(p.net_payable),0) AS amount ${PAYMENT_FROM} WHERE ${wh} GROUP BY 1`, `p.status NOT IN ('DRAFT','CANCELLED','PAYMENT_COMPLETED','PAYMENT_REVERSED')`);
  void paymentScope;
  return { kpi, byCompany, byBank, byVendor, byMode, byStatus, daily, monthly, byStage };
}
