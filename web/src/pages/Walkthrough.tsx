import { Link } from 'react-router-dom';
import { Card, Icon, PageHeader } from '../components/ui';
import { useAuth } from '../lib/auth';

const STEPS = [
  { who: 'a.anil', role: 'A', title: 'Create the Payment Advice', body: 'New Payment Advice → Betul Oil Limited · Kotak Mahindra Bank · ABC Suppliers · NEFT · ₹5,25,000. Upload an invoice, then Submit. The duplicate check runs automatically.' },
  { who: 'b.meera', role: 'B', title: 'Approve (Senior Approver)', body: '₹5,25,000 falls in the ₹5L–₹25L band, so a Senior Approver is required. Meera approves; Rajesh (not senior) would be blocked.' },
  { who: 'c.sunil', role: 'C', title: 'Raise a query', body: 'Open the advice from the Processing Queue, review the documents and choose “Raise query to A” — e.g. the invoice copy is unclear.' },
  { who: 'a.anil', role: 'A', title: 'Resolve & resubmit', body: 'Upload the corrected invoice and use “Resolve query & resubmit”. The SAME advice returns straight to C (version 2). B approval is not repeated.' },
  { who: 'c.sunil', role: 'C', title: 'Verify originals & accounting', body: 'Tick the 9-point original-document checklist, then complete the Accounting tab (ledger, cost centre, GST, TDS, voucher) and Verify accounting.' },
  { who: 'c.sunil', role: 'C', title: 'Initiate on the bank portal', body: 'Perform the payment manually on the bank’s website, then click “Record bank initiation” and enter only the bank reference. No bank password or OTP is ever entered here.' },
  { who: 'd.vikram', role: 'D', title: 'Final bank approval', body: 'Compare with the bank portal entry, tick the 10-point final review and Approve. Status becomes PAYMENT APPROVED.' },
  { who: 'c.sunil', role: 'C', title: 'WhatsApp arrives', body: 'Open Administration → Message Outbox: the WhatsApp message to Sunil Patil is there (MOCK provider). Then use “Update bank status” to record the UTR and complete the payment.' },
  { who: 'auditor', role: 'AUDITOR', title: 'Check the audit trail', body: 'Audit Trail → Verify integrity. Every step above is recorded with user, role, time and IP, and is hash-chained.' },
];
export default function Walkthrough() {
  const { me } = useAuth();
  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title="Demo walkthrough" subtitle="The end-to-end flow in nine steps. Sign out and in as each user (password Demo@12345) — or open a ready-made example." />
      <Card className="mb-4"><div className="flex flex-wrap items-center gap-3 text-sm"><Icon name="key" className="h-5 w-5 text-amber-600" /><span>You are signed in as <b>{me!.user.name}</b> ({me!.user.loginId}).</span><Link to="/payments/1" className="link">Open completed example PA-2026-000001 →</Link><Link to="/payments/18" className="link">Awaiting D approval PA-2026-000018 →</Link><Link to="/payments/25" className="link">C query PA-2026-000025 →</Link></div></Card>
      <ol className="space-y-3">{STEPS.map((s, i) => (
        <li key={i} className="card flex gap-4 p-4"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-navy-900 text-sm font-bold text-white">{i + 1}</span>
          <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h3 className="text-sm font-semibold">{s.title}</h3><span className="rounded-full bg-slate-100 px-2 py-0.5 font-mono text-[11px] text-slate-600">{s.who}</span></div><p className="mt-1 text-sm text-slate-600">{s.body}</p></div></li>))}</ol>
      <p className="mt-4 text-xs text-slate-400">The automated test suite (<code>npm test</code> in <code>server/</code>) runs this same flow against a clean database on every build.</p>
    </div>
  );
}
