import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import clsx from 'clsx';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Badge, Btn, Confirm, ErrorBox, Icon, Loading, Modal, PriorityBadge, StatusBadge, Tabs, useAsync, useToast } from '../components/ui';
import { Stage } from '../components/parts';
import { fmtDate, fmtDateTime, money } from '../lib/format';
import ActionModals, { type ActionKey } from './detail/Actions';
import { Accounting, Approvals, AuditTab, Bank, Documents, Overview, PdfTab, Queries, Timeline, Verification, Versions } from './detail/Tabs';

// A → B → C → Bank → D → Done
const STEPS = [['A', 'Created'], ['B', 'B Approval'], ['C', 'C Verification'], ['BANK', 'Bank Initiation'], ['D', 'D Approval'], ['DONE', 'Completed']];
function stepState(status: string, returnTo: string | null) {
  // returns index of the *current* step, and whether it is a problem state
  const m: Record<string, [number, string?]> = {
    DRAFT: [0], B_REJECTED: [0, 'B rejected'], SUBMITTED: [1], PENDING_B_APPROVAL: [1], B_APPROVED: [2], PENDING_C_VERIFICATION: [2], C_QUERY: [0, 'C query'], A_RESUBMITTED: [2], C_VERIFIED: [2], ACCOUNTING_VERIFIED: [3],
    PAYMENT_INITIATED: [4], PENDING_D_APPROVAL: [4], D_APPROVED: [5], PAYMENT_COMPLETED: [6], PAYMENT_FAILED: [3, 'Payment failed'], PAYMENT_REVERSED: [3, 'Reversed'],
    D_REJECTED: [returnTo === 'A' ? 0 : 3, 'D rejected'],
  };
  return m[status] ?? [0];
}

