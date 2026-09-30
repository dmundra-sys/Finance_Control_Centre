import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { Badge, Btn, Card, Empty, ErrorBox, Field, Icon, Loading, PageHeader, Pagination, useAsync, useDebounced, useToast } from '../components/ui';
import { fmtDateTime } from '../lib/format';

export default function AuditTrail() {
  const toast = useToast(); const [f, setF] = useState<any>({ page: 1 }); const q = useDebounced(f, 350); const [open, setOpen] = useState<number | null>(null);
  const r = useAsync(() => api.get('/admin/audit-logs', q), [JSON.stringify(q)]);
  const [ver, setVer] = useState<any>(null); const [busy, setBusy] = useState(false);
  const set = (k: string, v: any) => setF((p: any) => ({ ...p, [k]: v, page: k === 'page' ? v : 1 }));
  const d = r.data as any;
  return (
    <div>
      <PageHeader title="Audit Trail" subtitle="Every action is recorded with user, role, time and IP. Entries cannot be edited or deleted — each one is hash-chained to the previous."
        actions={<Btn busy={busy} className="btn-outline" onClick={async () => { setBusy(true); try { setVer(await api.get('/admin/audit-verify')); } catch (e) { toast.err(e); } finally { setBusy(false); } }}><Icon name="shield" className="h-4 w-4" />Verify integrity</Btn>} />
      {ver && <div className={`mb-4 rounded-lg border px-4 py-3 text-sm ${ver.ok ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-red-300 bg-red-50 text-red-800'}`}>{ver.ok ? <><b>Chain intact.</b> {ver.checked} entries verified — no tampering detected.</> : <><b>Integrity failure!</b> The chain breaks at entry #{ver.brokenAtId}.</>}</div>}
      <div className="card mb-4 grid gap-3 p-3 sm:grid-cols-2 lg:grid-cols-5">
        <Field label="Search"><input className="input" placeholder="PA no., text…" value={f.q ?? ''} onChange={(e) => set('q', e.target.value)} /></Field>
        <Field label="User"><input className="input" value={f.user ?? ''} onChange={(e) => set('user', e.target.value)} /></Field>
        <Field label="Action"><input className="input" placeholder="e.g. APPROVED" value={f.action ?? ''} onChange={(e) => set('action', e.target.value)} /></Field>
        <Field label="From"><input type="date" className="input" value={f.date_from ?? ''} onChange={(e) => set('date_from', e.target.value)} /></Field>
        <Field label="To"><input type="date" className="input" value={f.date_to ?? ''} onChange={(e) => set('date_to', e.target.value)} /></Field>
      </div>
      <Card pad={false}>
        {r.loading && !d ? <Loading /> : r.error ? <div className="p-4"><ErrorBox error={r.error} retry={r.reload} /></div> : d.rows.length === 0 ? <Empty title="No audit entries match" /> : (
          <><div className="overflow-x-auto"><table className="w-full min-w-[900px]"><thead><tr><th className="th">#</th><th className="th">Date & time</th><th className="th">User</th><th className="th">Action</th><th className="th">Payment</th><th className="th">Details</th><th className="th">IP</th></tr></thead>
            <tbody className="divide-y divide-slate-100">{d.rows.map((a: any) => (
              <tr key={a.id} className="align-top hover:bg-slate-50/70"><td className="td text-xs text-slate-400">{a.id}</td><td className="td whitespace-nowrap text-xs">{fmtDateTime(a.at)}</td><td className="td text-xs"><div className="font-medium">{a.user_name ?? 'System'}</div><div className="text-slate-400">{a.role_code}</div></td>
                <td className="td"><Badge tone={/REJECT|CANCEL|FAIL|OVERRIDE|LOCK/.test(a.action) ? 'red' : /APPROV|VERIFIED|COMPLETED|LOGIN$/.test(a.action) ? 'green' : 'slate'}>{a.action.replace(/_/g, ' ')}</Badge></td>
                <td className="td text-xs">{a.pa_number ? <Link className="link" to={`/payments/${a.payment_id ?? ''}`}>{a.pa_number}</Link> : '—'}</td>
                <td className="td max-w-lg text-sm">{a.remarks}{(a.old_value || a.new_value) && <button className="ml-2 text-[11px] font-semibold text-navy-600 hover:underline" onClick={() => setOpen(open === a.id ? null : a.id)}>{open === a.id ? 'hide' : 'old / new'}</button>}{open === a.id && <pre className="mt-2 max-h-56 overflow-auto rounded bg-slate-900 p-2 text-[11px] text-slate-100">{JSON.stringify({ old: a.old_value, new: a.new_value }, null, 1)}</pre>}</td><td className="td whitespace-nowrap text-xs text-slate-400">{a.ip}</td></tr>))}</tbody></table></div>
            <Pagination page={d.page} pageSize={d.pageSize} total={d.total} onPage={(p) => set('page', p)} /></>)}
      </Card>
    </div>
  );
}
