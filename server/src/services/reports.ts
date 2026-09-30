import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import path from 'node:path';
import { query } from '../db.js';
import { config } from '../config.js';
import { paymentScope, type SessionUser } from './access.js';
import { PAYMENT_FROM, buildPaymentWhere, type PaymentFilters } from './paymentQuery.js';
import { INR_FMT, DATE_FMT } from './exports.js';
import { formatINR2, fmtDate, fmtDateTime } from '../lib/format.js';
import { forbidden, notFound } from '../lib/errors.js';
import { can } from './access.js';

type ColType = 'text' | 'money' | 'date' | 'datetime' | 'int';
export interface Col { key: string; label: string; type: ColType; width?: number }
interface ReportDef { key: string; title: string; description: string; columns: Col[]; run: (u: SessionUser, f: PaymentFilters) => Promise<any[]> }

const c = (key: string, label: string, type: ColType = 'text', width = 18): Col => ({ key, label, type, width });
const payCols = [c('pa_number', 'Payment Advice', 'text', 17), c('advice_date', 'Date', 'date', 12), c('company', 'Company', 'text', 26), c('vendor', 'Vendor', 'text', 28), c('invoice_number', 'Invoice No.', 'text', 15), c('net_payable', 'Net Payable', 'money', 15), c('status_label', 'Status', 'text', 22)];
const base = `p.pa_number, (p.created_at AT TIME ZONE 'Asia/Kolkata')::date AS advice_date, c.name AS company, v.name AS vendor, p.invoice_number, p.invoice_date, p.gross_amount, p.net_payable, p.due_date, s.label AS status_label`;

async function payRows(u: SessionUser, f: PaymentFilters, select: string, extraWhere = 'true', extraFrom = '', order = 'p.id DESC', tail = '') {
  const params: any[] = []; const where = buildPaymentWhere(u, f, params);
  return query<any>(`SELECT ${select} ${PAYMENT_FROM} ${extraFrom} WHERE ${where} AND ${extraWhere} ${tail} ORDER BY ${order} LIMIT 20000`, params);
}
const group = (u: SessionUser, f: PaymentFilters, keySql: string, labelAlias: string, extraSel = '') => {
  const params: any[] = []; const where = buildPaymentWhere(u, f, params);
  return query<any>(`SELECT ${keySql} AS ${labelAlias}, count(*)::int AS payments, COALESCE(sum(p.gross_amount),0) AS gross, COALESCE(sum(p.net_payable),0) AS net,
      COALESCE(sum(p.net_payable) FILTER (WHERE p.status IN ('D_APPROVED','PAYMENT_COMPLETED')),0) AS approved_amount,
      COALESCE(sum(p.net_payable) FILTER (WHERE p.status NOT IN ('D_APPROVED','PAYMENT_COMPLETED','CANCELLED','PAYMENT_REVERSED','DRAFT')),0) AS pending_amount ${extraSel}
      ${PAYMENT_FROM} WHERE ${where} GROUP BY ${keySql} ORDER BY net DESC`, params);
};
const grpCols = (label: string): Col[] => [c('label', label, 'text', 32), c('payments', 'Payments', 'int', 10), c('gross', 'Gross Amount', 'money', 16), c('net', 'Net Payable', 'money', 16), c('approved_amount', 'Approved / Completed', 'money', 18), c('pending_amount', 'In Process', 'money', 16)];

