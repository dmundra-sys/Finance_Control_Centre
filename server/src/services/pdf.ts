import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
import path from 'node:path';
import { config } from '../config.js';
import { formatINR2, fmtDate, fmtDateTime } from '../lib/format.js';
import { one, query } from '../db.js';
import { getPaymentDetail } from './payments.js';
import type { SessionUser } from './access.js';
import { audit, type Ctx } from './audit.js';

const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
function below1000(n: number): string { let s = ''; if (n >= 100) { s += ONES[Math.floor(n / 100)] + ' Hundred '; n %= 100; } if (n >= 20) { s += TENS[Math.floor(n / 10)] + ' '; n %= 10; } if (n > 0) s += ONES[n] + ' '; return s; }
/** Indian numbering: Crore / Lakh / Thousand */
export function amountInWords(amount: number): string {
  const rupees = Math.floor(amount); const paise = Math.round((amount - rupees) * 100);
  if (rupees === 0 && paise === 0) return 'Rupees Zero Only';
  let n = rupees; let s = '';
  const crore = Math.floor(n / 10000000); n %= 10000000; const lakh = Math.floor(n / 100000); n %= 100000; const th = Math.floor(n / 1000); n %= 1000;
  if (crore) s += below1000(crore) + 'Crore '; if (lakh) s += below1000(lakh) + 'Lakh '; if (th) s += below1000(th) + 'Thousand '; if (n) s += below1000(n);
  return `Rupees ${s.trim()}${paise ? ` and ${below1000(paise).trim()} Paise` : ''} Only`;
}

