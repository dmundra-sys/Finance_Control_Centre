import { useEffect, useState } from 'react';
import { api, errMsg } from '../../lib/api';
import { Btn, Check, Field, Icon, Modal, useToast } from '../../components/ui';
import { money, todayIso } from '../../lib/format';

export type ActionKey = 'submit' | 'resubmit' | 'b' | 'c_verify' | 'c_query' | 'initiate' | 'd' | 'bank_update' | 'hold' | 'release' | 'cancel' | 'cancel_decide' | null;

interface Props { open: ActionKey; onClose: () => void; data: any; meta: any; onDone: (msg?: string) => void; }

const REQUIRED_DOCS = ['Corrected invoice', 'Purchase order', 'Goods/service receipt', 'GST document', 'TDS document', 'Vendor bank proof / cancelled cheque', 'Contract / agreement', 'Approval e-mail', 'Original hard copy', 'Other'];
const CORRECTIONS = ['Invoice number / date', 'Amount / deductions', 'Vendor / bank details', 'GST details', 'TDS details', 'Payment mode', 'Company / bank account', 'Department / purpose', 'Other'];

export default function ActionModals({ open, onClose, data, meta, onDone }: Props) {
  const toast = useToast(); const p = data.payment; const id = p.id;
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const [f, setF] = useState<any>({}); const [cl, setCl] = useState<Record<string, boolean>>({});
  useEffect(() => { setF({}); setCl({}); setErr(''); setBusy(false); }, [open]);
  const set = (k: string, v: any) => { setF((x: any) => ({ ...x, [k]: v })); setErr(''); };
  const call = async (fn: () => Promise<any>, msg: string) => { setBusy(true); setErr(''); try { await fn(); onClose(); toast.ok(msg); onDone(msg); } catch (e) { setErr(errMsg(e)); } finally { setBusy(false); } };
  const box = (t: string, danger = false) => <div className={`mb-3 rounded-lg border px-3 py-2 text-xs ${danger ? 'border-red-200 bg-red-50 text-red-800' : 'border-navy-100 bg-navy-50/60 text-navy-800'}`}>{t}</div>;
  const errBox = err && <div role="alert" className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{err}</div>;
  const allTick = (list: readonly (readonly [string, string])[]) => list.every(([k]) => cl[k]);
  const tickAll = (list: readonly (readonly [string, string])[], v: boolean) => setCl(Object.fromEntries(list.map(([k]) => [k, v])));
  const summary = (
    <div className="mb-4 grid grid-cols-2 gap-x-4 gap-y-2 rounded-lg bg-slate-50 p-3 text-xs sm:grid-cols-4">
      <div><div className="text-slate-400">Payment Advice</div><div className="font-semibold text-slate-800">{p.pa_number}</div></div>
      <div><div className="text-slate-400">Vendor</div><div className="font-semibold text-slate-800">{data.vendor?.name}</div></div>
      <div><div className="text-slate-400">Company</div><div className="font-semibold text-slate-800">{p.company_short}</div></div>
      <div><div className="text-slate-400">Net payable</div><div className="num font-bold text-navy-900">{money(p.net_payable)}</div></div>
    </div>);

  // ---------------------------------------------------------------- B
  if (open === 'b') {
    const d = f.decision;
    return (
      <Modal open onClose={onClose} title="Payment approval — B" size="lg" footer={<><button className="btn-outline" onClick={onClose}>Cancel</button>
        <Btn busy={busy} disabled={!d} className={d === 'APPROVE' ? 'btn-green' : d === 'REJECT' ? 'btn-red' : d === 'RETURN' ? 'btn-amber' : 'btn-primary'}
          onClick={() => call(() => api.post(`/payments/${id}/b-decision`, { decision: d, reason: f.reason, remarks: f.remarks, required_document: f.required_document }), d === 'APPROVE' ? 'Approval recorded.' : d === 'REJECT' ? 'Payment Advice rejected.' : 'Returned to A for clarification.')}>
          {d === 'APPROVE' ? 'Approve payment' : d === 'REJECT' ? 'Reject payment' : d === 'RETURN' ? 'Return for clarification' : 'Choose a decision'}</Btn></>}>
        {summary}
        <div className="grid gap-2 sm:grid-cols-3">
          {[['APPROVE', 'Approve', 'border-emerald-500 bg-emerald-50 text-emerald-800'], ['RETURN', 'Return for clarification', 'border-amber-500 bg-amber-50 text-amber-800'], ['REJECT', 'Reject', 'border-red-500 bg-red-50 text-red-800']].map(([k, l, c]) => (
            <button key={k} onClick={() => set('decision', k)} className={`rounded-lg border-2 px-3 py-3 text-sm font-semibold transition ${d === k ? c : 'border-slate-200 text-slate-600 hover:border-slate-300'}`}>{l}</button>))}
        </div>
        {(d === 'REJECT' || d === 'RETURN') && <Field className="mt-4" label={d === 'REJECT' ? 'Rejection reason' : 'What clarification is needed?'} required><textarea className="input" rows={3} value={f.reason ?? ''} onChange={(e) => set('reason', e.target.value)} /></Field>}
        {d === 'RETURN' && <Field className="mt-3" label="Required document (optional)"><input className="input" value={f.required_document ?? ''} onChange={(e) => set('required_document', e.target.value)} /></Field>}
        <Field className="mt-3" label="Remarks (optional)"><textarea className="input" rows={2} value={f.remarks ?? ''} onChange={(e) => set('remarks', e.target.value)} /></Field>
        {errBox}
      </Modal>);
  }

  // ---------------------------------------------------------------- C verify / query
  if (open === 'c_verify' || open === 'c_query') {
    const isQ = open === 'c_query'; const list = meta.cChecklist as [string, string][];
    return (
      <Modal open onClose={onClose} title={isQ ? 'Raise a query to A' : 'Verify original documents'} size="lg" footer={<><button className="btn-outline" onClick={onClose}>Cancel</button>
        <Btn busy={busy} className={isQ ? 'btn-red' : 'btn-green'} disabled={!isQ && !allTick(list)}
          onClick={() => call(() => api.post(`/payments/${id}/c-review`, isQ ? { result: 'DISCREPANCY', checklist: cl, remarks: f.remarks, required_document: f.required_document, required_correction: f.required_correction } : { result: 'VERIFIED', checklist: cl, remarks: f.remarks }), isQ ? 'Query sent to A.' : 'Original documents verified.')}>{isQ ? 'Send query to A' : 'Confirm verification'}</Btn></>}>
        {summary}
        {isQ ? box('The payment goes back to A. After A resubmits, it returns directly to you — B approval is not repeated unless a material field changes.') : box('Tick every item to confirm you have checked the ORIGINAL documents. All items are mandatory.')}
        <div className="mb-2 flex items-center justify-between"><span className="text-xs font-semibold uppercase tracking-wide text-slate-500">{isQ ? 'Items with a problem (optional)' : 'Verification checklist'}</span><button className="text-xs font-semibold text-navy-600 hover:underline" onClick={() => tickAll(list, !allTick(list))}>{allTick(list) ? 'Untick all' : 'Tick all'}</button></div>
        <div className="grid gap-2 rounded-lg border border-slate-200 p-3 sm:grid-cols-2">{list.map(([k, l]) => <Check key={k} checked={!!cl[k]} onChange={(v) => setCl({ ...cl, [k]: v })} label={l} />)}</div>
        {isQ && <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Field label="Required document"><select className="input" value={f.required_document ?? ''} onChange={(e) => set('required_document', e.target.value)}><option value="">—</option>{REQUIRED_DOCS.map((x) => <option key={x}>{x}</option>)}</select></Field>
          <Field label="Required correction"><select className="input" value={f.required_correction ?? ''} onChange={(e) => set('required_correction', e.target.value)}><option value="">—</option>{CORRECTIONS.map((x) => <option key={x}>{x}</option>)}</select></Field></div>}
        <Field className="mt-3" label={isQ ? 'Query for A' : 'Remarks (optional)'} required={isQ}><textarea className="input" rows={3} value={f.remarks ?? ''} onChange={(e) => set('remarks', e.target.value)} placeholder={isQ ? 'Explain what is wrong and what A must provide.' : ''} /></Field>
        {errBox}
      </Modal>);
  }

  // ---------------------------------------------------------------- A resubmit
  if (open === 'resubmit') {
    return (
      <Modal open onClose={onClose} title="Resolve query & resubmit" footer={<><button className="btn-outline" onClick={onClose}>Cancel</button><Btn busy={busy} className="btn-primary" onClick={() => call(async () => { for (const file of (f.files ?? []) as File[]) { const fd = new FormData(); fd.append('file', file); fd.append('doc_type', f.doc_type ?? 'Corrected Document'); await api.upload(`/payments/${id}/documents`, fd); } await api.post(`/payments/${id}/resubmit`, { remarks: f.remarks }); }, 'Resubmitted. The same Payment Advice is back with the verifier.')}>Resubmit same Payment Advice</Btn></>}>
        {summary}{box('This does NOT create a new Payment Advice. The advice keeps its number and goes straight back to the person who raised the query. If you changed any material field, use “Amend” instead.')}
        {data.queries.filter((q: any) => q.status === 'OPEN').map((q: any) => <div key={q.id} className="mb-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-900"><div className="text-[11px] font-semibold uppercase">Open query from {q.raised_by_stage}</div><div className="mt-0.5">{q.reason}</div>{q.required_document && <div className="mt-1 text-xs">Document needed: <b>{q.required_document}</b></div>}{q.required_correction && <div className="text-xs">Correction needed: <b>{q.required_correction}</b></div>}</div>)}
        <div className="mb-3 rounded-lg border border-dashed border-navy-300 bg-navy-50/40 p-3"><div className="mb-2 text-xs font-semibold uppercase tracking-wide text-navy-600">Attach corrected / additional documents</div>
          <div className="flex flex-wrap items-center gap-2"><select className="input !w-auto" value={f.doc_type ?? 'Corrected Document'} onChange={(e) => set('doc_type', e.target.value)}>{meta.docTypes.map((t: string) => <option key={t}>{t}</option>)}</select>
            <input type="file" multiple className="text-xs" onChange={(e) => set('files', Array.from(e.target.files ?? []))} /></div>{(f.files ?? []).length > 0 && <p className="mt-1 text-[11px] text-slate-500">{(f.files as File[]).map((x) => x.name).join(', ')} — uploaded when you resubmit.</p>}</div>
        <Field label="How was the query resolved?" required><textarea className="input" rows={3} value={f.remarks ?? ''} onChange={(e) => set('remarks', e.target.value)} placeholder="e.g. Uploaded the corrected invoice and the GRN." /></Field>{errBox}
      </Modal>);
  }

  // ---------------------------------------------------------------- C initiate
  if (open === 'initiate') {
    const mode = data.mode; const rf: string[] = mode?.required_fields ?? [];
    const LABEL: Record<string, string> = { bank_ref_no: 'Bank reference number', cheque_no: 'Cheque number', cheque_date: 'Cheque date', dd_no: 'Demand draft number', dd_favouring: 'Draft favouring', upi_id: 'UPI ID', destination_account: 'Destination account' };
    const extra = rf.filter((x) => x !== 'bank_ref_no');
    const md = f.md ?? {};
    return (
      <Modal open onClose={onClose} title="Record bank portal initiation" size="lg" footer={<><button className="btn-outline" onClick={onClose}>Cancel</button><Btn busy={busy} className="btn-primary" onClick={() => call(() => api.post(`/payments/${id}/bank-initiation`, { bank_ref_no: f.bank_ref_no, utr: f.utr, initiated_date: f.date ?? todayIso(), initiated_time: f.time, mode_details: md, remarks: f.remarks }), 'Payment recorded as initiated. It is now with D for final approval.')}>Mark initiated & send to D</Btn></>}>
        {summary}
        {box(`Initiate the payment manually on ${p.bank_name}'s portal (${p.bank_portal ?? 'internet banking'}) using ${mode?.name}. Then record only the reference here. Never enter your bank User ID, password or OTP in this system.`)}
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-lg bg-slate-50 p-3 text-xs sm:col-span-2"><b>{data.vendor?.name}</b> · {data.payment.beneficiary_bank_name ?? '—'} · A/c {data.payment.beneficiary_account_masked} · IFSC {data.payment.beneficiary_ifsc ?? '—'} · <b className="num">{money(p.net_payable, true)}</b></div>
          <Field label={LABEL.bank_ref_no + (rf.includes('bank_ref_no') || !extra.length ? '' : ' (optional)')} required={rf.includes('bank_ref_no')}><input className="input" value={f.bank_ref_no ?? ''} onChange={(e) => set('bank_ref_no', e.target.value)} /></Field>
          <Field label="UTR (if available)"><input className="input" value={f.utr ?? ''} onChange={(e) => set('utr', e.target.value)} /></Field>
          <Field label="Initiated on"><input type="date" className="input" value={f.date ?? todayIso()} max={todayIso()} onChange={(e) => set('date', e.target.value)} /></Field>
          <Field label="Time"><input type="time" className="input" value={f.time ?? ''} onChange={(e) => set('time', e.target.value)} /></Field>
          {extra.map((k) => <Field key={k} label={LABEL[k] ?? k} required><input className="input" type={k.endsWith('date') ? 'date' : 'text'} value={md[k] ?? ''} onChange={(e) => set('md', { ...md, [k]: e.target.value })} /></Field>)}
          <Field label="Remarks" className="sm:col-span-2"><textarea className="input" rows={2} value={f.remarks ?? ''} onChange={(e) => set('remarks', e.target.value)} /></Field>
        </div>{errBox}
      </Modal>);
  }

  // ---------------------------------------------------------------- D
  if (open === 'd') {
    const list = meta.dChecklist as [string, string][]; const d = f.decision;
    return (
      <Modal open onClose={onClose} title="Final bank approval — D" size="lg" footer={<><button className="btn-outline" onClick={onClose}>Cancel</button>
        <Btn busy={busy} disabled={!d || (d === 'APPROVE' && !allTick(list))} className={d === 'REJECT' ? 'btn-red' : 'btn-green'}
          onClick={() => call(() => api.post(`/payments/${id}/d-decision`, { decision: d, checklist: cl, remarks: f.remarks, reason: f.reason, return_to: f.return_to }), d === 'APPROVE' ? 'Payment approved. C has been notified on WhatsApp.' : 'Payment rejected and returned.')}>{d === 'REJECT' ? 'Reject & return' : 'Approve payment'}</Btn></>}>
        {summary}
        <div className="mb-3 grid gap-x-4 gap-y-1 rounded-lg border border-slate-200 p-3 text-xs sm:grid-cols-2">
          <div><span className="text-slate-400">Beneficiary:</span> <b>{p.beneficiary_name}</b></div><div><span className="text-slate-400">Beneficiary A/c:</span> {p.beneficiary_account_masked} · {p.beneficiary_ifsc}</div>
          <div><span className="text-slate-400">Paying bank:</span> {p.bank_name} {p.account_last4 && `· XXXX ${p.account_last4}`}</div><div><span className="text-slate-400">Mode:</span> {p.payment_mode}</div>
          <div><span className="text-slate-400">Bank ref:</span> <b>{data.bank_transactions.find((t: any) => t.is_current)?.bank_ref_no ?? '—'}</b></div><div><span className="text-slate-400">Initiated by:</span> {data.bank_transactions.find((t: any) => t.is_current)?.initiated_by_name ?? '—'}</div>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <button onClick={() => set('decision', 'APPROVE')} className={`rounded-lg border-2 px-3 py-3 text-sm font-semibold ${d === 'APPROVE' ? 'border-emerald-500 bg-emerald-50 text-emerald-800' : 'border-slate-200 text-slate-600'}`}>Approve payment</button>
          <button onClick={() => set('decision', 'REJECT')} className={`rounded-lg border-2 px-3 py-3 text-sm font-semibold ${d === 'REJECT' ? 'border-red-500 bg-red-50 text-red-800' : 'border-slate-200 text-slate-600'}`}>Reject / return</button>
        </div>
        {d === 'APPROVE' && <div className="mt-4"><div className="mb-2 flex items-center justify-between"><span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Final review — confirm each item</span><button className="text-xs font-semibold text-navy-600 hover:underline" onClick={() => tickAll(list, !allTick(list))}>{allTick(list) ? 'Untick all' : 'Tick all'}</button></div>
          <div className="grid gap-2 rounded-lg border border-slate-200 p-3 sm:grid-cols-2">{list.map(([k, l]) => <Check key={k} checked={!!cl[k]} onChange={(v) => setCl({ ...cl, [k]: v })} label={l} />)}</div></div>}
        {d === 'REJECT' && <div className="mt-4 space-y-3"><Field label="Return to" required><div className="flex gap-2">{[['A', 'A — Maker (documents / details wrong)'], ['C', 'C — Bank initiation (portal details wrong)']].map(([k, l]) => <button key={k} onClick={() => set('return_to', k)} className={`flex-1 rounded-lg border-2 px-3 py-2 text-left text-xs font-medium ${f.return_to === k ? 'border-navy-600 bg-navy-50 text-navy-900' : 'border-slate-200 text-slate-600'}`}>{l}</button>)}</div></Field>
          <Field label="Rejection reason" required><textarea className="input" rows={3} value={f.reason ?? ''} onChange={(e) => set('reason', e.target.value)} /></Field></div>}
        <Field className="mt-3" label="Remarks (optional)"><textarea className="input" rows={2} value={f.remarks ?? ''} onChange={(e) => set('remarks', e.target.value)} /></Field>{errBox}
      </Modal>);
  }

  // ---------------------------------------------------------------- bank update
  if (open === 'bank_update') {
    const cur = data.bank_transactions.find((t: any) => t.is_current);
    const ST = [['PROCESSED', 'Processed / credited (Payment completed)'], ['FAILED', 'Failed'], ['RETURNED', 'Returned by beneficiary bank'], ['REVERSED', 'Reversed'], ['RECONCILED', 'Reconciled with bank statement']];
    return (
      <Modal open onClose={onClose} title="Update bank status / reconciliation" footer={<><button className="btn-outline" onClick={onClose}>Cancel</button><Btn busy={busy} className="btn-primary" disabled={!f.bank_status} onClick={() => call(() => api.post(`/payments/${id}/bank-status`, { bank_status: f.bank_status, utr: f.utr ?? cur?.utr, bank_txn_id: f.bank_txn_id, actual_debit_date: f.date ?? todayIso(), actual_debit_amount: Number(f.amount ?? p.net_payable), remarks: f.remarks }), 'Bank status updated.')}>Save</Btn></>}>
        {summary}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Bank status" required className="sm:col-span-2"><select className="input" value={f.bank_status ?? ''} onChange={(e) => set('bank_status', e.target.value)}><option value="">Select…</option>{ST.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
          <Field label="UTR"><input className="input" defaultValue={cur?.utr ?? ''} onChange={(e) => set('utr', e.target.value)} /></Field>
          <Field label="Bank transaction ID"><input className="input" onChange={(e) => set('bank_txn_id', e.target.value)} /></Field>
          <Field label="Actual debit date" required={f.bank_status === 'PROCESSED'}><input type="date" className="input" max={todayIso()} value={f.date ?? todayIso()} onChange={(e) => set('date', e.target.value)} /></Field>
          <Field label="Actual debit amount (₹)"><input type="number" className="input num" step="0.01" value={f.amount ?? p.net_payable} onChange={(e) => set('amount', e.target.value)} /></Field>
          <Field label="Remarks" className="sm:col-span-2"><textarea className="input" rows={2} onChange={(e) => set('remarks', e.target.value)} /></Field>
        </div>{errBox}
      </Modal>);
  }

  // ---------------------------------------------------------------- hold / release / cancel
  if (open === 'hold' || open === 'release' || open === 'cancel') {
    const cfg = { hold: ['Put on hold', 'hold', 'reason', 'Payment put on hold.', 'btn-amber', 'Reason for hold'], release: ['Release from hold', 'release', 'remarks', 'Released from hold.', 'btn-primary', 'Remarks (optional)'], cancel: ['Cancel Payment Advice', 'cancel', 'reason', 'Done.', 'btn-red', 'Reason for cancellation'] }[open];
    return (
      <Modal open onClose={onClose} title={cfg[0]} size="sm" footer={<><button className="btn-outline" onClick={onClose}>Close</button><Btn busy={busy} className={cfg[4]} onClick={() => call(() => api.post(`/payments/${id}/${cfg[1]}`, { [cfg[2]]: f.text }), open === 'cancel' ? 'Cancellation recorded.' : cfg[3])}>{cfg[0]}</Btn></>}>
        {open === 'cancel' && box(['PAYMENT_INITIATED', 'PENDING_D_APPROVAL', 'D_APPROVED'].includes(p.status) ? 'Because the payment has already been initiated, cancellation needs authorisation from an approver. Also cancel it on the bank portal.' : 'Cancelling is permanent — the Payment Advice number is retained for audit.', open === 'cancel')}
        <Field label={cfg[5]} required={open !== 'release'}><textarea className="input" rows={3} value={f.text ?? ''} onChange={(e) => set('text', e.target.value)} /></Field>{errBox}
      </Modal>);
  }

  // ---------------------------------------------------------------- cancellation decision
  if (open === 'cancel_decide') {
    const req = data.cancellations.find((c: any) => c.status === 'PENDING');
    return (
      <Modal open onClose={onClose} title="Cancellation request" size="sm" footer={<><button className="btn-outline" onClick={onClose}>Close</button>
        <Btn busy={busy} className="btn-outline" onClick={() => call(() => api.post(`/payments/${id}/cancellations/${req.id}/decision`, { approve: false, remarks: f.remarks }), 'Cancellation request declined.')}>Decline</Btn>
        <Btn busy={busy} className="btn-red" onClick={() => call(() => api.post(`/payments/${id}/cancellations/${req.id}/decision`, { approve: true, remarks: f.remarks }), 'Payment Advice cancelled.')}>Approve cancellation</Btn></>}>
        <div className="mb-3 rounded-lg bg-slate-50 p-3 text-sm"><div className="text-xs text-slate-400">Requested by {req?.requested_by_name}</div>{req?.reason}</div>
        <Field label="Remarks"><textarea className="input" rows={2} value={f.remarks ?? ''} onChange={(e) => set('remarks', e.target.value)} /></Field>{errBox}
      </Modal>);
  }
  return null;
}
export { Icon };
