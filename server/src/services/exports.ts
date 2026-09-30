import ExcelJS from 'exceljs';
import { query } from '../db.js';
import { type SessionUser } from './access.js';
import { PAYMENT_FROM, buildPaymentWhere, type PaymentFilters } from './paymentQuery.js';

export const INR_FMT = '[>=10000000]##\\,##\\,##\\,##0.00;[>=100000]##\\,##\\,##0.00;##,##0.00';
export const DATE_FMT = 'dd-mmm-yyyy';

const EXPORT_SQL = `
  SELECT p.pa_number, (p.created_at AT TIME ZONE 'Asia/Kolkata')::date AS advice_date, c.name AS company, v.name AS vendor, p.invoice_number, p.invoice_date,
         p.gross_amount, p.gst_amount, p.tds_amount, p.other_deduction, p.net_payable, p.payment_mode, bk.bank_name, cr.name AS created_by,
         (SELECT string_agg(u.name, ', ' ORDER BY a.id) FROM payment_approvals a JOIN users u ON u.id=a.approver_id WHERE a.payment_id=p.id AND a.stage='B' AND a.decision='APPROVED' AND a.round_no=p.approval_round) AS b_by,
         (SELECT max(a.decided_at) FROM payment_approvals a WHERE a.payment_id=p.id AND a.stage='B' AND a.decision='APPROVED' AND a.round_no=p.approval_round) AS b_date,
         (SELECT u.name FROM document_verifications dv JOIN users u ON u.id=dv.verifier_id WHERE dv.payment_id=p.id AND dv.result='VERIFIED' ORDER BY dv.id DESC LIMIT 1) AS c_by,
         (SELECT dv.verified_at FROM document_verifications dv WHERE dv.payment_id=p.id AND dv.result='VERIFIED' ORDER BY dv.id DESC LIMIT 1) AS c_date,
         ae.voucher_no, bi.name AS bank_initiated_by, bt.initiated_at AS bank_initiated_at, bt.bank_ref_no,
         (SELECT string_agg(u.name, ', ' ORDER BY a.id) FROM payment_approvals a JOIN users u ON u.id=a.approver_id WHERE a.payment_id=p.id AND a.stage='D' AND a.decision='APPROVED' AND a.round_no=p.bank_round) AS d_by,
         (SELECT max(a.decided_at) FROM payment_approvals a WHERE a.payment_id=p.id AND a.stage='D' AND a.decision='APPROVED' AND a.round_no=p.bank_round) AS d_date,
         bt.utr, s.label AS status_label, p.remarks
  ${PAYMENT_FROM}
  LEFT JOIN accounting_entries ae ON ae.payment_id = p.id
  LEFT JOIN bank_transactions bt ON bt.payment_id = p.id AND bt.is_current
  LEFT JOIN users bi ON bi.id = bt.initiated_by`;

const COLS: [string, string, 'text' | 'money' | 'date' | 'datetime', number][] = [
  ['pa_number', 'Payment Advice No.', 'text', 18], ['advice_date', 'Date', 'date', 13], ['company', 'Company', 'text', 30], ['vendor', 'Vendor', 'text', 30], ['invoice_number', 'Invoice No.', 'text', 16],
  ['invoice_date', 'Invoice Date', 'date', 13], ['gross_amount', 'Gross Amount', 'money', 16], ['gst_amount', 'GST', 'money', 14], ['tds_amount', 'TDS', 'money', 14], ['other_deduction', 'Other Deduction', 'money', 15],
  ['net_payable', 'Net Payable', 'money', 16], ['payment_mode', 'Payment Mode', 'text', 14], ['bank_name', 'Bank', 'text', 22], ['created_by', 'Created By', 'text', 20],
  ['b_by', 'B Approval By', 'text', 22], ['b_date', 'B Approval Date', 'datetime', 20], ['c_by', 'C Verification By', 'text', 20], ['c_date', 'C Verification Date', 'datetime', 20],
  ['voucher_no', 'Accounting Voucher No.', 'text', 20], ['bank_initiated_by', 'Bank Initiated By', 'text', 20], ['bank_initiated_at', 'Bank Initiation Date', 'datetime', 20], ['bank_ref_no', 'Bank Reference No.', 'text', 22],
  ['d_by', 'D Approval By', 'text', 20], ['d_date', 'D Approval Date', 'datetime', 20], ['utr', 'UTR', 'text', 24], ['status_label', 'Final Status', 'text', 24], ['remarks', 'Remarks', 'text', 40],
];

export async function exportPaymentsXlsx(user: SessionUser, f: PaymentFilters): Promise<Buffer> {
  const params: any[] = [];
  const where = buildPaymentWhere(user, f, params);
  const rows = await query<any>(`${EXPORT_SQL} WHERE ${where} ORDER BY p.id DESC LIMIT 20000`, params);
  const wb = new ExcelJS.Workbook(); wb.creator = 'Payment Approval & Banking Workflow'; wb.created = new Date();
  const ws = wb.addWorksheet('Payments', { views: [{ state: 'frozen', ySplit: 1, xSplit: 1 }] });
  ws.columns = COLS.map(([key, header, , w]) => ({ key, header, width: w }));
  const head = ws.getRow(1); head.height = 30;
  head.eachCell((c) => { c.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 }; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F2A4A' } }; c.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }; c.border = { bottom: { style: 'thin', color: { argb: 'FF94A3B8' } } }; });
  for (const r of rows) {
    const row: any = {};
    for (const [k, , t] of COLS) {
      const v = r[k];
      row[k] = v == null ? null : t === 'date' ? (typeof v === 'string' ? new Date(v + 'T00:00:00Z') : v) : v;
    }
    ws.addRow(row);
  }
  COLS.forEach(([key, , t], i) => {
    const col = ws.getColumn(i + 1);
    if (t === 'money') { col.numFmt = INR_FMT; col.alignment = { horizontal: 'right' }; }
    if (t === 'date') col.numFmt = DATE_FMT;
    if (t === 'datetime') col.numFmt = 'dd-mmm-yyyy hh:mm';
    void key;
  });
  if (rows.length) {
    const t = ws.addRow({ pa_number: 'TOTAL', gross_amount: { formula: `SUM(G2:G${rows.length + 1})` }, gst_amount: { formula: `SUM(H2:H${rows.length + 1})` }, tds_amount: { formula: `SUM(I2:I${rows.length + 1})` },
      other_deduction: { formula: `SUM(J2:J${rows.length + 1})` }, net_payable: { formula: `SUM(K2:K${rows.length + 1})` } });
    t.font = { bold: true }; t.eachCell((c) => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } }; c.border = { top: { style: 'thin' } }; });
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: rows.length + 1, column: COLS.length } };
  }
  const info = wb.addWorksheet('Export info');
  info.addRows([['Exported by', user.name], ['Exported at', new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) + ' IST'], ['Records', rows.length], ['Filters', JSON.stringify(Object.fromEntries(Object.entries(f).filter(([, v]) => v)))]]);
  info.getColumn(1).font = { bold: true }; info.getColumn(1).width = 16; info.getColumn(2).width = 80;
  return Buffer.from(await wb.xlsx.writeBuffer());
}
