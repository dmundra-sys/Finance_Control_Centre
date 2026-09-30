const inr = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2, minimumFractionDigits: 0 });
const inr2 = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2, minimumFractionDigits: 2 });
export const money = (v: any, full = false) => (v == null || v === '' ? '—' : '₹' + (full ? inr2 : inr).format(Number(v)));
export const compact = (v: any) => {
  const n = Number(v ?? 0); const a = Math.abs(n);
  if (a >= 1e7) return '₹' + (n / 1e7).toFixed(2).replace(/\.?0+$/, '') + ' Cr';
  if (a >= 1e5) return '₹' + (n / 1e5).toFixed(2).replace(/\.?0+$/, '') + ' L';
  if (a >= 1e3) return '₹' + (n / 1e3).toFixed(1).replace(/\.0$/, '') + ' K';
  return '₹' + n;
};
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function fmtDate(v: any) {
  if (!v) return '—';
  const s = String(v);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) { const [y, m, d] = s.split('-'); return `${d}-${MON[+m - 1]}-${y}`; }
  const d = new Date(s); if (isNaN(+d)) return '—';
  const ist = new Date(d.getTime() + 5.5 * 3600000);
  return `${String(ist.getUTCDate()).padStart(2, '0')}-${MON[ist.getUTCMonth()]}-${ist.getUTCFullYear()}`;
}
export function fmtDateTime(v: any) {
  if (!v) return '—'; const d = new Date(v); if (isNaN(+d)) return '—';
  const ist = new Date(d.getTime() + 5.5 * 3600000);
  const hh = ist.getUTCHours(); const h12 = hh % 12 || 12;
  return `${fmtDate(v)} ${String(h12).padStart(2, '0')}:${String(ist.getUTCMinutes()).padStart(2, '0')} ${hh < 12 ? 'AM' : 'PM'}`;
}
export const todayIso = () => { const d = new Date(Date.now() + 5.5 * 3600000); return d.toISOString().slice(0, 10); };
export const bytes = (n: number) => (n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB');
export const ago = (v: any) => {
  const s = (Date.now() - new Date(v).getTime()) / 1000;
  if (s < 60) return 'just now'; if (s < 3600) return Math.floor(s / 60) + ' min ago'; if (s < 86400) return Math.floor(s / 3600) + ' h ago';
  return Math.floor(s / 86400) + ' d ago';
};
export const toTitle = (s: string) => s.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
