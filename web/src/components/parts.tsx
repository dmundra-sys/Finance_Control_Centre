import { Link } from 'react-router-dom';
import clsx from 'clsx';
import { Badge, PriorityBadge, StatusBadge } from './ui';
import { fmtDate, money } from '../lib/format';

export const STAGE_TONE: Record<string, string> = { A: 'blue', B: 'amber', C: 'teal', D: 'indigo', BANK: 'purple', DONE: 'green', CLOSED: 'slate', NONE: 'slate' };
export function Stage({ s }: { s?: string }) { if (!s) return <span className="text-slate-400">—</span>; return <Badge tone={STAGE_TONE[s] ?? 'slate'}>{['A', 'B', 'C', 'D'].includes(s) ? `With ${s}` : s}</Badge>; }

export const CARD_TONE: Record<string, { bar: string; text: string; bg: string }> = {
  blue: { bar: 'bg-blue-500', text: 'text-blue-700', bg: 'bg-blue-50' }, amber: { bar: 'bg-amber-500', text: 'text-amber-700', bg: 'bg-amber-50' },
  green: { bar: 'bg-emerald-500', text: 'text-emerald-700', bg: 'bg-emerald-50' }, red: { bar: 'bg-red-500', text: 'text-red-700', bg: 'bg-red-50' },
  teal: { bar: 'bg-teal-500', text: 'text-teal-700', bg: 'bg-teal-50' }, indigo: { bar: 'bg-indigo-500', text: 'text-indigo-700', bg: 'bg-indigo-50' },
  orange: { bar: 'bg-orange-500', text: 'text-orange-700', bg: 'bg-orange-50' }, slate: { bar: 'bg-slate-400', text: 'text-slate-700', bg: 'bg-slate-50' }, purple: { bar: 'bg-purple-500', text: 'text-purple-700', bg: 'bg-purple-50' },
};
export function StatCard({ label, value, sub, tone = 'blue', to }: { label: string; value: React.ReactNode; sub?: React.ReactNode; tone?: string; to?: string }) {
  const t = CARD_TONE[tone] ?? CARD_TONE.blue;
  const inner = (
    <div className={clsx('card relative overflow-hidden p-4 transition', to && 'hover:-translate-y-0.5 hover:shadow-md')}>
      <span className={clsx('absolute inset-y-0 left-0 w-1', t.bar)} />
      <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</div>
      <div className={clsx('num mt-1.5 text-2xl font-bold', t.text)}>{value}</div>
      {sub != null && <div className="num mt-0.5 text-xs text-slate-500">{sub}</div>}
    </div>
  );
  return to ? <Link to={to} className="block">{inner}</Link> : inner;
}

export function PaymentRowsTable({ rows, empty }: { rows: any[]; empty?: string }) {
  if (!rows.length) return <div className="px-4 py-10 text-center text-sm text-slate-500">{empty ?? 'Nothing here right now.'}</div>;
  return (
    <div className="overflow-x-auto"><table className="w-full min-w-[560px]">
      <thead><tr><th className="th">Payment Advice</th><th className="th">Vendor</th><th className="th text-right">Net payable</th><th className="th">Due</th><th className="th">Priority</th><th className="th">Status</th></tr></thead>
      <tbody className="divide-y divide-slate-100">
        {rows.map((r) => (
          <tr key={r.id} className="hover:bg-slate-50/70">
            <td className="td whitespace-nowrap"><Link className="link" to={`/payments/${r.id}`}>{r.pa_number}</Link></td><td className="td max-w-[200px]"><div className="truncate" title={r.vendor}>{r.vendor}</div><div className="text-[11px] text-slate-400">{r.company}</div></td>
            <td className="td num text-right font-medium">{money(r.net_payable)}</td><td className="td whitespace-nowrap">{fmtDate(r.due_date)}</td><td className="td"><PriorityBadge p={r.priority} /></td>
            <td className="td"><StatusBadge label={r.status_label} color={r.status_color} /></td>
          </tr>))}
      </tbody></table></div>
  );
}
