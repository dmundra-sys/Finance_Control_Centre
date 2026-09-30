import { paymentScope, type SessionUser } from './access.js';

/** Shared FROM clause: every list / export / report starts from here. */
export const PAYMENT_FROM = `
  FROM payment_advises p
  JOIN companies c      ON c.id  = p.company_id
  JOIN vendors v        ON v.id  = p.vendor_id
  JOIN bank_accounts bk ON bk.id = p.bank_account_id
  JOIN status_config s  ON s.code = p.status
  JOIN users cr         ON cr.id = p.created_by`;

export interface PaymentFilters {
  q?: string; queue?: string; status?: string; company_id?: string; vendor_id?: string; bank_account_id?: string; bank_name?: string;
  payment_mode?: string; payment_type?: string; priority?: string; created_by?: string; approved_by?: string;
  date_from?: string; date_to?: string; min_amount?: string; max_amount?: string; invoice_no?: string;
}

const IST_DATE = `(p.created_at AT TIME ZONE 'Asia/Kolkata')::date`;

/** Queue name -> SQL predicate. `me` is the placeholder index of the current user id. */
function queueSql(queue: string, me: number, seniorIdx: number): string | null {
  const st = (...s: string[]) => `p.status IN (${s.map((x) => `'${x}'`).join(',')})`;
  switch (queue) {
    case 'all': return 'true';
    case 'a_my': return `p.created_by = ${me}`;
    case 'a_draft': return `p.created_by = ${me} AND ${st('DRAFT')}`;
    case 'a_pending_b': return `p.created_by = ${me} AND ${st('SUBMITTED', 'PENDING_B_APPROVAL')}`;
    case 'a_b_rejected': return `p.created_by = ${me} AND ${st('B_REJECTED')}`;
    case 'a_c_query': return `p.created_by = ${me} AND (${st('C_QUERY')} OR (${st('D_REJECTED')} AND p.return_to_stage='A'))`;
    case 'a_resubmitted': return `p.created_by = ${me} AND ${st('A_RESUBMITTED')}`;
    case 'a_completed': return `p.created_by = ${me} AND ${st('D_APPROVED', 'PAYMENT_COMPLETED')}`;
    case 'b_pending': return `${st('PENDING_B_APPROVAL')} AND p.created_by <> ${me} AND (NOT p.pending_b_senior OR ${seniorIdx ? 'true' : 'false'}) AND NOT EXISTS (SELECT 1 FROM payment_approvals a WHERE a.payment_id=p.id AND a.stage='B' AND a.round_no=p.approval_round AND a.approver_id=${me})`;
    case 'b_approved': return `EXISTS (SELECT 1 FROM payment_approvals a WHERE a.payment_id=p.id AND a.stage='B' AND a.approver_id=${me} AND a.decision='APPROVED')`;
    case 'b_rejected': return `EXISTS (SELECT 1 FROM payment_approvals a WHERE a.payment_id=p.id AND a.stage='B' AND a.approver_id=${me} AND a.decision='REJECTED')`;
    case 'b_returned': return `EXISTS (SELECT 1 FROM payment_approvals a WHERE a.payment_id=p.id AND a.stage='B' AND a.approver_id=${me} AND a.decision='RETURNED')`;
    case 'c_verification': return st('PENDING_C_VERIFICATION', 'A_RESUBMITTED');
    case 'c_query': return `${st('C_QUERY')} OR (${st('D_REJECTED')} AND p.return_to_stage='A')`;
    case 'c_ready': return `${st('C_VERIFIED', 'ACCOUNTING_VERIFIED', 'PAYMENT_FAILED')} OR (${st('D_REJECTED')} AND p.return_to_stage='C')`;
    case 'c_pending_d': return st('PAYMENT_INITIATED', 'PENDING_D_APPROVAL');
    case 'c_approved': return st('D_APPROVED');
    case 'c_completed': return st('PAYMENT_COMPLETED');
    case 'b_approved_today': return `EXISTS (SELECT 1 FROM payment_approvals a WHERE a.payment_id=p.id AND a.stage='B' AND a.approver_id=${me} AND a.decision='APPROVED' AND (a.decided_at AT TIME ZONE 'Asia/Kolkata')::date = (now() AT TIME ZONE 'Asia/Kolkata')::date)`;
    case 'd_approved_today': return `EXISTS (SELECT 1 FROM payment_approvals a WHERE a.payment_id=p.id AND a.stage='D' AND a.approver_id=${me} AND a.decision='APPROVED' AND (a.decided_at AT TIME ZONE 'Asia/Kolkata')::date = (now() AT TIME ZONE 'Asia/Kolkata')::date)`;
    case 'd_pending': return `${st('PENDING_D_APPROVAL')} AND NOT EXISTS (SELECT 1 FROM payment_approvals a WHERE a.payment_id=p.id AND a.stage='D' AND a.round_no=p.bank_round AND a.approver_id=${me})`;
    case 'd_approved': return `EXISTS (SELECT 1 FROM payment_approvals a WHERE a.payment_id=p.id AND a.stage='D' AND a.approver_id=${me} AND a.decision='APPROVED')`;
    case 'd_rejected': return `EXISTS (SELECT 1 FROM payment_approvals a WHERE a.payment_id=p.id AND a.stage='D' AND a.approver_id=${me} AND a.decision='REJECTED')`;
    case 'on_hold': return st('ON_HOLD');
    case 'cancelled': return st('CANCELLED');
    case 'failed': return st('PAYMENT_FAILED');
    case 'rejected_any': return st('B_REJECTED', 'D_REJECTED', 'C_QUERY');
    case 'pending_any': return st('PENDING_B_APPROVAL', 'PENDING_C_VERIFICATION', 'A_RESUBMITTED', 'C_VERIFIED', 'ACCOUNTING_VERIFIED', 'PENDING_D_APPROVAL', 'PAYMENT_INITIATED');
    case 'open': return `p.status NOT IN ('DRAFT','CANCELLED','PAYMENT_COMPLETED','PAYMENT_REVERSED')`;
    default: return null;
  }
}