export default function PaymentDetail() {
  const { id } = useParams(); const nav = useNavigate(); const toast = useToast(); const { can } = useAuth(); const [sp, setSp] = useSearchParams();
  const d = useAsync(() => api.get(`/payments/${id}`), [id]); const meta = useAsync(() => api.get('/payments/meta'), []);
  const [tab, setTab] = useState(sp.get('tab') ?? 'overview'); const [modal, setModal] = useState<ActionKey>(null);
  const [confirmVerify, setConfirmVerify] = useState(false); const [revealed, setRevealed] = useState<string | null>(null);
  const [dup, setDup] = useState<any>(null); const [dupReason, setDupReason] = useState(''); const [busy, setBusy] = useState(false);
  useEffect(() => { setSp((p) => { const n = new URLSearchParams(p); n.set('tab', tab); return n; }, { replace: true }); /* eslint-disable-next-line */ }, [tab]);
  const data = d.data as any; const m = meta.data as any;
  const afterAction = async () => { await d.reload(); };
  if (d.loading && !data) return <Loading />; if (d.error) return <ErrorBox error={d.error} retry={d.reload} />; if (!data || !m) return <Loading />;
  const p = data.payment; const A = data.actions; const B = data.blocked;
  const [cur, problem] = stepState(p.status, p.return_to_stage);
  const terminal = ['CANCELLED'].includes(p.status);
  const why = ['b_decide', 'd_decide', 'c_verify_docs', 'c_raise_query', 'accounting_edit', 'initiate_bank', 'cancel'].map((k) => B[k]).find(Boolean) as string | undefined;
  const openQuery = data.queries.find((q: any) => q.status === 'OPEN');
  const primary: { key: string; label: string; cls: string; onClick: () => void }[] = [];
  if (A.submit) primary.push({ key: 'submit', label: p.status === 'B_REJECTED' ? 'Correct & resubmit to B' : 'Submit for approval', cls: 'btn-primary', onClick: submit });
  if (A.resubmit_to_c) primary.push({ key: 'rs', label: 'Resolve query & resubmit', cls: 'btn-primary', onClick: () => setModal('resubmit') });
  if (A.b_decide) primary.push({ key: 'b', label: 'Review & decide (B)', cls: 'btn-primary', onClick: () => setModal('b') });
  if (A.c_verify_docs) primary.push({ key: 'cv', label: 'Verify original documents', cls: 'btn-green', onClick: () => setModal('c_verify') });
  if (A.accounting_verify && ['C_VERIFIED', 'D_REJECTED', 'PAYMENT_FAILED'].includes(p.status)) primary.push({ key: 'ac', label: 'Complete accounting', cls: 'btn-primary', onClick: () => setTab('accounting') });
  if (A.initiate_bank) primary.push({ key: 'ib', label: 'Record bank initiation', cls: 'btn-green', onClick: () => setModal('initiate') });
  if (A.d_decide) primary.push({ key: 'd', label: 'Final approval (D)', cls: 'btn-green', onClick: () => setModal('d') });
  if (A.bank_update) primary.push({ key: 'bu', label: 'Update bank status', cls: 'btn-primary', onClick: () => setModal('bank_update') });
  if (A.cancel_decide) primary.push({ key: 'cd', label: 'Decide cancellation request', cls: 'btn-amber', onClick: () => setModal('cancel_decide') });

  async function submit(override?: string) {
    setBusy(true);
    try {
      const dc = await api.post('/payments/duplicate-check', { company_id: p.company_id, vendor_id: p.vendor_id, invoice_number: p.invoice_number, invoice_date: (p.invoice_date ?? '').slice(0, 10), gross_amount: Number(p.gross_amount), exclude_id: p.id });
      if (dc.duplicates.length && !override) { setDup(dc); return; }
      await api.post(`/payments/${p.id}/submit`, override ? { override_reason: override } : {}); setDup(null); toast.ok('Submitted for approval.'); afterAction();
    } catch (e) { toast.err(e); } finally { setBusy(false); }
  }
  async function reveal() { try { const r = await api.post(`/payments/${p.id}/reveal-account`); setRevealed(r.account_number); setTimeout(() => setRevealed(null), 20000); } catch (e) { toast.err(e); } }
  async function verifyAccounting() { try { await api.post(`/payments/${p.id}/accounting/verify`, { confirm: true }); setConfirmVerify(false); toast.ok('Accounting verified.'); afterAction(); } catch (e) { setConfirmVerify(false); toast.err(e); } }

  const tabs = [
    { key: 'overview', label: 'Overview' }, { key: 'documents', label: 'Documents', count: data.documents.filter((x: any) => x.status === 'ACTIVE').length }, { key: 'approvals', label: 'Approvals', count: data.approvals.length },
    { key: 'queries', label: 'Queries', count: data.queries.length }, { key: 'verification', label: 'C Verification' }, { key: 'accounting', label: 'Accounting' }, { key: 'bank', label: 'Bank Payment', count: data.bank_transactions.length || undefined },
    { key: 'timeline', label: 'Timeline' }, { key: 'versions', label: 'Versions', count: data.versions.length }, { key: 'audit', label: 'Audit Trail' }, { key: 'pdf', label: 'PDF' },
  ];
  const secondary = [A.edit && { l: 'Edit', to: `/payments/${p.id}/edit` }, A.amendment && { l: 'Amend', to: `/payments/${p.id}/edit?amend=1` }].filter(Boolean) as { l: string; to: string }[];

  return (
    <div>
      <div className="mb-3 text-sm"><Link to="/payments" className="text-slate-500 hover:text-navy-700">← Payment Advices</Link></div>
      {/* header */}
      <div className="card overflow-hidden">
        <div className="flex flex-wrap items-start justify-between gap-4 p-4 sm:p-5">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2"><h1 className="text-xl font-bold tracking-tight sm:text-2xl">{p.pa_number}</h1><StatusBadge label={p.status_label} color={p.status_color} /><PriorityBadge p={p.priority} />{p.version_no > 1 && <Badge tone="indigo">v{p.version_no}</Badge>}{p.is_amendment && <Badge tone="orange">Amended</Badge>}<Stage s={p.stage_owner} /></div>
            <p className="mt-1.5 text-sm text-slate-600">{data.vendor?.name} · {p.company_name}</p>
            <p className="text-xs text-slate-400">Invoice {p.invoice_number} dated {fmtDate(p.invoice_date)} · Due {fmtDate(p.due_date)} · Created by {p.created_by_name} on {fmtDate(p.created_at)}</p>
          </div>
          <div className="text-right"><div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Net payable</div><div className="num text-3xl font-bold text-navy-900">{money(p.net_payable, true)}</div>
            <div className="mt-2 flex flex-wrap justify-end gap-2 no-print">{secondary.map((s) => <Link key={s.l} to={s.to} className="btn-outline btn-sm"><Icon name="pen" className="h-3.5 w-3.5" />{s.l}</Link>)}
              <button className="btn-outline btn-sm" onClick={() => setTab('pdf')}><Icon name="file" className="h-3.5 w-3.5" />PDF</button>
              {A.hold && <button className="btn-outline btn-sm" onClick={() => setModal('hold')}>Hold</button>}{A.release && <button className="btn-outline btn-sm" onClick={() => setModal('release')}>Release hold</button>}
              {A.cancel && <button className="btn-outline btn-sm text-red-600" onClick={() => setModal('cancel')}>Cancel</button>}</div></div>
        </div>
        {/* stepper */}
        {!terminal && (
          <div className="overflow-x-auto border-t border-slate-100 bg-slate-50/60 px-4 py-4"><ol className="mx-auto flex min-w-[600px] max-w-4xl items-center">
            {STEPS.map(([k, l], i) => {
              const done = i < cur || cur >= 6; const now = i === cur && cur < 6; const bad = now && !!problem;
              const sub = k === 'B' ? `${data.approval_progress.b.reduce((n: number, x: any) => n + Math.min(x.done.length, x.required), 0)}/${data.approval_progress.b.reduce((n: number, x: any) => n + x.required, 0) || '–'}` : k === 'D' ? `${data.approval_progress.d.done.length}/${data.approval_progress.d.required}` : '';
              return (
                <li key={k} className={clsx('flex items-center', i < STEPS.length - 1 && 'flex-1')}>
                  <div className="flex flex-col items-center text-center">
                    <span className={clsx('flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold ring-4 transition', done ? 'bg-emerald-500 text-white ring-emerald-100' : bad ? 'bg-red-500 text-white ring-red-100' : now ? 'bg-navy-900 text-white ring-navy-100' : 'bg-white text-slate-400 ring-slate-100 border border-slate-200')}>{done ? '✓' : bad ? '!' : i + 1}</span>
                    <span className={clsx('mt-1.5 text-[11px] font-semibold leading-tight', now ? 'text-navy-900' : done ? 'text-emerald-700' : 'text-slate-400')}>{l}</span>
                    <span className="h-3 text-[10px] text-slate-400">{now && problem ? problem : sub && (now || done) ? sub : ''}</span>
                  </div>
                  {i < STEPS.length - 1 && <span className={clsx('mx-2 mb-6 h-0.5 flex-1 rounded', i < cur ? 'bg-emerald-400' : 'bg-slate-200')} />}
                </li>);
            })}</ol></div>)}
      </div>

      {/* attention banners */}
      {p.status === 'ON_HOLD' && <div className="mt-3 rounded-lg border border-slate-300 bg-slate-100 px-4 py-3 text-sm"><b>On hold:</b> {p.hold_reason}</div>}
      {p.status === 'CANCELLED' && <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"><b>Cancelled:</b> {p.cancel_reason}</div>}
      {openQuery && ['C_QUERY', 'B_REJECTED', 'D_REJECTED'].includes(p.status) && <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900"><b>{openQuery.raised_by_stage === 'D' ? 'Rejected by D' : `Query from ${openQuery.raised_by_stage}`}:</b> {openQuery.reason}{openQuery.required_document && <> · Document needed: <b>{openQuery.required_document}</b></>}{openQuery.required_correction && <> · Correction: <b>{openQuery.required_correction}</b></>}</div>}
      {p.status === 'B_REJECTED' && data.approvals.filter((a: any) => a.stage === 'B').slice(-1).map((a: any) => <div key={a.id} className="mt-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900"><b>{a.decision === 'REJECTED' ? 'Rejected' : 'Returned'} by {a.approver_name}:</b> {a.reason}</div>)}
      {data.cancellations.filter((c: any) => c.status === 'PENDING').map((c: any) => <div key={c.id} className="mt-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900"><b>Cancellation requested</b> by {c.requested_by_name}: {c.reason}</div>)}
      {revealed && <div className="mt-3 rounded-lg border border-navy-200 bg-navy-50 px-4 py-3 text-sm">Beneficiary account number: <b className="font-mono text-base tracking-wider">{revealed}</b> <span className="text-xs text-slate-500">(hidden again in 20 s · access logged)</span></div>}

      {/* action panel */}
      {(primary.length > 0 || !!why || A.c_raise_query) && (
        <div className="sticky top-[57px] z-10 mt-3 rounded-xl border border-navy-200 bg-white p-3 shadow-pop sm:p-4 no-print">
          <div className="flex flex-wrap items-center gap-3">
            <div className="min-w-0 flex-1"><div className="text-[11px] font-semibold uppercase tracking-wide text-navy-500">Your action</div>
              <div className="text-sm text-slate-700">{primary.length ? (guide(p.status, A) || 'Action available on this payment advice.') : why ?? 'No action is needed from you right now.'}</div></div>
            <div className="flex flex-wrap items-center gap-2">
              {A.c_raise_query && <button className="btn-outline text-red-600" onClick={() => setModal('c_query')}>Raise query to A</button>}
              {A.b_decide && <></>}
              {primary.map((x) => <Btn key={x.key} busy={busy && x.key === 'submit'} className={x.cls + ' !py-2.5'} onClick={() => x.onClick()}>{x.label}</Btn>)}
            </div>
          </div>
        </div>)}

      <div className="mt-4"><Tabs tabs={tabs} value={tab} onChange={setTab} /></div>
      <div className="mt-4">
        {tab === 'overview' && <Overview data={data} reveal={reveal} />}
        {tab === 'documents' && <Documents data={data} meta={m} canUpload={!!A.upload_docs || (can('payment.verify_c') && ['PENDING_C_VERIFICATION', 'A_RESUBMITTED', 'C_VERIFIED', 'ACCOUNTING_VERIFIED', 'PENDING_D_APPROVAL', 'D_APPROVED'].includes(p.status))} canDelete={!!A.delete_doc} reload={d.reload} />}
        {tab === 'approvals' && <Approvals data={data} />}
        {tab === 'queries' && <Queries data={data} />}
        {tab === 'verification' && <Verification data={data} meta={m} />}
        {tab === 'accounting' && <Accounting data={data} meta={m} editable={!!A.accounting_edit} reload={d.reload} onVerify={() => setConfirmVerify(true)} />}
        {tab === 'bank' && <Bank data={data} />}
        {tab === 'timeline' && <Timeline data={data} />}
        {tab === 'versions' && <Versions data={data} />}
        {tab === 'audit' && <AuditTab id={p.id} />}
        {tab === 'pdf' && <PdfTab id={p.id} pa={p.pa_number} />}
      </div>

      <ActionModals open={modal} onClose={() => setModal(null)} data={data} meta={m} onDone={afterAction} />
      <Confirm open={confirmVerify} title="Verify accounting?" message="You confirm that the ledger, cost centre, GST/TDS treatment and voucher are correct. This step must be completed before the payment can be initiated on the bank portal." confirmLabel="Verify accounting" onClose={() => setConfirmVerify(false)} onConfirm={verifyAccounting} />
      <Modal open={!!dup} onClose={() => setDup(null)} title="Possible duplicate payment" size="lg" footer={<><button className="btn-outline" onClick={() => setDup(null)}>Do not submit</button>{dup?.can_override && <Btn className="btn-amber" disabled={dupReason.trim().length < 10} onClick={() => submit(dupReason.trim())}>Override & submit</Btn>}</>}>
        <div className="overflow-x-auto rounded-lg border border-slate-200"><table className="w-full text-sm"><thead><tr><th className="th">Payment Advice</th><th className="th">Invoice</th><th className="th text-right">Amount</th><th className="th">Status</th></tr></thead><tbody className="divide-y divide-slate-100">{dup?.duplicates.map((x: any) => <tr key={x.id}><td className="td"><Link className="link" target="_blank" to={`/payments/${x.id}`}>{x.pa_number}</Link></td><td className="td">{x.invoice_number} · {fmtDate(x.invoice_date)}</td><td className="td num text-right">{money(x.amount)}</td><td className="td text-xs">{x.status.replace(/_/g, ' ')}</td></tr>)}</tbody></table></div>
        {dup?.can_override ? <div className="mt-4"><label className="label">Override reason (audited) *</label><textarea className="input" rows={3} value={dupReason} onChange={(e) => setDupReason(e.target.value)} /></div> : <p className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">You are not authorised to override duplicate-payment control.</p>}
      </Modal>
    </div>
  );
}

function guide(status: string, A: Record<string, boolean>) {
  const g: Record<string, string> = {
    DRAFT: 'Review the details and submit for B approval.', B_REJECTED: 'B has rejected or returned this advice. Correct it and resubmit to B.', C_QUERY: 'C has raised a query. Resolve it and resubmit — it goes straight back to C.',
    D_REJECTED: 'D rejected the payment. Follow the return instruction and resubmit.', PENDING_B_APPROVAL: 'Review the advice and documents, then approve, reject or return it.',
    PENDING_C_VERIFICATION: 'Verify the ORIGINAL invoice and supporting documents, or raise a query.', A_RESUBMITTED: 'A has resolved your query. Verify the corrected documents.',
    C_VERIFIED: 'Complete and verify the accounting treatment.', ACCOUNTING_VERIFIED: 'Initiate the payment on the bank portal, then record the bank reference here.',
    PENDING_D_APPROVAL: 'Compare this advice with the bank portal entry and give final approval.', D_APPROVED: 'Payment approved. Update the bank status when the money is debited.', PAYMENT_FAILED: 'The payment failed. Fix the cause and re-initiate.', PAYMENT_COMPLETED: 'Payment completed. You can still record reconciliation, a return or a reversal from the bank statement.',
  };
  return g[status] ?? '';
}
export { useNavigate, useMemo };
