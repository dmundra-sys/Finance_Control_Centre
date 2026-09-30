import { useState } from 'react';
import { Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api } from '../lib/api';
import { Card, ErrorBox, Field, Loading, PageHeader, useAsync } from '../components/ui';
import { StatCard } from '../components/parts';
import { compact, money } from '../lib/format';
import { Link } from 'react-router-dom';

const PALETTE = ['#0f2a4a', '#2f7dd1', '#14b8a6', '#f59e0b', '#8b5cf6', '#ef4444', '#64748b', '#22c55e', '#ec4899', '#0ea5e9'];
const COLOR: Record<string, string> = { slate: '#94a3b8', blue: '#3b82f6', amber: '#f59e0b', green: '#22c55e', red: '#ef4444', teal: '#14b8a6', indigo: '#6366f1', orange: '#f97316', purple: '#a855f7' };
const tip = (v: any, n: any) => [n === 'amount' ? money(v) : v, n === 'amount' ? 'Amount' : 'Count'];

function Chart({ title, children, h = 260, className }: { title: string; children: any; h?: number; className?: string }) { return <Card title={title} className={className}><div style={{ height: h }}><ResponsiveContainer width="100%" height="100%">{children}</ResponsiveContainer></div></Card>; }

export default function Management() {
  const meta = useAsync(() => api.get('/payments/meta'), []);
  const [f, setF] = useState<any>({}); const set = (k: string, v: string) => setF((x: any) => ({ ...x, [k]: v }));
  const { data, error, loading, reload } = useAsync(() => api.get('/dashboard/management', f), [JSON.stringify(f)]);
  const d = data as any; const m = meta.data as any;
  return (
    <div>
      <PageHeader title="Management Dashboard" subtitle="Payments across companies, banks and stages." />
      <div className="card mb-4 grid gap-3 p-3 sm:grid-cols-4">
        <Field label="From"><input type="date" className="input" value={f.date_from ?? ''} onChange={(e) => set('date_from', e.target.value)} /></Field>
        <Field label="To"><input type="date" className="input" value={f.date_to ?? ''} onChange={(e) => set('date_to', e.target.value)} /></Field>
        <Field label="Company"><select className="input" value={f.company_id ?? ''} onChange={(e) => set('company_id', e.target.value)}><option value="">All companies</option>{m?.companies.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
        <div className="flex items-end"><button className="btn-outline w-full" onClick={() => setF({})}>Reset filters</button></div>
      </div>
      {loading && !d ? <Loading /> : error ? <ErrorBox error={error} retry={reload} /> : (
        <div className={loading ? 'opacity-60 transition' : ''}>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatCard label="Total payments" value={d.kpi.total_payments} sub={money(d.kpi.total_amount)} tone="blue" to="/payments" />
            <StatCard label="Pending B approval" value={d.kpi.pending_b} sub={money(d.kpi.pending_b_amount)} tone="amber" to="/payments?status=SUBMITTED,PENDING_B_APPROVAL" />
            <StatCard label="Pending C" value={d.kpi.pending_c} sub={money(d.kpi.pending_c_amount)} tone="teal" to="/payments?status=PENDING_C_VERIFICATION,A_RESUBMITTED,C_QUERY" />
            <StatCard label="Ready for bank initiation" value={d.kpi.pending_bank} sub={money(d.kpi.pending_bank_amount)} tone="indigo" to="/payments?status=C_VERIFIED,ACCOUNTING_VERIFIED" />
            <StatCard label="Pending D approval" value={d.kpi.pending_d} sub={money(d.kpi.pending_d_amount)} tone="orange" to="/payments?status=PAYMENT_INITIATED,PENDING_D_APPROVAL" />
            <StatCard label="Approved / completed" value={d.kpi.completed} sub={money(d.kpi.completed_amount)} tone="green" to="/payments?status=D_APPROVED,PAYMENT_COMPLETED" />
            <StatCard label="Rejected / cancelled" value={d.kpi.rejected} tone="red" to="/payments?status=B_REJECTED,D_REJECTED,CANCELLED" />
            <StatCard label="On hold · failed" value={`${d.kpi.on_hold} · ${d.kpi.failed}`} tone="slate" to="/payments?status=ON_HOLD,PAYMENT_FAILED,PAYMENT_REVERSED" />
          </div>
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <Chart title="Payments by status (amount)" h={380}><BarChart data={d.byStatus} layout="vertical" margin={{ left: 20 }}><CartesianGrid strokeDasharray="3 3" horizontal={false} /><XAxis type="number" tickFormatter={compact} fontSize={11} /><YAxis type="category" dataKey="name" width={150} fontSize={11} interval={0} /><Tooltip formatter={tip} /><Bar dataKey="amount" radius={[0, 4, 4, 0]}>{d.byStatus.map((s: any, i: number) => <Cell key={i} fill={COLOR[s.color] ?? PALETTE[i % 10]} />)}</Bar></BarChart></Chart>
            <Chart title="Company-wise payments"><BarChart data={d.byCompany}><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="name" fontSize={11} interval={0} /><YAxis tickFormatter={compact} fontSize={11} width={60} /><Tooltip formatter={tip} /><Bar dataKey="amount" fill="#0f2a4a" radius={[4, 4, 0, 0]} /></BarChart></Chart>
            <Chart title="Bank-wise payments"><BarChart data={d.byBank}><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="name" fontSize={11} interval={0} /><YAxis tickFormatter={compact} fontSize={11} width={60} /><Tooltip formatter={tip} /><Bar dataKey="amount" fill="#14b8a6" radius={[4, 4, 0, 0]} /></BarChart></Chart>
            <Chart title="Payment mode split"><PieChart><Pie data={d.byMode} dataKey="amount" nameKey="name" innerRadius={55} outerRadius={95} paddingAngle={2} label={(e: any) => e.name}>{d.byMode.map((_: any, i: number) => <Cell key={i} fill={PALETTE[i % 10]} />)}</Pie><Tooltip formatter={(v: any) => money(v)} /><Legend /></PieChart></Chart>
            <Chart title="Top vendors by amount"><BarChart data={d.byVendor} layout="vertical" margin={{ left: 30 }}><CartesianGrid strokeDasharray="3 3" horizontal={false} /><XAxis type="number" tickFormatter={compact} fontSize={11} /><YAxis type="category" dataKey="name" width={140} fontSize={11} interval={0} /><Tooltip formatter={tip} /><Bar dataKey="amount" fill="#2f7dd1" radius={[0, 4, 4, 0]} /></BarChart></Chart>
            <Chart title="Where open payments are waiting"><BarChart data={d.byStage}><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="stage" fontSize={11} interval={0} tickFormatter={(s) => (['A', 'B', 'C', 'D'].includes(s) ? `With ${s}` : s)} /><YAxis fontSize={11} allowDecimals={false} width={40} /><Tooltip formatter={tip} /><Bar dataKey="count" fill="#f59e0b" radius={[4, 4, 0, 0]} /></BarChart></Chart>
            <Chart title="Daily payment requests" className="lg:col-span-2" h={240}><LineChart data={d.daily}><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="day" fontSize={11} tickFormatter={(s) => s.slice(5)} /><YAxis yAxisId="a" fontSize={11} allowDecimals={false} width={40} /><YAxis yAxisId="b" orientation="right" tickFormatter={compact} fontSize={11} width={60} /><Tooltip formatter={tip} /><Legend /><Line yAxisId="a" dataKey="count" name="Count" stroke="#0f2a4a" strokeWidth={2} dot={false} /><Line yAxisId="b" dataKey="amount" name="Amount" stroke="#14b8a6" strokeWidth={2} dot={false} /></LineChart></Chart>
            <Chart title="Monthly summary" className="lg:col-span-2" h={220}><BarChart data={d.monthly}><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="month" fontSize={11} /><YAxis tickFormatter={compact} fontSize={11} width={60} /><Tooltip formatter={tip} /><Bar dataKey="amount" fill="#6366f1" radius={[4, 4, 0, 0]} /></BarChart></Chart>
          </div>
          <p className="mt-4 text-xs text-slate-400">Need the detail? Open <Link className="link" to="/reports">Reports</Link> for Excel / PDF exports.</p>
        </div>)}
    </div>
  );
}