export function buildPaymentWhere(user: SessionUser, f: PaymentFilters, params: any[]): string {
  const w: string[] = [paymentScope(user, 'p', params)];
  const add = (sql: string, val: any) => { params.push(val); w.push(sql.replace(/\$\?/g, `$${params.length}`)); };
  if (f.queue) {
    // inlined (integer id / boolean literal) so no unreferenced bind params are sent
    const q = queueSql(f.queue, Number(user.id), user.isSeniorApprover ? 1 : 0);
    if (q) w.push(`(${q})`);
  }
  if (f.status) add('p.status = ANY($?::text[])', f.status.split(','));
  if (f.company_id) add('p.company_id = $?', Number(f.company_id));
  if (f.vendor_id) add('p.vendor_id = $?', Number(f.vendor_id));
  if (f.bank_account_id) add('p.bank_account_id = $?', Number(f.bank_account_id));
  if (f.bank_name) add('bk.bank_name ILIKE $?', `%${f.bank_name}%`);
  if (f.payment_mode) add('p.payment_mode = $?', f.payment_mode);
  if (f.payment_type) add('p.payment_type = $?', f.payment_type);
  if (f.priority) add('p.priority = $?', f.priority);
  if (f.created_by) add('p.created_by = $?', Number(f.created_by));
  if (f.approved_by) add(`EXISTS (SELECT 1 FROM payment_approvals a WHERE a.payment_id=p.id AND a.decision='APPROVED' AND a.approver_id=$?)`, Number(f.approved_by));
  if (f.date_from) add(`${IST_DATE} >= $?::date`, f.date_from);
  if (f.date_to) add(`${IST_DATE} <= $?::date`, f.date_to);
  if (f.min_amount) add('p.net_payable >= $?', Number(f.min_amount));
  if (f.max_amount) add('p.net_payable <= $?', Number(f.max_amount));
  if (f.invoice_no) add('p.invoice_number ILIKE $?', `%${f.invoice_no}%`);
  if (f.q && f.q.trim()) {
    const q = f.q.trim();
    params.push(`%${q}%`); const like = params.length;
    params.push(`%${q.replace(/[,₹\s]/g, '')}%`); const num = params.length;
    w.push(`(p.pa_number ILIKE $${like} OR v.name ILIKE $${like} OR v.vendor_code ILIKE $${like} OR p.invoice_number ILIKE $${like}
      OR c.name ILIKE $${like} OR c.short_name ILIKE $${like} OR bk.bank_name ILIKE $${like} OR s.label ILIKE $${like} OR cr.name ILIKE $${like}
      OR p.net_payable::text LIKE $${num} OR p.gross_amount::text LIKE $${num}
      OR to_char(p.invoice_date,'DD-Mon-YYYY') ILIKE $${like} OR p.invoice_date::text ILIKE $${like} OR to_char(p.created_at AT TIME ZONE 'Asia/Kolkata','DD-Mon-YYYY') ILIKE $${like}
      OR EXISTS (SELECT 1 FROM bank_transactions bt WHERE bt.payment_id=p.id AND (bt.utr ILIKE $${like} OR bt.bank_ref_no ILIKE $${like} OR bt.bank_txn_id ILIKE $${like}))
      OR EXISTS (SELECT 1 FROM payment_approvals a JOIN users au ON au.id=a.approver_id WHERE a.payment_id=p.id AND au.name ILIKE $${like}))`);
  }
  return w.join(' AND ');
}

export const SORTABLE: Record<string, string> = {
  pa_number: 'p.pa_number', created_at: 'p.created_at', vendor: 'v.name', company: 'c.name', invoice_number: 'p.invoice_number',
  net_payable: 'p.net_payable', due_date: 'p.due_date', status: 's.sort_order', priority: `array_position(ARRAY['URGENT','HIGH','NORMAL','LOW'], p.priority)`,
  updated_at: 'p.updated_at',
};

export const stageOwnerSql = `CASE
  WHEN p.status IN ('DRAFT','B_REJECTED','C_QUERY') OR (p.status='D_REJECTED' AND p.return_to_stage='A') THEN 'A'
  WHEN p.status IN ('SUBMITTED','PENDING_B_APPROVAL') THEN 'B'
  WHEN p.status IN ('PENDING_D_APPROVAL','PAYMENT_INITIATED') THEN 'D'
  WHEN p.status IN ('B_APPROVED','PENDING_C_VERIFICATION','A_RESUBMITTED','C_VERIFIED','ACCOUNTING_VERIFIED','D_APPROVED','PAYMENT_FAILED') OR (p.status='D_REJECTED' AND p.return_to_stage='C') THEN 'C'
  ELSE NULL END`;
