import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { Badge, Card, Empty, ErrorBox, Loading, PageHeader, PriorityBadge, StatusBadge, useAsync } from '../components/ui';
import { fmtDate, money } from '../lib/format';

const TONE: Record<string, string> = { VERIFIED: 'green', PENDING: 'amber', 'IN PROGRESS': 'blue', 'QUERY RAISED': 'red', 'NOT INITIATED': 'slate', INITIATED: 'blue', APPROVED: 'green', PROCESSED: 'green', RECONCILED: 'green', FAILED: 'red', RETURNED: 'red', REVERSED: 'red' };
const GROUPS = [
  ['all', 'All'], ['verify', 'To verify'], ['query', 'Query raised'], ['ready', 'Ready for bank'], ['dwait', 'With D'], ['approved', 'Approved'], ['problem', 'Rejected / failed'],
];
const inGroup = (g: string, r: any) => g === 'all' || (g === 'verify' && ['PENDING_C_VERIFICATION', 'A_RESUBMITTED'].includes(r.status)) || (g === 'query' && r.status === 'C_QUERY')
  || (g === 'ready' && ['C_VERIFIED', 'ACCOUNTING_VERIFIED'].includes(r.status)) || (g === 'dwait' && ['PAYMENT_INITIATED', 'PENDING_D_APPROVAL'].includes(r.status)) || (g === 'approved' && r.status === 'D_APPROVED') || (g === 'problem' && ['D_REJECTED', 'PAYMENT_FAILED'].includes(r.status));

export default function Queue() {
  const { data, error, loading, reload } = useAsync(() => api.get<any[]>('/payments/queue'), []);
  const [g, setG] = useState('all'); const [q, setQ] = useState('');
  const rows = useMemo(() => (data ?? []).filter((r) => inGroup(g, r) && (!q || `${r.pa_number} ${r.company} ${r.party}`.toLowerCase().includes(q.toLowerCase()))), [data, g, q]);
  return (
    <div>
      <PageHeader title="Payment Processing Queue" subtitle="Everything B has approved and is now with you: verify originals, complete accounting, initiate on the bank portal." actions={<button className="btn-outline" onClick={reload}>Refresh</button>} />
      <Card pad={false}>
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 p-3">
          <div className="flex flex-wrap gap-1.5">{GROUPS.map(([k, l]) => { const n = (data ?? []).filter((r) => inGroup(k, r)).length; return <button key={k} onClick={() => setG(k)} className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${g === k ? 'bg-navy-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>{l} <span className="opacity-70">{n}</span></button>; })}</div>
          <input className="input ml-auto !w-full sm:!w-64" placeholder="Filter by PA no., company, party…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        {loading && !data ? <Loading /> : error ? <div className="p-4"><ErrorBox error={error} retry={reload} /></div> : rows.length === 0 ? <Empty title="Nothing in this view" hint="Payments appear here after B approval." /> : (
          <div className="overflow-x-auto"><table className="w-full min-w-[1100px]">
            <thead><tr><th className="th">Payment Advice</th><th className="th">Company</th><th className="th">Party</th><th className="th text-right">Net payable</th><th className="th">B approval</th><th className="th">Documents</th><th className="th">Accounting</th><th className="th">Bank</th><th className="th">Priority</th><th className="th">Due</th><th className="th">Status</th></tr></thead>
            <tbody className="divide-y divide-slate-100">{rows.map((r) => (
              <tr key={r.id} className="hover:bg-slate-50/70">
                <td className="td whitespace-nowrap"><Link className="link" to={`/payments/${r.id}`}>{r.pa_number}</Link></td><td className="td max-w-[130px] truncate" title={r.company}>{r.company}</td><td className="td max-w-[170px] truncate" title={r.party}>{r.party}</td>
                <td className="td num text-right font-medium">{money(r.net_payable)}</td>
                <td className="td text-xs"><div>{fmtDate(r.b_approval_date)}</div><div className="text-slate-400">{r.b_approver}</div></td>
                <td className="td"><Badge tone={TONE[r.doc_status]}>{r.doc_status}</Badge></td><td className="td"><Badge tone={TONE[r.accounting_status]}>{r.accounting_status}</Badge></td><td className="td"><Badge tone={TONE[r.bank_status]}>{r.bank_status}</Badge></td>
                <td className="td"><PriorityBadge p={r.priority} /></td><td className="td whitespace-nowrap">{fmtDate(r.due_date)}</td><td className="td"><StatusBadge label={r.status_label} color={r.status_color} /></td>
              </tr>))}</tbody></table></div>)}
      </Card>
    </div>
  );
}
