import { query, type Db, pool } from '../db.js';

export interface ApprovalLevel { label: string; senior: boolean; count: number }
export interface ApprovalPlan { matrix_id: number | null; matrix_name: string; b_levels: ApprovalLevel[]; d_count: number }

export const FALLBACK_PLAN: ApprovalPlan = { matrix_id: null, matrix_name: 'Default (B + D)', b_levels: [{ label: 'Payment Approver', senior: false, count: 1 }], d_count: 1 };

/** Select the most specific active approval-matrix rule for the payment. Nothing is hard-coded: all limits live in approval_matrix. */
export async function resolvePlan(p: { company_id: number; department?: string | null; bank_account_id: number; payment_type: string; net_payable: number }, db: Db = pool): Promise<ApprovalPlan> {
  const rows = await query<any>(
    `SELECT *, ((company_id IS NOT NULL)::int + (department IS NOT NULL)::int + (bank_account_id IS NOT NULL)::int + (payment_type IS NOT NULL)::int) AS specificity
       FROM approval_matrix
      WHERE is_active
        AND (company_id IS NULL OR company_id=$1)
        AND (department IS NULL OR department=$2)
        AND (bank_account_id IS NULL OR bank_account_id=$3)
        AND (payment_type IS NULL OR payment_type=$4)
        AND min_amount <= $5 AND (max_amount IS NULL OR $5 <= max_amount)
      ORDER BY specificity DESC, sort_order ASC, id ASC LIMIT 1`,
    [p.company_id, p.department ?? null, p.bank_account_id, p.payment_type, p.net_payable], db);
  if (!rows[0]) return FALLBACK_PLAN;
  const r = rows[0];
  return { matrix_id: r.id, matrix_name: r.name, b_levels: r.b_levels, d_count: r.d_count };
}
