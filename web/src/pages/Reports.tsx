import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, download } from '../lib/api';
import { Btn, Card, Empty, ErrorBox, Field, Icon, Loading, PageHeader, useAsync, useToast } from '../components/ui';
import { fmtDate, fmtDateTime, money } from '../lib/format';

const ICON: Record<string, string> = { payment_register: 'book', pending_approval: 'clock', vendor_wise: 'users', company_wise: 'building', bank_wise: 'bank', user_wise: 'users', rejected: 'alert', query_resubmission: 'msg', ageing: 'clock', completed: 'check', failed: 'alert', audit_trail: 'shield' };

export default function Reports() {
  const { key } = useParams(); const nav = useNavigate();
  const list = useAsync(() => api.get<any[]>('/reports'), []);
  if (!key) return (
    <div>
      <PageHeader title="Reports" subtitle="Twelve standard reports. Every report can be filtered and exported to Excel or PDF." />
      {list.loading ? <Loading /> : list.error ? <ErrorBox error={list.error} retry={list.reload} /> : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{(list.data as any[]).map((r) => (
          <Link key={r.key} to={`/reports/${r.key}`} className="card group flex gap-3 p-4 transition hover:-translate-y-0.5 hover:shadow-md"><div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-navy-50 text-navy-700 group-hover:bg-navy-900 group-hover:text-white"><Icon name={ICON[r.key] ?? 'file'} /></div><div><div className="text-sm font-semibold text-navy-900">{r.title}</div><div className="mt-0.5 text-xs text-slate-500">{r.description}</div></div></Link>))}</div>)}
    </div>);
  return <ReportView k={key} onBack={() => nav('/reports')} />;
}

function ReportView({ k, onBack }: { k: string; onBack: () => void }) {
  const toast = useToast(); const meta = useAsync(() => api.get('/payments/meta'), []); const [f, setF] = useState<any>({}); const [busy, setBusy] = useState('');
  const r = useAsync(() => api.get(`/reports/${k}`, f), [k, JSON.stringify(f)]);
  const set = (x: string, v: string) => setF((p: any) => ({ ...p, [x]: v })); const m = meta.data as any; const d = r.data as any;
  const cell = (c: any, v: any) => v == null || v === '' ? '—' : c.type === 'money' ? money(v, true) : c.type === 'date' ? fmtDate(v) : c.type === 'datetime' ? fmtDateTime(v) : c.type === 'number' ? Number(v).toLocaleString('en-IN') : typeof v === 'object' ? JSON.stringify(v) : String(v);
  const exp = async (ext: 'xlsx' | 'pdf') => { setBusy(ext); try { await download(api.url(`/reports/${k}/export.${ext}`, f), `${k}.${ext}`); } catch (e) { toast.err(e); } finally { setBusy(''); } };
  return (
    <div>
      <div className="mb-3 text-sm"><button className="text-slate-500 hover:text-navy-700" onClick={onBack}>← All reports</button></div>
      <PageHeader title={d?.title ?? 'Report'} subtitle={d?.description} actions={<><Btn busy={busy === 'xlsx'} className="btn-outline" onClick={() => exp('xlsx')}><Icon name="download" className="h-4 w-4" />Excel</Btn><Btn busy={busy === 'pdf'} className="btn-outline" onClick={() => exp('pdf')}><Icon name="file" className="h-4 w-4" />PDF</Btn></>} />
      <div className="card mb-4 grid gap-3 p-3 sm:grid-cols-2 lg:grid-cols-5">
        <Field label="From date"><input type="date" className="input" value={f.date_from ?? ''} onChange={(e) => set('date_from', e.target.value)} /></Field>
        <Field label="To date"><input type="date" className="input" value={f.date_to ?? ''} onChange={(e) => set('date_to', e.target.value)} /></Field>
        <Field label="Company"><select className="input" value={f.company_id ?? ''} onChange={(e) => set('company_id', e.target.value)}><option value="">All</option>{m?.companies.map((c: any) => <option key={c.id} value={c.id}>{c.short_name}</option>)}</select></Field>
        <Field label="Vendor"><select className="input" value={f.vendor_id ?? ''} onChange={(e) => set('vendor_id', e.target.value)}><option value="">All</option>{m?.vendors.map((v: any) => <option key={v.id} value={v.id}>{v.name}</option>)}</select></Field>
        <div className="flex items-end"><button className="btn-outline w-full" onClick={() => setF({})}>Reset</button></div>
      </div>
      <Card pad={false}>
        {r.loading && !d ? <Loading /> : r.error ? <div className="p-4"><ErrorBox error={r.error} retry={r.reload} /></div> : d.rows.length === 0 ? <Empty title="No data for these filters" /> : (
          <><div className="overflow-x-auto"><table className="w-full"><thead><tr>{d.columns.map((c: any) => <th key={c.key} className={`th ${c.type === 'money' || c.type === 'number' ? 'text-right' : ''}`}>{c.label}</th>)}</tr></thead>
            <tbody className={`divide-y divide-slate-100 ${r.loading ? 'opacity-60' : ''}`}>{d.rows.map((row: any, i: number) => <tr key={i} className="hover:bg-slate-50/70">{d.columns.map((c: any) => <td key={c.key} className={`td ${c.type === 'money' || c.type === 'number' ? 'num text-right' : ''} ${c.key === 'pa_number' ? 'whitespace-nowrap font-medium text-navy-800' : ''}`}>{cell(c, row[c.key])}</td>)}</tr>)}</tbody></table></div>
            <div className="border-t border-slate-100 px-4 py-2.5 text-xs text-slate-400">{d.rows.length} row{d.rows.length === 1 ? '' : 's'}</div></>)}
      </Card>
    </div>
  );
}
