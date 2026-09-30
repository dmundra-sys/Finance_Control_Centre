const inr = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2, minimumFractionDigits: 0 });
const inr2 = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2, minimumFractionDigits: 2 });
/** ₹5,25,000 (Indian digit grouping) */
export const formatINR = (n: number | string | null | undefined) => `₹${inr.format(Number(n ?? 0))}`;
export const formatINR2 = (n: number | string | null | undefined) => `₹${inr2.format(Number(n ?? 0))}`;
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const IST = 'Asia/Kolkata';
function parts(d: Date) {
  const f = new Intl.DateTimeFormat('en-GB', { timeZone: IST, day: '2-digit', month: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  const o: Record<string, string> = {};
  for (const p of f.formatToParts(d)) o[p.type] = p.value;
  return o;
}
/** 30-Sep-2026 */
export function fmtDate(v: Date | string | null | undefined): string {
  if (!v) return '—';
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) { const [y, m, d] = v.split('-'); return `${d}-${MONTHS[+m - 1]}-${y}`; }
  const p = parts(new Date(v)); return `${p.day}-${MONTHS[+p.month - 1]}-${p.year}`;
}
/** 14:32:05 IST */
export function fmtTime(v: Date | string | null | undefined): string {
  if (!v) return '—'; const p = parts(new Date(v)); return `${p.hour}:${p.minute}:${p.second}`;
}
export const fmtDateTime = (v: Date | string | null | undefined) => (v ? `${fmtDate(v)} ${fmtTime(v)}` : '—');
export const isoDate = (d: Date) => { const p = parts(d); return `${p.year}-${String(p.month).padStart(2, '0')}-${p.day}`; };
export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
export function fill(tpl: string, vars: Record<string, unknown>): string {
  return tpl.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => (vars[k] == null ? '' : String(vars[k])));
}
