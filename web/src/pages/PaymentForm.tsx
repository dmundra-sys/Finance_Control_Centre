import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ApiError, api, errMsg } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Badge, Btn, Card, Confirm, ErrorBox, Field, Icon, Loading, Modal, PageHeader, useAsync, useToast } from '../components/ui';
import { bytes, fmtDate, money, todayIso } from '../lib/format';

const num = (v: any) => (v === '' || v == null ? 0 : Number(v));
const blank = { company_id: '', bank_account_id: '', vendor_id: '', payment_type: 'VENDOR', payment_mode: 'NEFT', priority: 'NORMAL', department: '', invoice_number: '', invoice_date: '', po_number: '', grn_reference: '', gross_amount: '', gst_amount: '', tds_amount: '', other_deduction: '', advance_adjustment: '', due_date: '', purpose: '', remarks: '' };

export default function PaymentForm() {
  const { id } = useParams(); const editing = !!id; const [sp] = useSearchParams(); const amend = editing && sp.get('amend') === '1'; const [amendReason, setAmendReason] = useState(''); const nav = useNavigate(); const toast = useToast(); const { me } = useAuth();
  const meta = useAsync(() => api.get('/payments/meta'), []);
  const existing = useAsync(() => (editing ? api.get(`/payments/${id}`) : Promise.resolve(null)), [id]);
  const [f, setF] = useState<any>(blank); const [items, setItems] = useState<any[]>([]); const [errs, setErrs] = useState<Record<string, string>>({});
  const [files, setFiles] = useState<{ file: File; doc_type: string }[]>([]); const [busy, setBusy] = useState<'' | 'draft' | 'submit'>(''); const [banner, setBanner] = useState('');
  const [dups, setDups] = useState<any>(null); const [dupReason, setDupReason] = useState(''); const [showDup, setShowDup] = useState(false); const [inlineDup, setInlineDup] = useState<any[]>([]);
  const [delDoc, setDelDoc] = useState<any>(null); const fileRef = useRef<HTMLInputElement>(null); const [docType, setDocType] = useState('Invoice');

  useEffect(() => {
    const d = existing.data as any; if (!d) return; const p = d.payment;
    if (amend ? !d.actions.amendment : (!d.actions.edit && !d.actions.submit)) { nav(`/payments/${p.id}`, { replace: true }); return; }
    setF({ ...blank, ...Object.fromEntries(Object.keys(blank).map((k) => [k, p[k] ?? ''])), invoice_date: (p.invoice_date ?? '').slice(0, 10), due_date: (p.due_date ?? '').slice(0, 10) });
    setItems(d.items.map((i: any) => ({ description: i.description, hsn_sac: i.hsn_sac ?? '', quantity: i.quantity, rate: i.rate, amount: i.amount, gst_rate: i.gst_rate })));
    // eslint-disable-next-line
  }, [existing.data]);

  const m = meta.data as any;
  const set = (k: string, v: any) => { setF((x: any) => ({ ...x, [k]: v })); setErrs((e) => ({ ...e, [k]: '' })); };
  const banks = useMemo(() => (m?.banks ?? []).filter((b: any) => String(b.company_id) === String(f.company_id)), [m, f.company_id]);
  useEffect(() => { if (m && f.company_id && f.bank_account_id && !banks.find((b: any) => String(b.id) === String(f.bank_account_id))) set('bank_account_id', banks.length === 1 ? String(banks[0].id) : ''); /* eslint-disable-next-line */ }, [f.company_id, banks.length]);
  useEffect(() => { if (m && !editing && m.companies.length === 1 && !f.company_id) set('company_id', String(m.companies[0].id)); /* eslint-disable-next-line */ }, [m]);
  const vendor = m?.vendors.find((v: any) => String(v.id) === String(f.vendor_id));
  const mode = m?.modes.find((x: any) => x.code === f.payment_mode);
  const net = Math.round((num(f.gross_amount) - num(f.tds_amount) - num(f.other_deduction) - num(f.advance_adjustment)) * 100) / 100;
  const modeWarn = mode && f.gross_amount !== '' && ((mode.min_amount != null && net < mode.min_amount) ? `${mode.name} needs a minimum of ${money(mode.min_amount)}.` : (mode.max_amount != null && net > mode.max_amount) ? `${mode.name} allows a maximum of ${money(mode.max_amount)}. Choose another mode.` : '');

  // live duplicate hint
  useEffect(() => {
    if (!f.company_id || !f.vendor_id || !f.invoice_number || !f.invoice_date || !num(f.gross_amount)) { setInlineDup([]); return; }
    const t = setTimeout(() => api.post('/payments/duplicate-check', { company_id: f.company_id, vendor_id: f.vendor_id, invoice_number: f.invoice_number, invoice_date: f.invoice_date, gross_amount: num(f.gross_amount), exclude_id: id }).then((r) => setInlineDup(r.duplicates)).catch(() => {}), 600);
    return () => clearTimeout(t);
  }, [f.company_id, f.vendor_id, f.invoice_number, f.invoice_date, f.gross_amount, id]);

  function body() {
    const b: any = { ...f, company_id: +f.company_id, bank_account_id: +f.bank_account_id, vendor_id: +f.vendor_id };
    for (const k of ['gross_amount', 'gst_amount', 'tds_amount', 'other_deduction', 'advance_adjustment']) b[k] = num(f[k]);
    for (const k of ['due_date', 'department', 'po_number', 'grn_reference', 'purpose', 'remarks']) if (b[k] === '') b[k] = null;
    b.items = items.filter((i) => i.description.trim()).map((i) => ({ ...i, quantity: num(i.quantity), rate: num(i.rate), amount: num(i.amount), gst_rate: num(i.gst_rate) }));
    return b;
  }
  async function save(): Promise<number | null> {
    setErrs({}); setBanner('');
    try {
      let pid = editing ? Number(id) : 0;
      if (editing) await api.put(`/payments/${id}`, body()); else pid = (await api.post('/payments', body())).id;
      for (const x of files) { const fd = new FormData(); fd.append('file', x.file); fd.append('doc_type', x.doc_type); await api.upload(`/payments/${pid}/documents`, fd); }
      setFiles([]); return pid;
    } catch (e) {
      if (e instanceof ApiError && Array.isArray(e.details)) { const m2: Record<string, string> = {}; for (const x of e.details) if (x?.path && !m2[x.path]) m2[x.path] = x.message; setErrs(m2); }
      setBanner(errMsg(e)); window.scrollTo({ top: 0, behavior: 'smooth' }); return null;
    }
  }
  async function submitAmendment() {
    setBusy('submit'); setBanner('');
    try {
      const b = { ...body(), amendment_reason: amendReason };
      const r = await api.post(`/payments/${id}/amendment`, b).catch(async (e) => { if (e instanceof ApiError && e.details?.code === 'DUPLICATE') { setDups({ duplicates: e.details.duplicates, can_override: e.details.can_override, pid: Number(id), amend: true }); setShowDup(true); return null; } throw e; });
      if (r) { toast.ok('Amendment submitted. B approval has been restarted if a material field changed.'); nav(`/payments/${id}`); }
    } catch (e) { setBanner(errMsg(e)); window.scrollTo({ top: 0, behavior: 'smooth' }); } finally { setBusy(''); }
  }
  async function draft() { setBusy('draft'); const pid = await save(); setBusy(''); if (pid) { toast.ok('Draft saved.'); nav(`/payments/${pid}`); } }
  async function submit(override?: string) {
    setBusy('submit');
    const pid = await save(); if (!pid) { setBusy(''); return; }
    try {
      if (!override) {
        const r = await api.post('/payments/duplicate-check', { company_id: f.company_id, vendor_id: f.vendor_id, invoice_number: f.invoice_number, invoice_date: f.invoice_date, gross_amount: num(f.gross_amount), exclude_id: pid });
        if (r.duplicates.length) { setDups({ ...r, pid }); setShowDup(true); setBusy(''); return; }
      }
      await api.post(`/payments/${pid}/submit`, override ? { override_reason: override } : {});
      toast.ok('Submitted for approval. B has been notified.'); nav(`/payments/${pid}`);
    } catch (e) { setBanner(errMsg(e)); toast.err(e); if (!editing) nav(`/payments/${pid}/edit`, { replace: true }); window.scrollTo({ top: 0, behavior: 'smooth' }); }
    finally { setBusy(''); }
  }

  if (meta.loading || existing.loading) return <Loading />; if (meta.error) return <ErrorBox error={meta.error} retry={meta.reload} />;
  const err = (k: string) => errs[k];
  const docs = (existing.data as any)?.documents?.filter((d: any) => d.status === 'ACTIVE') ?? [];
  const canOverride = me!.user.canOverrideDuplicate;
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader title={amend ? `Amend ${(existing.data as any)?.payment.pa_number}` : editing ? `Edit ${(existing.data as any)?.payment.pa_number}` : 'New Payment Advice'} subtitle={amend ? 'Change the details and state why. A material change sends the advice back for approval; the change history is kept.' : 'Complete the details, attach the supporting documents and submit for B approval.'}
        actions={<Link to={editing ? `/payments/${id}` : '/payments'} className="btn-outline">Cancel</Link>} />
      {banner && <div role="alert" className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{banner}</div>}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card title="1 · Company, bank & payee">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Company" required error={err('company_id')}><select className="input" value={f.company_id} onChange={(e) => set('company_id', e.target.value)}><option value="">Select company</option>{m.companies.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
              <Field label="Paying bank account" required error={err('bank_account_id')}><select className="input" value={f.bank_account_id} onChange={(e) => set('bank_account_id', e.target.value)} disabled={!f.company_id}><option value="">{f.company_id ? 'Select bank account' : 'Choose company first'}</option>{banks.map((b: any) => <option key={b.id} value={b.id}>{b.bank_name} · {b.account_masked}</option>)}</select></Field>
              <Field label="Vendor / party" required error={err('vendor_id')} className="sm:col-span-2"><select className="input" value={f.vendor_id} onChange={(e) => set('vendor_id', e.target.value)}><option value="">Select vendor or party</option>{m.vendors.map((v: any) => <option key={v.id} value={v.id}>{v.name} ({v.vendor_code})</option>)}</select></Field>
              {vendor && (
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600 sm:col-span-2">
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1"><span><b>Beneficiary bank:</b> {vendor.bank_name ?? '—'}</span><span><b>A/c:</b> {vendor.bank_account_last4 ? `XXXX XXXX ${vendor.bank_account_last4}` : '—'}</span><span><b>IFSC:</b> {vendor.ifsc ?? '—'}</span><span><b>TDS:</b> {vendor.tds_section ?? '—'}</span><span><b>GST:</b> {vendor.gst_registration}</span>{vendor.msme_status !== 'NOT_MSME' && <Badge tone="teal">MSME · {vendor.msme_status}</Badge>}</div>
                  {!vendor.bank_authorised && <div className="mt-2 rounded border border-amber-200 bg-amber-50 px-2 py-1.5 font-medium text-amber-800">Bank details for this vendor are awaiting authorisation. You can save a draft but cannot submit until they are authorised.</div>}
                </div>)}
              <Field label="Payment type" required error={err('payment_type')}><select className="input" value={f.payment_type} onChange={(e) => set('payment_type', e.target.value)}>{m.paymentTypes.map((t: any) => <option key={t.code} value={t.code}>{t.name}</option>)}</select></Field>
              <Field label="Department" error={err('department')}><select className="input" value={f.department} onChange={(e) => set('department', e.target.value)}><option value="">—</option>{m.departments.map((d: any) => <option key={d.code} value={d.name}>{d.name}</option>)}</select></Field>
            </div>
          </Card>
          <Card title="2 · Invoice details">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Invoice / bill number" required error={err('invoice_number')}><input className="input" value={f.invoice_number} onChange={(e) => set('invoice_number', e.target.value)} maxLength={60} /></Field>
              <Field label="Invoice date" required error={err('invoice_date')}><input type="date" className="input" max={todayIso()} value={f.invoice_date} onChange={(e) => set('invoice_date', e.target.value)} /></Field>
              <Field label="PO number" error={err('po_number')}><input className="input" value={f.po_number} onChange={(e) => set('po_number', e.target.value)} /></Field>
              <Field label="GRN / service receipt reference" error={err('grn_reference')}><input className="input" value={f.grn_reference} onChange={(e) => set('grn_reference', e.target.value)} /></Field>
              <Field label="Payment due date" error={err('due_date')}><input type="date" className="input" value={f.due_date} onChange={(e) => set('due_date', e.target.value)} /></Field>
              <Field label="Priority" error={err('priority')}><select className="input" value={f.priority} onChange={(e) => set('priority', e.target.value)}>{m.priorities.map((p: string) => <option key={p}>{p}</option>)}</select></Field>
            </div>
            {inlineDup.length > 0 && (
              <div className="mt-3 rounded-lg border border-orange-300 bg-orange-50 p-3 text-sm text-orange-900">
                <div className="flex items-center gap-2 font-semibold"><Icon name="alert" className="h-4 w-4" />Possible duplicate payment</div>
                <ul className="mt-1.5 space-y-0.5 text-xs">{inlineDup.slice(0, 4).map((d) => <li key={d.id}><Link to={`/payments/${d.id}`} target="_blank" className="font-semibold underline">{d.pa_number}</Link> · {d.kind === 'EXACT' ? 'Same invoice, date and amount' : 'Same invoice number'} · {money(d.amount)} · {d.status.replace(/_/g, ' ')}</li>)}</ul>
                <p className="mt-1.5 text-xs">{canOverride ? 'You can override with a recorded reason at the time of submission.' : 'You cannot submit until this is resolved — an authorised user must approve an override.'}</p>
              </div>)}
          </Card>
          <Card title="3 · Amount">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Invoice / payment amount (₹)" required error={err('gross_amount')}><input type="number" step="0.01" min="0" className="input num" value={f.gross_amount} onChange={(e) => set('gross_amount', e.target.value)} /></Field>
              <Field label="GST amount included (₹)" error={err('gst_amount')} hint="Information only — not deducted."><input type="number" step="0.01" min="0" className="input num" value={f.gst_amount} onChange={(e) => set('gst_amount', e.target.value)} /></Field>
              <Field label="TDS deducted (₹)" error={err('tds_amount')}><input type="number" step="0.01" min="0" className="input num" value={f.tds_amount} onChange={(e) => set('tds_amount', e.target.value)} /></Field>
              <Field label="Other deduction (₹)" error={err('other_deduction')}><input type="number" step="0.01" min="0" className="input num" value={f.other_deduction} onChange={(e) => set('other_deduction', e.target.value)} /></Field>
              <Field label="Advance adjustment (₹)" error={err('advance_adjustment')}><input type="number" step="0.01" min="0" className="input num" value={f.advance_adjustment} onChange={(e) => set('advance_adjustment', e.target.value)} /></Field>
              <Field label="Payment mode" required error={err('payment_mode')}><select className="input" value={f.payment_mode} onChange={(e) => set('payment_mode', e.target.value)}>{m.modes.map((x: any) => <option key={x.code} value={x.code}>{x.name}</option>)}</select></Field>
            </div>
            {modeWarn && <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800">{modeWarn}</p>}
            <div className="mt-4 flex items-center justify-between rounded-lg bg-navy-900 px-4 py-3 text-white"><span className="text-sm text-navy-200">Net payable</span><span className="num text-xl font-bold">{f.gross_amount === '' ? '—' : money(net, true)}</span></div>
          </Card>
          <Card title="4 · Line items (optional)" actions={<button className="btn-outline btn-sm" onClick={() => setItems([...items, { description: '', hsn_sac: '', quantity: 1, rate: 0, amount: 0, gst_rate: 0 }])}><Icon name="plus" className="h-3.5 w-3.5" />Add line</button>}>
            {items.length === 0 ? <p className="text-sm text-slate-500">No line items. Add lines if you want them printed on the Payment Advice.</p> :
              <div className="space-y-3">{items.map((it, i) => (
                <div key={i} className="grid grid-cols-2 gap-2 rounded-lg border border-slate-200 p-3 sm:grid-cols-12">
                  <input className="input col-span-2 sm:col-span-5" placeholder="Description" value={it.description} onChange={(e) => setItems(items.map((x, j) => j === i ? { ...x, description: e.target.value } : x))} />
                  <input className="input sm:col-span-2" placeholder="HSN/SAC" value={it.hsn_sac} onChange={(e) => setItems(items.map((x, j) => j === i ? { ...x, hsn_sac: e.target.value } : x))} />
                  <input className="input num sm:col-span-1" type="number" placeholder="Qty" value={it.quantity} onChange={(e) => setItems(items.map((x, j) => j === i ? { ...x, quantity: e.target.value, amount: +(num(e.target.value) * num(x.rate)).toFixed(2) } : x))} />
                  <input className="input num sm:col-span-2" type="number" placeholder="Rate" value={it.rate} onChange={(e) => setItems(items.map((x, j) => j === i ? { ...x, rate: e.target.value, amount: +(num(x.quantity) * num(e.target.value)).toFixed(2) } : x))} />
                  <input className="input num sm:col-span-2" type="number" placeholder="Amount" value={it.amount} onChange={(e) => setItems(items.map((x, j) => j === i ? { ...x, amount: e.target.value } : x))} />
                  <button className="btn-ghost btn-sm col-span-2 text-red-600 sm:col-span-12 sm:justify-self-end" onClick={() => setItems(items.filter((_, j) => j !== i))}>Remove line</button>
                </div>))}</div>}
          </Card>
          <Card title="5 · Purpose & remarks">
            <div className="grid gap-3"><Field label="Purpose of payment" error={err('purpose')}><input className="input" value={f.purpose} onChange={(e) => set('purpose', e.target.value)} maxLength={500} /></Field>
              <Field label="Remarks for approvers" error={err('remarks')}><textarea className="input min-h-[80px]" value={f.remarks} onChange={(e) => set('remarks', e.target.value)} maxLength={2000} /></Field></div>
          </Card>
        </div>
        <div className="space-y-4">
          <Card title="Supporting documents">
            <p className="mb-3 text-xs text-slate-500">PDF, images, Excel or Word up to {m.docSettings.max_file_mb} MB each. At least one document (e.g. the invoice copy) is required to submit.</p>
            {docs.length > 0 && <ul className="mb-3 divide-y divide-slate-100 rounded-lg border border-slate-200">{docs.map((d: any) => (
              <li key={d.id} className="flex items-center justify-between gap-2 px-3 py-2 text-xs"><div className="min-w-0"><div className="truncate font-medium text-slate-700">{d.doc_name}</div><div className="text-slate-400">{d.doc_type} · v{d.version} · {bytes(d.size_bytes)}</div></div><button className="text-red-600 hover:underline" onClick={() => setDelDoc(d)}>Remove</button></li>))}</ul>}
            {files.length > 0 && <ul className="mb-3 divide-y divide-slate-100 rounded-lg border border-dashed border-navy-300 bg-navy-50/40">{files.map((x, i) => (
              <li key={i} className="flex items-center justify-between gap-2 px-3 py-2 text-xs"><div className="min-w-0"><div className="truncate font-medium text-slate-700">{x.file.name}</div><div className="text-slate-400">{x.doc_type} · {bytes(x.file.size)} · uploads on save</div></div><button className="text-red-600 hover:underline" onClick={() => setFiles(files.filter((_, j) => j !== i))}>Remove</button></li>))}</ul>}
            <div className="flex gap-2"><select className="input" value={docType} onChange={(e) => setDocType(e.target.value)}>{m.docTypes.map((t: string) => <option key={t}>{t}</option>)}</select></div>
            <input ref={fileRef} type="file" multiple hidden accept={m.docSettings.allowed_extensions.map((e: string) => '.' + e).join(',')} onChange={(e) => { const list = Array.from(e.target.files ?? []).filter((file) => { if (file.size > m.docSettings.max_file_mb * 1048576) { toast.err(`${file.name} is larger than ${m.docSettings.max_file_mb} MB.`); return false; } return true; }); setFiles([...files, ...list.map((file) => ({ file, doc_type: docType }))]); e.target.value = ''; }} />
            <button className="btn-outline mt-2 w-full border-dashed" onClick={() => fileRef.current?.click()}><Icon name="upload" className="h-4 w-4" />Choose files…</button>
          </Card>
          <Card title="What happens next">
            <ol className="space-y-2 text-xs text-slate-600">
              <li className="flex gap-2"><b className="text-navy-700">B</b> approves as per the approval matrix for {net > 0 ? money(net) : 'this amount'}.</li>
              <li className="flex gap-2"><b className="text-navy-700">C</b> verifies the original documents and accounting, then initiates on the bank portal.</li>
              <li className="flex gap-2"><b className="text-navy-700">D</b> gives the final bank approval; C gets a WhatsApp message.</li>
            </ol>
          </Card>
          <div className="sticky bottom-3 space-y-2 rounded-xl border border-slate-200 bg-white p-3 shadow-pop">
            {amend ? (<>
              <Field label="Reason for amendment" required><textarea className="input" rows={3} value={amendReason} onChange={(e) => setAmendReason(e.target.value)} /></Field>
              <Btn busy={busy === 'submit'} disabled={!!busy || !amendReason.trim()} className="btn-primary w-full !py-2.5" onClick={submitAmendment}><Icon name="check" className="h-4 w-4" />Submit amendment</Btn></>) : (<>
              <Btn busy={busy === 'submit'} disabled={!!busy} className="btn-primary w-full !py-2.5" onClick={() => submit()}><Icon name="check" className="h-4 w-4" />Submit for approval</Btn>
              <Btn busy={busy === 'draft'} disabled={!!busy} className="btn-outline w-full" onClick={draft}>Save as draft</Btn></>)}
          </div>
        </div>
      </div>
      <Modal open={showDup} onClose={() => setShowDup(false)} title="Possible duplicate payment detected" size="lg"
        footer={<><button className="btn-outline" onClick={() => { setShowDup(false); if (!dups?.amend) nav(`/payments/${dups?.pid}`); }}>{dups?.amend ? 'Go back' : 'Keep as draft'}</button>
          {dups?.can_override && <Btn className="btn-amber" disabled={dupReason.trim().length < 10} onClick={async () => { setShowDup(false); if (dups?.amend) { setBusy('submit'); try { await api.post(`/payments/${id}/amendment`, { ...body(), amendment_reason: amendReason, override_reason: dupReason.trim() }); toast.ok('Amendment submitted.'); nav(`/payments/${id}`); } catch (e) { setBanner(errMsg(e)); } finally { setBusy(''); } } else await submit(dupReason.trim()); }}>Override & submit</Btn>}</>}>
        <p className="text-sm text-slate-600">An existing Payment Advice looks like this one. Paying twice is expensive — please check before proceeding.</p>
        <div className="mt-3 overflow-x-auto rounded-lg border border-slate-200"><table className="w-full text-sm"><thead><tr><th className="th">Payment Advice</th><th className="th">Why it matched</th><th className="th">Invoice</th><th className="th text-right">Amount</th><th className="th">Status</th></tr></thead>
          <tbody className="divide-y divide-slate-100">{dups?.duplicates.map((d: any) => <tr key={d.id}><td className="td"><Link to={`/payments/${d.id}`} target="_blank" className="link">{d.pa_number}</Link></td><td className="td text-xs">{d.kind === 'EXACT' ? 'Same vendor, invoice no., date, amount & company' : 'Same vendor & invoice number'}</td><td className="td">{d.invoice_number} · {fmtDate(d.invoice_date)}</td><td className="td num text-right">{money(d.amount)}</td><td className="td text-xs">{d.status.replace(/_/g, ' ')}</td></tr>)}</tbody></table></div>
        {dups?.can_override ? <Field className="mt-4" label="Override reason (recorded in the audit trail)" required hint="Minimum 10 characters."><textarea className="input" rows={3} value={dupReason} onChange={(e) => setDupReason(e.target.value)} placeholder="e.g. Second instalment against the same invoice as per contract clause 4." /></Field>
          : <p className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">You are not authorised to override duplicate-payment control. Your advice has been saved as a draft; ask an authorised colleague to review it.</p>}
      </Modal>
      <Confirm open={!!delDoc} title="Remove document?" message={<>Remove <b>{delDoc?.doc_name}</b>? The removal is recorded in the audit trail.</>} danger confirmLabel="Remove"
        onClose={() => setDelDoc(null)} onConfirm={async () => { try { await api.del(`/payments/${id}/documents/${delDoc.id}`); setDelDoc(null); toast.ok('Document removed.'); existing.reload(); } catch (e) { toast.err(e); } }} />
    </div>
  );
}