export const REPORTS: ReportDef[] = [
  { key: 'payment_register', title: 'Payment Register', description: 'Every Payment Advice with its current status.', columns: [...payCols, c('bank_name', 'Bank', 'text', 20), c('payment_mode', 'Mode', 'text', 10), c('created_by', 'Created By', 'text', 18)],
    run: (u, f) => payRows(u, f, `${base}, bk.bank_name, p.payment_mode, cr.name AS created_by`) },
  { key: 'pending_approval', title: 'Pending Approval Report', description: 'Payments waiting at B, C or D, with days pending.', columns: [c('pa_number', 'Payment Advice', 'text', 17), c('company', 'Company', 'text', 26), c('vendor', 'Vendor', 'text', 28), c('net_payable', 'Net Payable', 'money', 15), c('status_label', 'Waiting At', 'text', 24), c('priority', 'Priority', 'text', 10), c('due_date', 'Due Date', 'date', 12), c('days_pending', 'Days Pending', 'int', 12)],
    run: (u, f) => payRows(u, f, `p.pa_number, c.name AS company, v.name AS vendor, p.net_payable, s.label AS status_label, p.priority, p.due_date, (CURRENT_DATE - (p.updated_at AT TIME ZONE 'Asia/Kolkata')::date)::int AS days_pending`,
      `p.status IN ('PENDING_B_APPROVAL','PENDING_C_VERIFICATION','A_RESUBMITTED','C_VERIFIED','ACCOUNTING_VERIFIED','PENDING_D_APPROVAL','PAYMENT_INITIATED')`, '', 'days_pending DESC') },
  { key: 'vendor_wise', title: 'Vendor-wise Payment Report', description: 'Payment totals grouped by vendor.', columns: grpCols('Vendor'), run: async (u, f) => (await group(u, f, 'v.name', 'label')) },
  { key: 'company_wise', title: 'Company-wise Payment Report', description: 'Payment totals grouped by company.', columns: grpCols('Company'), run: async (u, f) => (await group(u, f, 'c.name', 'label')) },
  { key: 'bank_wise', title: 'Bank-wise Payment Report', description: 'Payment totals grouped by paying bank account.', columns: grpCols('Bank account'),
    run: async (u, f) => (await group(u, f, `bk.bank_name || ' – ' || c.short_name || ' (XXXX ' || bk.account_last4 || ')'`, 'label')) },
  { key: 'user_wise', title: 'User-wise Payment Report', description: 'Actions performed by each user across the workflow.', columns: [c('user_name', 'User', 'text', 24), c('role_code', 'Role', 'text', 10), c('created', 'Created (A)', 'int', 12), c('b_approved', 'B Approvals', 'int', 12), c('b_rejected', 'B Rejections/Returns', 'int', 18), c('c_verified', 'C Verified', 'int', 12), c('c_queries', 'C Queries', 'int', 10), c('c_initiated', 'C Initiated', 'int', 12), c('d_approved', 'D Approvals', 'int', 12), c('d_rejected', 'D Rejections', 'int', 12), c('amount', 'Amount Handled', 'money', 16)],
    run: async (u, f) => {
      const params: any[] = []; const where = buildPaymentWhere(u, f, params);
      return query<any>(`WITH scoped AS (SELECT p.id, p.net_payable, p.created_by ${PAYMENT_FROM} WHERE ${where}),
        ev AS (
          SELECT created_by AS uid, 'created' AS k, id, net_payable FROM scoped
          UNION ALL SELECT a.approver_id, CASE WHEN a.stage='B' AND a.decision='APPROVED' THEN 'b_approved' WHEN a.stage='B' THEN 'b_rejected' WHEN a.decision='APPROVED' THEN 'd_approved' ELSE 'd_rejected' END, s.id, s.net_payable FROM payment_approvals a JOIN scoped s ON s.id=a.payment_id
          UNION ALL SELECT d.verifier_id, CASE WHEN d.result='VERIFIED' THEN 'c_verified' ELSE 'c_queries' END, s.id, s.net_payable FROM document_verifications d JOIN scoped s ON s.id=d.payment_id
          UNION ALL SELECT t.initiated_by, 'c_initiated', s.id, s.net_payable FROM bank_transactions t JOIN scoped s ON s.id=t.payment_id)
        SELECT us.name AS user_name, us.role_code, count(*) FILTER (WHERE k='created')::int AS created, count(*) FILTER (WHERE k='b_approved')::int AS b_approved, count(*) FILTER (WHERE k='b_rejected')::int AS b_rejected,
          count(*) FILTER (WHERE k='c_verified')::int AS c_verified, count(*) FILTER (WHERE k='c_queries')::int AS c_queries, count(*) FILTER (WHERE k='c_initiated')::int AS c_initiated,
          count(*) FILTER (WHERE k='d_approved')::int AS d_approved, count(*) FILTER (WHERE k='d_rejected')::int AS d_rejected, COALESCE(sum(net_payable),0) AS amount
        FROM ev JOIN users us ON us.id=ev.uid GROUP BY us.id, us.name, us.role_code ORDER BY us.role_code, us.name`, params);
    } },
  { key: 'rejected', title: 'Rejected Payment Report', description: 'All rejections and returns by B and D.', columns: [c('pa_number', 'Payment Advice', 'text', 17), c('vendor', 'Vendor', 'text', 26), c('net_payable', 'Net Payable', 'money', 15), c('stage', 'Rejected By Stage', 'text', 14), c('by', 'Rejected By', 'text', 20), c('reason', 'Reason', 'text', 44), c('at', 'Date', 'datetime', 18), c('state', 'State', 'text', 10)],
    run: (u, f) => payRows(u, f, `p.pa_number, v.name AS vendor, p.net_payable, q.raised_by_stage AS stage, qu.name AS by, q.reason, q.raised_at AS at, q.status AS state`, `q.category IN ('REJECTION','RETURN','D_REJECTION')`, 'JOIN payment_queries q ON q.payment_id = p.id JOIN users qu ON qu.id = q.raised_by', 'q.raised_at DESC') },
  { key: 'query_resubmission', title: 'Query / Resubmission Report', description: 'Queries raised, their resolution and turnaround.', columns: [c('pa_number', 'Payment Advice', 'text', 17), c('vendor', 'Vendor', 'text', 24), c('stage', 'Raised At', 'text', 10), c('by', 'Raised By', 'text', 18), c('reason', 'Query', 'text', 40), c('required', 'Required', 'text', 28), c('raised_at', 'Raised', 'datetime', 18), c('resolved_at', 'Resolved', 'datetime', 18), c('hours', 'Turnaround (hrs)', 'int', 14), c('state', 'State', 'text', 10)],
    run: (u, f) => payRows(u, f, `p.pa_number, v.name AS vendor, q.raised_by_stage AS stage, qu.name AS by, q.reason, COALESCE(q.required_document, q.required_correction) AS required, q.raised_at, q.resolved_at, CASE WHEN q.resolved_at IS NOT NULL THEN round(extract(epoch FROM q.resolved_at - q.raised_at)/3600)::int END AS hours, q.status AS state`, 'true', 'JOIN payment_queries q ON q.payment_id = p.id JOIN users qu ON qu.id = q.raised_by', 'q.raised_at DESC') },
  { key: 'ageing', title: 'Payment Ageing Report', description: 'Open payments by age since creation and days past due.', columns: [c('pa_number', 'Payment Advice', 'text', 17), c('company', 'Company', 'text', 26), c('vendor', 'Vendor', 'text', 28), c('net_payable', 'Net Payable', 'money', 15), c('status_label', 'Status', 'text', 22), c('due_date', 'Due Date', 'date', 12), c('age_days', 'Age (days)', 'int', 10), c('overdue_days', 'Days Past Due', 'int', 12), c('bucket', 'Ageing Bucket', 'text', 14)],
    run: (u, f) => payRows(u, f, `p.pa_number, c.name AS company, v.name AS vendor, p.net_payable, s.label AS status_label, p.due_date, (CURRENT_DATE - (p.created_at AT TIME ZONE 'Asia/Kolkata')::date)::int AS age_days, GREATEST(CURRENT_DATE - p.due_date, 0)::int AS overdue_days,
        CASE WHEN CURRENT_DATE - (p.created_at AT TIME ZONE 'Asia/Kolkata')::date <= 7 THEN '0–7 days' WHEN CURRENT_DATE - (p.created_at AT TIME ZONE 'Asia/Kolkata')::date <= 15 THEN '8–15 days' WHEN CURRENT_DATE - (p.created_at AT TIME ZONE 'Asia/Kolkata')::date <= 30 THEN '16–30 days' WHEN CURRENT_DATE - (p.created_at AT TIME ZONE 'Asia/Kolkata')::date <= 60 THEN '31–60 days' ELSE '60+ days' END AS bucket`,
      `p.status NOT IN ('DRAFT','CANCELLED','PAYMENT_COMPLETED','PAYMENT_REVERSED','D_APPROVED')`, '', 'age_days DESC') },
  { key: 'completed', title: 'Completed Payment Report', description: 'Approved and completed payments with bank references.', columns: [c('pa_number', 'Payment Advice', 'text', 17), c('company', 'Company', 'text', 26), c('vendor', 'Vendor', 'text', 26), c('net_payable', 'Net Payable', 'money', 15), c('bank_name', 'Bank', 'text', 20), c('payment_mode', 'Mode', 'text', 10), c('bank_ref_no', 'Bank Ref.', 'text', 20), c('utr', 'UTR', 'text', 22), c('actual_debit_date', 'Debit Date', 'date', 12), c('status_label', 'Status', 'text', 20)],
    run: (u, f) => payRows(u, f, `p.pa_number, c.name AS company, v.name AS vendor, p.net_payable, bk.bank_name, p.payment_mode, t.bank_ref_no, t.utr, t.actual_debit_date, s.label AS status_label`, `p.status IN ('D_APPROVED','PAYMENT_COMPLETED')`, 'LEFT JOIN bank_transactions t ON t.payment_id=p.id AND t.is_current', 'p.completed_at DESC NULLS LAST, p.id DESC') },
  { key: 'failed', title: 'Failed Payment Report', description: 'Failed or reversed bank payments.', columns: [c('pa_number', 'Payment Advice', 'text', 17), c('company', 'Company', 'text', 26), c('vendor', 'Vendor', 'text', 26), c('net_payable', 'Net Payable', 'money', 15), c('bank_name', 'Bank', 'text', 20), c('bank_ref_no', 'Bank Ref.', 'text', 20), c('bank_status', 'Bank Status', 'text', 12), c('remarks', 'Remarks', 'text', 40), c('status_label', 'Status', 'text', 20)],
    run: (u, f) => payRows(u, f, `p.pa_number, c.name AS company, v.name AS vendor, p.net_payable, bk.bank_name, t.bank_ref_no, t.bank_status, t.remarks, s.label AS status_label`, `(p.status IN ('PAYMENT_FAILED','PAYMENT_REVERSED'))`, 'LEFT JOIN bank_transactions t ON t.payment_id=p.id AND t.is_current') },
  { key: 'audit_trail', title: 'Audit Trail Report', description: 'Chronological audit trail of every recorded action.', columns: [c('at', 'Date & Time', 'datetime', 20), c('user_name', 'User', 'text', 20), c('role_code', 'Role', 'text', 9), c('action', 'Action', 'text', 28), c('pa_number', 'Payment Advice', 'text', 16), c('remarks', 'Description', 'text', 56), c('ip', 'IP Address', 'text', 15)],
    run: async (u, f) => {
      const p: any[] = []; const w: string[] = [];
      const pay: any[] = []; const scope = paymentScope(u, 'px', pay);
      // audit rows are visible when they relate to a payment in the user's scope, or are system-level (admin/auditor only)
      const sysOk = u.roles.some((r) => r === 'ADMIN' || r === 'AUDITOR');
      p.push(...pay);
      w.push(`(a.payment_id IS NULL AND ${sysOk ? 'true' : 'false'} OR a.payment_id IN (SELECT px.id FROM payment_advises px WHERE ${scope}))`);
      if (f.date_from) { p.push(f.date_from); w.push(`(a.at AT TIME ZONE 'Asia/Kolkata')::date >= $${p.length}::date`); }
      if (f.date_to) { p.push(f.date_to); w.push(`(a.at AT TIME ZONE 'Asia/Kolkata')::date <= $${p.length}::date`); }
      if (f.company_id) { p.push(Number(f.company_id)); w.push(`a.payment_id IN (SELECT id FROM payment_advises WHERE company_id=$${p.length})`); }
      if (f.vendor_id) { p.push(Number(f.vendor_id)); w.push(`a.payment_id IN (SELECT id FROM payment_advises WHERE vendor_id=$${p.length})`); }
      if (f.q) { p.push(`%${f.q}%`); w.push(`(a.action ILIKE $${p.length} OR a.remarks ILIKE $${p.length} OR a.user_name ILIKE $${p.length})`); }
      return query<any>(`SELECT a.at, a.user_name, a.role_code, a.action, pa.pa_number, a.remarks, a.ip FROM audit_logs a LEFT JOIN payment_advises pa ON pa.id=a.payment_id WHERE ${w.join(' AND ')} ORDER BY a.id DESC LIMIT 5000`, p);
    } },
];

