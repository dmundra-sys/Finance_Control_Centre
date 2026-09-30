import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, download, errMsg } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Badge, Btn, Card, Empty, ErrorBox, Field, Icon, Loading, PageHeader, Pagination, PriorityBadge, StatusBadge, useAsync, useDebounced, useToast } from '../components/ui';
import { Stage } from '../components/parts';
import { fmtDate, money } from '../lib/format';

const QUEUE_LABEL: Record<string, string> = {
  a_my: 'My payment requests', a_draft: 'My drafts', a_pending_b: 'Pending B approval', a_b_rejected: 'B rejected', a_c_query: 'C query / returned', a_resubmitted: 'Resubmitted', a_completed: 'Completed',
  b_pending: 'Pending my approval', b_approved_today: 'Approved today', b_approved: 'Approved by me', b_rejected: 'Rejected by me', b_returned: 'Returned by me',
  c_verification: 'Pending verification', c_query: 'Query raised', c_ready: 'Ready for payment', c_pending_d: 'Pending D approval', c_approved: 'Approved – awaiting bank completion', c_completed: 'Completed',
  d_pending: 'Pending final approval', d_approved_today: 'Approved today', d_rejected: 'Rejected', d_approved: 'Approved (all)', pending_any: 'All pending', rejected_any: 'Rejected / returned', open: 'Open', all: 'All',
};
const COLS: [string, string, string?][] = [['pa_number', 'Payment Advice'], ['vendor', 'Vendor / Company'], ['invoice_number', 'Invoice'], ['net_payable', 'Net payable'], ['due_date', 'Due'], ['status', 'Status']];

