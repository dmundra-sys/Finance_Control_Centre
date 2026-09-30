import { Link, Navigate } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Card, ErrorBox, Loading, PageHeader, useAsync, Icon } from '../components/ui';
import { PaymentRowsTable, StatCard } from '../components/parts';
import { compact, money } from '../lib/format';

const TITLES: Record<string, { t: string; d: string; link: string }> = {
  A: { t: 'My Payment Requests', d: 'Advices you created', link: '/payments?queue=a_my' },
  B: { t: 'Awaiting your approval', d: 'Payment Advices pending B approval', link: '/payments?queue=b_pending' },
  C: { t: 'Awaiting verification', d: 'Originals and accounting to verify', link: '/queue' },
  D: { t: 'Awaiting final approval', d: 'Initiated on the bank portal — review and approve', link: '/payments?queue=d_pending' },
};
export default function Dashboard() {
  const { me, can } = useAuth();
  const { data, error, loading, reload } = useAsync(() => api.get('/dashboard'), []);
  if (loading) return <Loading />; if (error) return <ErrorBox error={error} retry={reload} />;
  const d = data as any;
  if (d.roles.includes('OVERVIEW') && can('dashboard.management')) return <Navigate to="/management" replace />;
  const hour = new Date().getHours(); const greet = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  return (
    <div>
      <PageHeader title={`${greet}, ${me!.user.name.replace(' (DEMO)', '').split(' ')[0]}`} subtitle="Here is what needs your attention today."
        actions={can('payment.create') ? <Link to="/payments/new" className="btn-primary"><Icon name="plus" className="h-4 w-4" />New Payment Advice</Link> : undefined} />
      {d.roles.map((role: string) => {
        const s = d.sections[role]; if (!s) return null; const meta = TITLES[role];
        return (
          <div key={role} className="mb-8">
            {d.roles.length > 1 && <h2 className="mb-3 text-xs font-bold uppercase tracking-wider text-slate-400">Role {role}</h2>}
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
              {s.cards.map((c: any) => <StatCard key={c.key} label={c.label} tone={c.tone} value={c.count} sub={c.amount != null ? money(c.amount) : undefined} to={c.queue === 'c_verification' || c.queue === 'c_ready' ? `/queue` : `/payments?queue=${c.queue}`} />)}
            </div>
            <div className="mt-4 grid gap-4 xl:grid-cols-3">
              <Card className="xl:col-span-2" pad={false} title={<span>{meta.t}<span className="ml-2 font-normal text-slate-400">{meta.d}</span></span>} actions={<Link className="link text-xs" to={meta.link}>View all →</Link>}>
                <PaymentRowsTable rows={s.action_items} empty="Nothing is waiting on you." />
              </Card>
              {role === 'B' && (
                <Card title="Pending by priority">
                  {s.pending_by_priority.length === 0 ? <p className="py-6 text-center text-sm text-slate-500">No pending approvals.</p> :
                    <ul className="space-y-2">{s.pending_by_priority.map((p: any) => <li key={p.key} className="flex items-center justify-between text-sm"><span className="font-medium text-slate-700">{p.key}</span><span className="num text-slate-500">{p.count} · {compact(p.amount)}</span></li>)}</ul>}
                  <div className="mt-4 border-t border-slate-100 pt-3 text-xs font-semibold uppercase tracking-wide text-slate-400">By company</div>
                  <ul className="mt-2 space-y-1.5">{s.pending_by_company.map((p: any) => <li key={p.key} className="flex items-center justify-between text-sm"><span className="truncate pr-2 text-slate-700">{p.key}</span><span className="num shrink-0 text-slate-500">{p.count} · {compact(p.amount)}</span></li>)}</ul>
                </Card>)}
              {role === 'C' && (
                <Card pad={false} title="Ready for bank initiation" actions={<Link className="link text-xs" to="/queue">Open queue →</Link>}>
                  {s.ready_queue.length === 0 ? <p className="px-4 py-8 text-center text-sm text-slate-500">No payments are ready for the bank portal.</p> :
                    <ul className="divide-y divide-slate-100">{s.ready_queue.map((r: any) => <li key={r.id}><Link to={`/payments/${r.id}`} className="flex items-center justify-between gap-2 px-4 py-2.5 hover:bg-slate-50"><div className="min-w-0"><div className="text-sm font-semibold text-navy-800">{r.pa_number}</div><div className="truncate text-xs text-slate-500">{r.vendor} · {r.company}</div></div><div className="num text-sm font-medium">{money(r.net_payable)}</div></Link></li>)}</ul>}
                </Card>)}
              {(role === 'A' || role === 'D') && (
                <Card title="Quick guide">
                  <ol className="space-y-2.5 text-sm text-slate-600">
                    {role === 'A' ? ['Create a Payment Advice and upload the invoice and supporting documents.', 'Check the duplicate warning, then submit — B is notified automatically.', 'If C raises a query, fix it and use “Resolve & resubmit”. It goes straight back to C.'].map((t, i) => <li key={i} className="flex gap-2"><b className="text-navy-700">{i + 1}.</b>{t}</li>)
                      : ['Open the advice and compare it with what C entered on the bank portal.', 'Tick each item of the final checklist. Approve to release; reject to send it back to A or C.', 'C receives a WhatsApp message the moment you approve.'].map((t, i) => <li key={i} className="flex gap-2"><b className="text-navy-700">{i + 1}.</b>{t}</li>)}
                  </ol>
                </Card>)}
            </div>
          </div>);
      })}
    </div>
  );
}
