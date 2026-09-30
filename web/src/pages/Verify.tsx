import { Link, useParams } from 'react-router-dom';
import { api } from '../lib/api';
import { Badge, Card, ErrorBox, Icon, Loading, PageHeader, StatusBadge, useAsync, KV } from '../components/ui';
import { fmtDate, money } from '../lib/format';

/** Landing page for the QR code printed on the Payment Advice PDF (requires sign-in). */
export default function Verify() {
  const { paNo } = useParams();
  const r = useAsync(() => api.get('/payments', { q: paNo, page_size: 5 }), [paNo]);
  if (r.loading) return <Loading />; if (r.error) return <ErrorBox error={r.error} retry={r.reload} />;
  const row = (r.data as any).rows.find((x: any) => x.pa_number === paNo);
  return (
    <div className="mx-auto max-w-xl">
      <PageHeader title="Verify Payment Advice" subtitle="Authenticity check for a printed Payment Advice." />
      {!row ? (
        <Card><div className="flex items-start gap-3"><Icon name="alert" className="mt-0.5 h-6 w-6 text-red-500" /><div><div className="font-semibold text-red-700">Not found</div><p className="mt-1 text-sm text-slate-600">No Payment Advice “{paNo}” exists that you are allowed to see. If the printed copy claims to be genuine, treat it as suspect and inform Finance.</p></div></div></Card>
      ) : (
        <Card><div className="flex items-start gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-100 text-emerald-700"><Icon name="check" /></span><div><div className="font-semibold text-emerald-700">Genuine record found</div><p className="text-sm text-slate-500">This Payment Advice exists in the system with the details below.</p></div></div>
          <dl className="mt-5 grid grid-cols-2 gap-4"><KV label="Payment Advice">{row.pa_number}</KV><KV label="Status"><StatusBadge label={row.status_label} color={row.status_color} /></KV><KV label="Company">{row.company}</KV><KV label="Vendor">{row.vendor}</KV><KV label="Invoice">{row.invoice_number} · {fmtDate(row.invoice_date)}</KV><KV label="Net payable"><b className="num">{money(row.net_payable, true)}</b></KV></dl>
          <div className="mt-5 flex gap-2"><Link className="btn-primary" to={`/payments/${row.id}`}>Open full record</Link>{row.version_no > 1 && <Badge tone="indigo">Version {row.version_no}</Badge>}</div></Card>)}
    </div>
  );
}