export default function PaymentsList() {
  const [sp, setSp] = useSearchParams(); const { can } = useAuth(); const toast = useToast();
  const meta = useAsync(() => api.get('/payments/meta'), []);
  const [q, setQ] = useState(sp.get('q') ?? ''); const dq = useDebounced(q, 350);
  const [showF, setShowF] = useState(false); const [exporting, setExporting] = useState(false);
  const f = useMemo(() => Object.fromEntries(sp.entries()), [sp]);
  const setF = (k: string, v: string) => setSp((p) => { const n = new URLSearchParams(p); if (v) n.set(k, v); else n.delete(k); if (k !== 'page') n.delete('page'); return n; }, { replace: true });
  useEffect(() => { if ((sp.get('q') ?? '') !== dq) setF('q', dq); /* eslint-disable-next-line */ }, [dq]);
  const params = { ...f, page_size: 25 };
  const list = useAsync(() => api.get('/payments', params), [sp.toString()]);
  const m = meta.data as any; const d = list.data as any;
  const activeCount = ['status', 'company_id', 'vendor_id', 'bank_name', 'payment_mode', 'payment_type', 'priority', 'created_by', 'date_from', 'date_to', 'min_amount', 'max_amount', 'invoice_no'].filter((k) => f[k]).length;
  const sort = f.sort ?? 'updated_at'; const dir = f.dir ?? 'desc';
  const sortBy = (k: string) => setSp((p) => { const n = new URLSearchParams(p); n.set('sort', k); n.set('dir', sort === k && dir === 'desc' ? 'asc' : 'desc'); return n; }, { replace: true });
  const SORTABLE = ['pa_number', 'created_at', 'company', 'vendor', 'net_payable', 'due_date', 'priority', 'status', 'invoice_number'];
  return (
    <div>
      <PageHeader title="Payment Advices" subtitle={f.queue ? <>Filtered: <b>{QUEUE_LABEL[f.queue] ?? f.queue}</b> · <button className="link" onClick={() => setF('queue', '')}>clear</button></> : 'Search, filter and export every Payment Advice you are allowed to see.'}
        actions={<>
          {can('payment.export') && <Btn busy={exporting} className="btn-outline" onClick={async () => { setExporting(true); try { await download(api.url('/payments/export.xlsx', f), `payments-${new Date().toISOString().slice(0, 10)}.xlsx`); } catch (e) { toast.err(e); } finally { setExporting(false); } }}><Icon name="download" className="h-4 w-4" />Export Excel</Btn>}
          {can('payment.create') && <Link to="/payments/new" className="btn-primary"><Icon name="plus" className="h-4 w-4" />New</Link>}
        </>} />
      <Card pad={false}>
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 p-3">
          <div className="relative min-w-[220px] flex-1"><Icon name="search" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><input className="input !pl-9" placeholder="PA no., vendor, invoice, UTR, bank ref, amount…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
          <button className="btn-outline" onClick={() => setShowF(!showF)}><Icon name="sliders" className="h-4 w-4" />Filters{activeCount > 0 && <Badge tone="blue">{activeCount}</Badge>}</button>
          {(activeCount > 0 || f.q) && <button className="btn-ghost" onClick={() => { setQ(''); setSp({}, { replace: true }); }}>Clear all</button>}
        </div>
        {showF && m && (
          <div className="grid gap-3 border-b border-slate-100 bg-slate-50/60 p-3 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Status"><select className="input" value={f.status ?? ''} onChange={(e) => setF('status', e.target.value)}><option value="">All statuses</option>{m.statuses.map((s: any) => <option key={s.code} value={s.code}>{s.label}</option>)}</select></Field>
            <Field label="Company"><select className="input" value={f.company_id ?? ''} onChange={(e) => setF('company_id', e.target.value)}><option value="">All companies</option>{m.companies.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
            <Field label="Vendor / party"><select className="input" value={f.vendor_id ?? ''} onChange={(e) => setF('vendor_id', e.target.value)}><option value="">All vendors</option>{m.vendors.map((v: any) => <option key={v.id} value={v.id}>{v.name}</option>)}</select></Field>
            <Field label="Bank"><input className="input" placeholder="e.g. HDFC" defaultValue={f.bank_name ?? ''} onBlur={(e) => setF('bank_name', e.target.value)} /></Field>
            <Field label="Payment mode"><select className="input" value={f.payment_mode ?? ''} onChange={(e) => setF('payment_mode', e.target.value)}><option value="">All modes</option>{m.modes.map((x: any) => <option key={x.code} value={x.code}>{x.name}</option>)}</select></Field>
            <Field label="Payment type"><select className="input" value={f.payment_type ?? ''} onChange={(e) => setF('payment_type', e.target.value)}><option value="">All types</option>{m.paymentTypes.map((x: any) => <option key={x.code} value={x.code}>{x.name}</option>)}</select></Field>
            <Field label="Priority"><select className="input" value={f.priority ?? ''} onChange={(e) => setF('priority', e.target.value)}><option value="">Any</option>{m.priorities.map((x: string) => <option key={x}>{x}</option>)}</select></Field>
            <Field label="Created by"><select className="input" value={f.created_by ?? ''} onChange={(e) => setF('created_by', e.target.value)}><option value="">Anyone</option>{m.users.filter((u: any) => u.role_code === 'A').map((u: any) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></Field>
            <Field label="From date"><input type="date" className="input" value={f.date_from ?? ''} onChange={(e) => setF('date_from', e.target.value)} /></Field>
            <Field label="To date"><input type="date" className="input" value={f.date_to ?? ''} onChange={(e) => setF('date_to', e.target.value)} /></Field>
            <Field label="Min amount (₹)"><input type="number" className="input" defaultValue={f.min_amount ?? ''} onBlur={(e) => setF('min_amount', e.target.value)} /></Field>
            <Field label="Max amount (₹)"><input type="number" className="input" defaultValue={f.max_amount ?? ''} onBlur={(e) => setF('max_amount', e.target.value)} /></Field>
            <Field label="Invoice number"><input className="input" defaultValue={f.invoice_no ?? ''} onBlur={(e) => setF('invoice_no', e.target.value)} /></Field>
          </div>)}
        {list.loading && !d ? <Loading /> : list.error ? <div className="p-4"><ErrorBox error={list.error} retry={list.reload} /></div> : d.rows.length === 0 ? <Empty title="No Payment Advices match" hint="Try removing some filters or searching for something else." /> : (
          <>
            <div className="hidden overflow-x-auto md:block"><table className="w-full min-w-[860px] [&_.th]:px-2 [&_.td]:px-2">
              <thead><tr>{COLS.map(([k, l]) => (<th key={k} className={`th ${k === 'net_payable' ? 'text-right' : ''}`}>{SORTABLE.includes(k) ? <button className="inline-flex items-center gap-1 hover:text-slate-800" onClick={() => sortBy(k)}>{l}{sort === k && <span>{dir === 'asc' ? '▲' : '▼'}</span>}</button> : l}</th>))}<th className="th">With</th></tr></thead>
              <tbody className={`divide-y divide-slate-100 ${list.loading ? 'opacity-60' : ''}`}>
                {d.rows.map((r: any) => (
                  <tr key={r.id} className="hover:bg-slate-50/70">
                    <td className="td whitespace-nowrap"><Link className="link" to={`/payments/${r.id}`}>{r.pa_number}</Link>{r.version_no > 1 && <span className="ml-1 text-[10px] text-slate-400">v{r.version_no}</span>}{r.priority && r.priority !== 'NORMAL' && <span className="ml-2 align-middle"><PriorityBadge p={r.priority} /></span>}<div className="text-[11px] text-slate-400">{fmtDate(r.created_at)}</div></td>
                    <td className="td max-w-[220px]"><div className="truncate" title={r.vendor}>{r.vendor}</div><div className="text-[11px] text-slate-400">{r.company_short}</div></td>
                    <td className="td">{r.invoice_number}</td><td className="td num text-right font-medium">{money(r.net_payable)}</td><td className="td whitespace-nowrap">{fmtDate(r.due_date)}</td>
                    <td className="td"><StatusBadge label={r.status_label} color={r.status_color} /></td><td className="td"><Stage s={r.stage_owner} /></td>
                  </tr>))}
              </tbody></table></div>
            <ul className="divide-y divide-slate-100 md:hidden">
              {d.rows.map((r: any) => (
                <li key={r.id}><Link to={`/payments/${r.id}`} className="block px-4 py-3 active:bg-slate-50">
                  <div className="flex items-start justify-between gap-2"><span className="font-semibold text-navy-800">{r.pa_number}</span><span className="num font-semibold">{money(r.net_payable)}</span></div>
                  <div className="mt-0.5 truncate text-sm text-slate-600">{r.vendor}</div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs text-slate-500"><StatusBadge label={r.status_label} color={r.status_color} /><PriorityBadge p={r.priority} /><span>{r.company_short}</span><span>· Due {fmtDate(r.due_date)}</span></div>
                </Link></li>))}
            </ul>
            <div className="flex flex-wrap items-center justify-between border-t border-slate-100"><Pagination page={d.page} pageSize={d.pageSize} total={d.total} onPage={(p) => setF('page', String(p))} /><div className="px-4 text-xs text-slate-500">Total net payable: <b className="num text-slate-700">{money(d.total_amount)}</b></div></div>
          </>)}
      </Card>
    </div>
  );
}