export const reportList = () => REPORTS.map((r) => ({ key: r.key, title: r.title, description: r.description }));

function normalise(def: ReportDef, rows: any[]) {
  return rows.map((r) => { const o: any = { ...r }; if ('label' in def.columns.map((x) => x.key).reduce((a: any, k) => ((a[k] = 1), a), {}) && r.label === undefined) o.label = r.vendor ?? r.company ?? ''; return o; });
}

export async function runReport(u: SessionUser, key: string, f: PaymentFilters) {
  const def = REPORTS.find((r) => r.key === key); if (!def) throw notFound('Unknown report.');
  if (!(await can(u, 'report.view'))) throw forbidden();
  if (key === 'audit_trail' && !(await can(u, 'audit.view')) && !u.roles.some((r) => ['B', 'C', 'D'].includes(r))) throw forbidden('You do not have access to the audit trail report.');
  const rows = normalise(def, await def.run(u, f));
  return { key, title: def.title, description: def.description, columns: def.columns, rows };
}

export async function reportXlsx(u: SessionUser, key: string, f: PaymentFilters): Promise<Buffer> {
  const rep = await runReport(u, key, f);
  const wb = new ExcelJS.Workbook(); wb.creator = 'Payment Approval & Banking Workflow';
  const ws = wb.addWorksheet(rep.title.replace(/[*?:\\/\[\]]/g, '-').slice(0, 31), { views: [{ state: 'frozen', ySplit: 3 }] });
  ws.mergeCells(1, 1, 1, Math.max(rep.columns.length, 4)); ws.getCell(1, 1).value = rep.title; ws.getCell(1, 1).font = { bold: true, size: 14, color: { argb: 'FF0F2A4A' } };
  ws.mergeCells(2, 1, 2, Math.max(rep.columns.length, 4)); ws.getCell(2, 1).value = `Generated ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST by ${u.name} · ${rep.rows.length} rows`; ws.getCell(2, 1).font = { color: { argb: 'FF64748B' }, size: 9 };
  const hr = ws.getRow(3); rep.columns.forEach((col, i) => { const cell = hr.getCell(i + 1); cell.value = col.label; cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 }; cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F2A4A' } }; cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }; ws.getColumn(i + 1).width = col.width ?? 16; });
  hr.height = 28;
  for (const r of rep.rows) {
    const row = ws.addRow(rep.columns.map((col) => { const v = r[col.key]; return v == null ? null : col.type === 'date' && typeof v === 'string' ? new Date(v + 'T00:00:00Z') : v; }));
    rep.columns.forEach((col, i) => { const cell = row.getCell(i + 1); if (col.type === 'money') { cell.numFmt = INR_FMT; } else if (col.type === 'date') cell.numFmt = DATE_FMT; else if (col.type === 'datetime') cell.numFmt = 'dd-mmm-yyyy hh:mm'; });
  }
  const moneyCols = rep.columns.map((col, i) => ({ col, i })).filter((x) => x.col.type === 'money' && rep.rows.length);
  if (moneyCols.length && rep.rows.length > 1 && ['vendor_wise', 'company_wise', 'bank_wise'].includes(key)) {
    const tr = ws.addRow(['TOTAL']); moneyCols.forEach(({ i }) => { const L = ws.getColumn(i + 1).letter; tr.getCell(i + 1).value = { formula: `SUM(${L}4:${L}${rep.rows.length + 3})` }; tr.getCell(i + 1).numFmt = INR_FMT; }); tr.font = { bold: true };
  }
  ws.autoFilter = { from: { row: 3, column: 1 }, to: { row: 3 + rep.rows.length, column: rep.columns.length } };
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export async function reportPdf(u: SessionUser, key: string, f: PaymentFilters): Promise<Buffer> {
  const rep = await runReport(u, key, f);
  const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 28, bufferPages: true });
  const chunks: Buffer[] = []; doc.on('data', (d) => chunks.push(d));
  const done = new Promise<Buffer>((res) => doc.on('end', () => res(Buffer.concat(chunks))));
  doc.registerFont('R', path.join(config.fontsDir, 'DejaVuSans.ttf')); doc.registerFont('B', path.join(config.fontsDir, 'DejaVuSans-Bold.ttf'));
  const W = doc.page.width - 56; const totalW = rep.columns.reduce((s, x) => s + (x.width ?? 16), 0);
  const widths = rep.columns.map((x) => ((x.width ?? 16) / totalW) * W);
  const fmt = (col: Col, v: any) => v == null ? '' : col.type === 'money' ? formatINR2(v) : col.type === 'date' ? fmtDate(v) : col.type === 'datetime' ? fmtDateTime(v) : String(v);
  const header = () => {
    doc.font('B').fontSize(14).fillColor('#0f2a4a').text(rep.title, 28, 28);
    doc.font('R').fontSize(7.5).fillColor('#64748b').text(`Generated ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST · ${u.name} · ${rep.rows.length} rows`, 28, 46);
    let x = 28; const y = 62; doc.rect(28, y, W, 18).fill('#0f2a4a');
    doc.font('B').fontSize(7).fillColor('#ffffff');
    rep.columns.forEach((col, i) => { doc.text(col.label, x + 3, y + 5, { width: widths[i] - 6, height: 12, ellipsis: true, align: col.type === 'money' || col.type === 'int' ? 'right' : 'left' }); x += widths[i]; });
    return y + 20;
  };
  let y = header(); let zebra = false;
  doc.font('R').fontSize(7);
  for (const r of rep.rows) {
    if (y > doc.page.height - 50) { doc.addPage(); y = header(); doc.font('R').fontSize(7); }
    if (zebra) doc.rect(28, y - 1, W, 15).fill('#f1f5f9'); zebra = !zebra;
    let x = 28; doc.fillColor('#0f172a');
    rep.columns.forEach((col, i) => { doc.text(fmt(col, r[col.key]), x + 3, y + 2, { width: widths[i] - 6, height: 11, ellipsis: true, lineBreak: false, align: col.type === 'money' || col.type === 'int' ? 'right' : 'left' }); x += widths[i]; });
    y += 15;
  }
  if (!rep.rows.length) doc.font('R').fontSize(9).fillColor('#64748b').text('No records match the selected filters.', 28, y + 10);
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) { doc.switchToPage(i); doc.font('R').fontSize(7).fillColor('#94a3b8').text(`Page ${i + 1} of ${range.count}`, 28, doc.page.height - 26, { width: W, align: 'right', lineBreak: false }); }
  doc.end(); return done;
}