export async function paymentAdvicePdf(ctx: Ctx | null, user: SessionUser, paymentId: number): Promise<{ buffer: Buffer; filename: string }> {
  const d = await getPaymentDetail(user, paymentId);
  const p = d.payment; const v = d.vendor;
  const logoRow = await one<{ logo_data: string | null }>('SELECT logo_data FROM companies WHERE id=$1', [p.company_id]);
  const verifyUrl = `${config.appBaseUrl}/verify/${p.pa_number}`;
  const qr = await QRCode.toBuffer(`PAWF|${p.pa_number}|${verifyUrl}`, { margin: 1, width: 240, errorCorrectionLevel: 'M' });

  const doc = new PDFDocument({ size: 'A4', margin: 36, bufferPages: true, info: { Title: `Payment Advice ${p.pa_number}`, Author: 'Payment Approval & Banking Workflow' } });
  const chunks: Buffer[] = []; doc.on('data', (c) => chunks.push(c));
  const done = new Promise<Buffer>((res) => doc.on('end', () => res(Buffer.concat(chunks))));
  doc.registerFont('R', path.join(config.fontsDir, 'DejaVuSans.ttf')); doc.registerFont('B', path.join(config.fontsDir, 'DejaVuSans-Bold.ttf'));
  const L = 36; const W = doc.page.width - 72; const NAVY = '#0f2a4a'; const GREY = '#64748b'; const LINE = '#cbd5e1';
  let y = 36;

  // ---------- header
  doc.rect(L, y, W, 62).fill(NAVY);
  const logoBox = { x: L + 10, y: y + 9, s: 44 };
  let logoDrawn = false;
  if (logoRow?.logo_data) { try { doc.image(Buffer.from(logoRow.logo_data.split(',')[1], 'base64'), logoBox.x, logoBox.y, { fit: [logoBox.s, logoBox.s] }); logoDrawn = true; } catch { /* fall back to monogram */ } }
  if (!logoDrawn) { doc.roundedRect(logoBox.x, logoBox.y, logoBox.s, logoBox.s, 6).fill('#ffffff'); doc.font('B').fontSize(16).fillColor(NAVY).text((p.company_short ?? p.company_name).slice(0, 3).toUpperCase(), logoBox.x, logoBox.y + 14, { width: logoBox.s, align: 'center' }); }
  doc.font('B').fontSize(13).fillColor('#ffffff').text(p.company_name, L + 64, y + 12, { width: W - 190 });
  doc.font('R').fontSize(7.5).fillColor('#cbd5e1').text([p.cin && `CIN ${p.cin}`, p.company_pan && `PAN ${p.company_pan}`, p.company_gstin && `GSTIN ${p.company_gstin}`].filter(Boolean).join('  ·  '), L + 64, y + 30, { width: W - 190 });
  doc.text((p.company_address ?? '').slice(0, 110), L + 64, y + 42, { width: W - 190 });
  doc.font('B').fontSize(9).fillColor('#93c5fd').text('PAYMENT ADVICE', L + W - 130, y + 10, { width: 120, align: 'right' });
  doc.font('B').fontSize(13).fillColor('#ffffff').text(p.pa_number, L + W - 150, y + 24, { width: 140, align: 'right' });
  doc.font('R').fontSize(8).fillColor('#cbd5e1').text(`Date: ${fmtDate(p.created_at)}`, L + W - 150, y + 44, { width: 140, align: 'right' });
  y += 72;

  // status + QR
  doc.image(qr, L + W - 74, y - 2, { width: 74 });
  doc.font('B').fontSize(9).fillColor(GREY).text('CURRENT STATUS', L, y);
  doc.font('B').fontSize(12).fillColor(NAVY).text(p.status_label, L, y + 12);
  doc.font('R').fontSize(7.5).fillColor(GREY).text(`Version ${p.version_no}${p.is_amendment ? ' (amended)' : ''} · Priority ${p.priority} · Prepared by ${p.created_by_name}`, L, y + 30, { width: W - 90 });
  doc.text(`Scan QR to verify: ${verifyUrl}`, L, y + 42, { width: W - 90 });
  y += 80;

  const section = (title: string) => { if (y > 730) { doc.addPage(); y = 36; } doc.rect(L, y, W, 15).fill('#eef2f7'); doc.font('B').fontSize(8.5).fillColor(NAVY).text(title.toUpperCase(), L + 6, y + 3.5); y += 19; };
  const kv = (rows: [string, string][], cols = 2) => {
    const cw = W / cols; const lh = 24;
    rows.forEach(([k, val], i) => {
      const cx = L + (i % cols) * cw; const cy = y + Math.floor(i / cols) * lh;
      doc.font('R').fontSize(7).fillColor(GREY).text(k, cx + 4, cy, { width: cw - 8, lineBreak: false });
      doc.font('B').fontSize(8.5).fillColor('#0f172a').text(val || '—', cx + 4, cy + 9, { width: cw - 8, height: 12, ellipsis: true, lineBreak: false });
    });
    y += Math.ceil(rows.length / cols) * lh + 4;
  };
  const table = (head: string[], widths: number[], rows: string[][], right: number[] = []) => {
    const tw = widths.reduce((a, b) => a + b, 0); const ws = widths.map((w) => (w / tw) * W);
    const drawHead = () => { doc.rect(L, y, W, 15).fill(NAVY); let x = L; doc.font('B').fontSize(7).fillColor('#fff'); head.forEach((h, i) => { doc.text(h, x + 3, y + 4, { width: ws[i] - 6, align: right.includes(i) ? 'right' : 'left', lineBreak: false }); x += ws[i]; }); y += 16; };
    drawHead();
    rows.forEach((r, ri) => {
      if (y > 780) { doc.addPage(); y = 36; drawHead(); }
      if (ri % 2) doc.rect(L, y - 1, W, 14).fill('#f8fafc');
      let x = L; doc.font('R').fontSize(7.5).fillColor('#0f172a');
      r.forEach((cell, i) => { doc.text(cell, x + 3, y + 2, { width: ws[i] - 6, height: 11, ellipsis: true, lineBreak: false, align: right.includes(i) ? 'right' : 'left' }); x += ws[i]; });
      y += 14;
    });
    doc.moveTo(L, y).lineTo(L + W, y).strokeColor(LINE).lineWidth(0.5).stroke(); y += 6;
  };

  section('Vendor / party details');
  kv([['Vendor', `${v?.name} (${v?.vendor_code})`], ['PAN / GSTIN', `${v?.pan ?? '—'} / ${v?.gstin ?? '—'}`], ['Contact', [v?.contact_person, v?.mobile].filter(Boolean).join(' · ')], ['E-mail', v?.email ?? ''], ['TDS section / MSME', `${v?.tds_section ?? '—'} / ${v?.msme_status}`], ['GST registration', v?.gst_registration ?? '']]);
  section('Invoice details');
  kv([['Invoice number', p.invoice_number], ['Invoice date', fmtDate(p.invoice_date)], ['PO number', p.po_number ?? ''], ['GRN / receipt', p.grn_reference ?? ''], ['Purpose', p.purpose ?? ''], ['Remarks', p.remarks ?? '']]);
  if (d.items.length) table(['#', 'Description', 'HSN/SAC', 'Qty', 'Rate', 'Amount'], [4, 40, 10, 8, 14, 16], d.items.map((i: any) => [String(i.line_no), i.description, i.hsn_sac ?? '', String(i.quantity), formatINR2(i.rate), formatINR2(i.amount)]), [3, 4, 5]);
  section('Payment details');
  kv([['Payment type', p.payment_type], ['Payment mode', p.payment_mode], ['Due date', fmtDate(p.due_date)], ['Approval rule', d.approval_progress.matrix ?? '—']], 4);
  table(['Particulars', 'Amount (₹)'], [70, 30], [['Gross invoice amount (incl. GST)', formatINR2(p.gross_amount)], ['  of which GST', formatINR2(p.gst_amount)], ['Less: TDS', formatINR2(p.tds_amount)], ['Less: other deductions', formatINR2(p.other_deduction)], ['Less: advance adjustment', formatINR2(p.advance_adjustment)], ['NET PAYABLE', formatINR2(p.net_payable)]], [1]);
  doc.font('B').fontSize(8).fillColor(NAVY).text(amountInWords(p.net_payable), L, y - 2, { width: W }); y += 16;

  section('Bank details');
  kv([['Paying bank', `${p.bank_name} · ${p.branch ?? ''}`], ['Paying account', `${p.account_name} · XXXX XXXX ${p.account_last4}`], ['IFSC', p.bank_ifsc], ['Bank portal', p.bank_portal ?? ''],
    ['Beneficiary', p.beneficiary_name ?? ''], ['Beneficiary bank', `${p.beneficiary_bank_name ?? ''} · ${p.beneficiary_account_masked}`], ['Beneficiary IFSC', p.beneficiary_ifsc ?? ''], ['', '']]);
  const bt = d.bank_transactions.filter((t: any) => t.is_current).pop();
  if (bt) kv([['Bank reference', bt.bank_ref_no ?? ''], ['UTR', bt.utr ?? '—'], ['Initiated by / at', `${bt.initiated_by_name} · ${fmtDateTime(bt.initiated_at)}`], ['Bank status', bt.bank_status]]);

  section('Accounting details');
  const a = d.accounting;
  if (a) kv([['Ledger account', a.ledger_account ?? ''], ['Cost centre', a.cost_centre ?? ''], ['Department / project', `${a.department ?? '—'} / ${a.project ?? '—'}`], ['GST treatment', a.gst_treatment ?? ''], ['TDS section', a.tds_section ?? ''], ['Voucher no. / date', `${a.voucher_no ?? '—'} · ${fmtDate(a.accounting_date)}`], ['ERP reference', a.erp_reference ?? ''], ['Verified by', a.verified ? `${a.verified_by_name} · ${fmtDateTime(a.verified_at)}` : 'Pending']]);
  else doc.font('R').fontSize(8).fillColor(GREY).text('Accounting verification not yet performed.', L + 4, y), (y += 16);

  section('Supporting documents');
  table(['Document', 'Type', 'Ver.', 'Uploaded by', 'Uploaded on', 'Status'], [34, 20, 6, 18, 20, 10], d.documents.map((x: any) => [x.doc_name, x.doc_type, `v${x.version}`, x.uploaded_by_name, fmtDateTime(x.uploaded_at), x.status]));

  section('Authorisation');
  const bA = d.approvals.filter((x: any) => x.stage === 'B' && x.decision === 'APPROVED' && x.round_no === p.approval_round);
  const dA = d.approvals.filter((x: any) => x.stage === 'D' && x.decision === 'APPROVED' && x.round_no === p.bank_round);
  const cV = [...d.verifications].reverse().find((x: any) => x.result === 'VERIFIED');
  const boxes: [string, string, string][] = [
    ['PREPARED BY (A)', p.created_by_name, fmtDateTime(p.submitted_at ?? p.created_at)],
    ['B APPROVAL', bA.map((x: any) => x.approver_name).join(', ') || 'Pending', bA.length ? fmtDateTime(bA[bA.length - 1].decided_at) : ''],
    ['C VERIFICATION', cV ? cV.verifier_name : 'Pending', cV ? fmtDateTime(cV.verified_at) : ''],
    ['D APPROVAL', dA.map((x: any) => x.approver_name).join(', ') || 'Pending', dA.length ? fmtDateTime(dA[dA.length - 1].decided_at) : ''],
  ];
  const bw = W / 4;
  boxes.forEach(([t, n, when], i) => { const x = L + i * bw; doc.rect(x + 2, y, bw - 4, 52).strokeColor(LINE).lineWidth(0.6).stroke(); doc.font('B').fontSize(6.5).fillColor(GREY).text(t, x + 7, y + 5, { width: bw - 14 }); doc.font('B').fontSize(8.5).fillColor('#0f172a').text(n, x + 7, y + 20, { width: bw - 14, height: 20, ellipsis: true }); doc.font('R').fontSize(6.5).fillColor(GREY).text(when, x + 7, y + 41, { width: bw - 14, lineBreak: false }); });
  y += 62;

  section('Complete approval history');
  table(['Date & time', 'Status', 'By', 'Remarks'], [20, 24, 18, 38], d.history.map((h: any) => [fmtDateTime(h.at), h.to_label, h.changed_by_name ?? 'System', h.remarks ?? '']));

  // ---------- footer / watermark
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(i);
    if (p.is_demo) { doc.save(); doc.rotate(-30, { origin: [300, 420] }); doc.font('B').fontSize(60).fillColor('#94a3b8').fillOpacity(0.08).text('DEMO DATA', 90, 380, { lineBreak: false }); doc.restore(); doc.fillOpacity(1); }
    doc.font('R').fontSize(6.5).fillColor('#94a3b8').text(`System generated document · ${p.pa_number} · Printed ${fmtDateTime(new Date())} IST by ${user.name}`, L, doc.page.height - 30, { width: W - 60, lineBreak: false });
    doc.text(`Page ${i + 1} of ${range.count}`, L + W - 60, doc.page.height - 30, { width: 60, align: 'right', lineBreak: false });
  }
  doc.end();
  const buffer = await done;
  if (ctx) await audit(ctx, { action: 'PAYMENT_ADVICE_PDF_GENERATED', entityType: 'payment', entityId: paymentId, paymentId, remarks: `${user.name} generated the Payment Advice PDF for ${p.pa_number}.` });
  return { buffer, filename: `${p.pa_number}.pdf` };
}
void query;
