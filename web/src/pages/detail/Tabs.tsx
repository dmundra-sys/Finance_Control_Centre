import { useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import { api, download, errMsg } from '../../lib/api';
import { Badge, Btn, Card, Empty, Field, Icon, KV, Loading, ErrorBox, StatusBadge, Toggle, useAsync, useToast } from '../../components/ui';
import { bytes, fmtDate, fmtDateTime, money, toTitle } from '../../lib/format';

const Row = ({ children, wide }: { children: React.ReactNode; wide?: boolean }) => <div className={clsx('grid grid-cols-2 gap-x-6 gap-y-4', wide ? 'sm:grid-cols-3 lg:grid-cols-4' : 'xl:grid-cols-3')}>{children}</div>;

// ------------------------------------------------------------------ overview
export function Overview({ data, reveal }: { data: any; reveal: () => void }) {
  const p = data.payment; const v = data.vendor;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card title="Payment details"><Row>
        <KV label="Company">{p.company_name}</KV><KV label="Paying bank">{p.bank_name} · XXXX {p.account_last4}</KV><KV label="Payment type">{toTitle(p.payment_type)}</KV><KV label="Payment mode">{p.payment_mode}</KV>
        <KV label="Invoice no.">{p.invoice_number}</KV><KV label="Invoice date">{fmtDate(p.invoice_date)}</KV><KV label="PO number">{p.po_number}</KV><KV label="GRN reference">{p.grn_reference}</KV>
        <KV label="Department">{p.department}</KV><KV label="Due date">{fmtDate(p.due_date)}</KV><KV label="Created by">{p.created_by_name}</KV><KV label="Created on">{fmtDateTime(p.created_at)}</KV>
      </Row>
        {(p.purpose || p.remarks) && <div className="mt-4 space-y-2 border-t border-slate-100 pt-3 text-sm">{p.purpose && <div><span className="text-xs font-medium uppercase tracking-wide text-slate-400">Purpose</span><div>{p.purpose}</div></div>}{p.remarks && <div><span className="text-xs font-medium uppercase tracking-wide text-slate-400">Remarks</span><div>{p.remarks}</div></div>}</div>}
        {p.duplicate_override_reason && <div className="mt-4 rounded-lg border border-orange-300 bg-orange-50 p-3 text-xs text-orange-900"><b>Duplicate warning overridden</b> (matched {p.duplicate_of}): {p.duplicate_override_reason}</div>}
      </Card>
      <div className="space-y-4">
        <Card title="Amount"><dl className="space-y-1.5 text-sm">
          {[['Invoice / payment amount', p.gross_amount], ['GST (included)', p.gst_amount, true], ['TDS deducted', -p.tds_amount], ['Other deduction', -p.other_deduction], ['Advance adjustment', -p.advance_adjustment]].map(([l, a, info]: any) => (
            <div key={l} className={clsx('flex justify-between', info && 'text-slate-400')}><dt>{l}</dt><dd className="num">{Number(a) < 0 ? '−' + money(-a, true) : money(Math.abs(a), true)}</dd></div>))}
          <div className="flex justify-between border-t border-slate-200 pt-2 text-base font-bold text-navy-900"><dt>Net payable</dt><dd className="num">{money(p.net_payable, true)}</dd></div></dl></Card>
        <Card title="Beneficiary (payee)"><Row>
          <KV label="Vendor / party">{v?.name} <span className="text-xs text-slate-400">({v?.vendor_code})</span></KV><KV label="PAN">{v?.pan}</KV><KV label="GSTIN">{v?.gstin}</KV>
          <KV label="Bank">{p.beneficiary_bank_name ?? v?.bank_name}</KV><KV label="Account no." mono>{p.beneficiary_account_masked ?? v?.bank_account_masked}{data.can_reveal_account && <button className="ml-2 text-xs font-semibold text-navy-600 hover:underline" onClick={reveal}>Reveal</button>}</KV><KV label="IFSC" mono>{p.beneficiary_ifsc ?? v?.ifsc}</KV>
        </Row></Card>
      </div>
      {data.items.length > 0 && <Card title="Line items" pad={false} className="lg:col-span-2"><div className="overflow-x-auto"><table className="w-full"><thead><tr><th className="th">#</th><th className="th">Description</th><th className="th">HSN/SAC</th><th className="th text-right">Qty</th><th className="th text-right">Rate</th><th className="th text-right">Amount</th></tr></thead>
        <tbody className="divide-y divide-slate-100">{data.items.map((i: any) => <tr key={i.id}><td className="td">{i.line_no}</td><td className="td">{i.description}</td><td className="td">{i.hsn_sac ?? '—'}</td><td className="td num text-right">{i.quantity}</td><td className="td num text-right">{money(i.rate)}</td><td className="td num text-right">{money(i.amount)}</td></tr>)}</tbody></table></div></Card>}
    </div>
  );
}

// ------------------------------------------------------------------ documents
export function Documents({ data, meta, canUpload, canDelete, reload }: { data: any; meta: any; canUpload: boolean; canDelete: boolean; reload: () => void }) {
  const toast = useToast(); const ref = useRef<HTMLInputElement>(null); const [type, setType] = useState('Invoice'); const [busy, setBusy] = useState(false); const [replace, setReplace] = useState<any>(null);
  const groups: Record<string, any[]> = {}; data.documents.forEach((d: any) => { (groups[d.group_id] ??= []).push(d); });
  async function up(file: File) {
    setBusy(true);
    try { const fd = new FormData(); fd.append('file', file); fd.append('doc_type', replace?.doc_type ?? type); if (replace) { fd.append('replaces_id', String(replace.id)); fd.append('doc_name', replace.doc_name); } await api.upload(`/payments/${data.payment.id}/documents`, fd); toast.ok(replace ? 'New version uploaded.' : 'Document uploaded.'); setReplace(null); reload(); }
    catch (e) { toast.err(e); } finally { setBusy(false); }
  }
  const [vid, setVid] = useState<number | null>(null);
  return (
    <Card title={`Documents (${data.documents.filter((d: any) => d.status === 'ACTIVE').length} active)`} pad={false} actions={canUpload && <div className="flex items-center gap-2"><select className="input !w-auto !py-1.5 text-xs" value={type} onChange={(e) => setType(e.target.value)}>{meta.docTypes.map((t: string) => <option key={t}>{t}</option>)}</select>
      <Btn busy={busy} className="btn-primary btn-sm" onClick={() => { setReplace(null); ref.current?.click(); }}><Icon name="upload" className="h-3.5 w-3.5" />Upload</Btn></div>}>
      <input ref={ref} type="file" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) up(f); e.target.value = ''; }} />
      {data.documents.length === 0 ? <Empty title="No documents yet" hint="Upload the invoice and supporting documents." /> : (
        <div className="overflow-x-auto"><table className="w-full min-w-[640px]"><thead><tr><th className="th">Document</th><th className="th">Type</th><th className="th">Ver.</th><th className="th">Size</th><th className="th">Uploaded by</th><th className="th">On</th><th className="th"></th></tr></thead>
          <tbody className="divide-y divide-slate-100">{Object.values(groups).flatMap((g) => g.map((d) => (
            <tr key={d.id} className={d.status !== 'ACTIVE' ? 'bg-slate-50/60 text-slate-400' : ''}>
              <td className="td"><div className="flex items-center gap-2"><Icon name="file" className="h-4 w-4 shrink-0 text-slate-400" /><div className="min-w-0"><div className="truncate font-medium text-slate-800">{d.doc_name}</div><div className="truncate text-[11px] text-slate-400" title={d.sha256}>SHA-256 {d.sha256?.slice(0, 12)}…</div></div></div></td>
              <td className="td">{d.doc_type}</td><td className="td">v{d.version} {d.status !== 'ACTIVE' && <Badge>{d.status === 'SUPERSEDED' ? 'Old' : d.status}</Badge>}</td><td className="td whitespace-nowrap">{bytes(d.size_bytes)}</td><td className="td">{d.uploaded_by_name}</td><td className="td whitespace-nowrap">{fmtDateTime(d.uploaded_at)}</td>
              <td className="td whitespace-nowrap text-right"><button className="link text-xs" onClick={async () => { try { await download(`/api/documents/${d.id}/download`, d.original_filename); } catch (e) { toast.err(e); } }}>Download</button>
                {canUpload && d.status === 'ACTIVE' && <button className="ml-3 text-xs font-semibold text-slate-500 hover:underline" onClick={() => { setReplace(d); ref.current?.click(); }}>New version</button>}
                {canDelete && d.status === 'ACTIVE' && <button className="ml-3 text-xs font-semibold text-red-600 hover:underline" disabled={vid === d.id} onClick={async () => { if (!confirm(`Remove ${d.doc_name}?`)) return; setVid(d.id); try { await api.del(`/payments/${data.payment.id}/documents/${d.id}`); toast.ok('Document removed.'); reload(); } catch (e) { toast.err(e); } finally { setVid(null); } }}>Remove</button>}</td>
            </tr>)))}</tbody></table></div>)}
    </Card>
  );
}

// ------------------------------------------------------------------ approvals
export function Approvals({ data }: { data: any }) {
  const ap = data.approval_progress;
  const tone = (d: string) => (d === 'APPROVED' ? 'green' : d === 'REJECTED' ? 'red' : 'amber');
  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2">
        <Card title="B approval requirement">
          <p className="mb-3 text-xs text-slate-500">Approval matrix: <b>{ap.matrix ?? '—'}</b></p>
          {ap.b.length === 0 ? <p className="text-sm text-slate-500">Not yet submitted.</p> : ap.b.map((l: any) => (
            <div key={l.level} className="mb-2 flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2 text-sm"><div><div className="font-medium">{l.label}{l.senior && <Badge tone="purple">Senior</Badge>}</div><div className="text-xs text-slate-400">{l.done.map((x: any) => x.name).join(', ') || 'Awaiting'}</div></div><Badge tone={l.done.length >= l.required ? 'green' : 'amber'}>{l.done.length}/{l.required}</Badge></div>))}
        </Card>
        <Card title="D final approval requirement"><div className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2 text-sm"><div><div className="font-medium">Authorised bank approver</div><div className="text-xs text-slate-400">{ap.d.done.map((x: any) => x.name).join(', ') || 'Awaiting'}</div></div><Badge tone={ap.d.done.length >= ap.d.required ? 'green' : 'amber'}>{ap.d.done.length}/{ap.d.required}</Badge></div></Card>
      </div>
      <Card title="Approval history" pad={false}>
        {data.approvals.length === 0 ? <Empty title="No decisions recorded yet" /> : <div className="overflow-x-auto"><table className="w-full min-w-[640px]"><thead><tr><th className="th">Stage</th><th className="th">Level</th><th className="th">Approver</th><th className="th">Decision</th><th className="th">Reason / remarks</th><th className="th">When</th></tr></thead>
          <tbody className="divide-y divide-slate-100">{data.approvals.map((a: any) => <tr key={a.id}><td className="td font-semibold">{a.stage}</td><td className="td">{a.level_label}{a.stage === 'B' && <div className="text-[11px] text-slate-400">Round {a.round_no}</div>}</td><td className="td">{a.approver_name}</td>
            <td className="td"><Badge tone={tone(a.decision)}>{a.decision}</Badge>{a.return_to_stage && <div className="mt-0.5 text-[11px] text-slate-400">→ {a.return_to_stage}</div>}</td><td className="td max-w-sm">{[a.reason, a.remarks].filter(Boolean).join(' — ') || '—'}</td><td className="td whitespace-nowrap">{fmtDateTime(a.decided_at)}</td></tr>)}</tbody></table></div>}
      </Card>
    </div>
  );
}

export function Queries({ data }: { data: any }) {
  return (
    <div className="space-y-4">
      <Card title="Queries & returns" pad={false}>
        {data.queries.length === 0 ? <Empty title="No queries raised" hint="Queries from B, C or D appear here." /> : <ul className="divide-y divide-slate-100">{data.queries.map((q: any) => (
          <li key={q.id} className="p-4"><div className="flex flex-wrap items-center gap-2"><Badge tone={q.status === 'OPEN' ? 'red' : 'green'}>{q.status}</Badge><span className="text-sm font-semibold">From {q.raised_by_stage} · {q.raised_by_name}</span><span className="text-xs text-slate-400">{fmtDateTime(q.raised_at)} · v{q.version_no}</span></div>
            <p className="mt-1.5 text-sm">{q.reason}</p>{q.remarks && <p className="text-sm text-slate-500">{q.remarks}</p>}
            {(q.required_document || q.required_correction) && <p className="mt-1 text-xs text-slate-500">{q.required_document && <>Document needed: <b>{q.required_document}</b> </>}{q.required_correction && <>Correction needed: <b>{q.required_correction}</b></>}</p>}
            {q.status !== 'OPEN' && <p className="mt-2 rounded bg-emerald-50 px-2 py-1 text-xs text-emerald-800">Resolved by {q.resolved_by_name} on {fmtDateTime(q.resolved_at)}{q.resolution_remarks && ` — ${q.resolution_remarks}`}</p>}</li>))}</ul>}
      </Card>
      <Card title="Resubmissions & amendments" pad={false}>
        {data.resubmissions.length === 0 ? <Empty title="Not resubmitted" /> : <div className="overflow-x-auto"><table className="w-full min-w-[560px]"><thead><tr><th className="th">Version</th><th className="th">Type</th><th className="th">By</th><th className="th">To</th><th className="th">Remarks</th><th className="th">When</th></tr></thead>
          <tbody className="divide-y divide-slate-100">{data.resubmissions.map((r: any) => <tr key={r.id}><td className="td">v{r.from_version} → v{r.to_version}</td><td className="td"><Badge tone={r.is_amendment ? 'orange' : 'blue'}>{r.is_amendment ? 'Amendment' : 'Resubmission'}</Badge></td><td className="td">{r.submitted_by_name}</td><td className="td">{r.to_stage}</td>
            <td className="td max-w-sm">{r.remarks}{r.changes && Object.keys(r.changes).length > 0 && <div className="mt-1 text-[11px] text-slate-500">{Object.entries(r.changes).map(([k, c]: any) => <div key={k}>{toTitle(k)}: {String(c.from ?? '—')} → <b>{String(c.to ?? '—')}</b></div>)}</div>}</td><td className="td whitespace-nowrap">{fmtDateTime(r.submitted_at)}</td></tr>)}</tbody></table></div>}
      </Card>
    </div>
  );
}

export function Verification({ data, meta }: { data: any; meta: any }) {
  const labels = Object.fromEntries(meta.cChecklist as [string, string][]);
  return (
    <Card title="C — original document verification" pad={false}>
      {data.verifications.length === 0 ? <Empty title="Not verified yet" hint="C verifies the ORIGINAL invoice and supporting documents after B approval." /> : <ul className="divide-y divide-slate-100">{data.verifications.map((v: any) => (
        <li key={v.id} className="p-4"><div className="flex flex-wrap items-center gap-2"><Badge tone={v.result === 'VERIFIED' ? 'green' : 'red'}>{v.result === 'VERIFIED' ? 'Verified' : 'Discrepancy'}</Badge><span className="text-sm font-semibold">{v.verifier_name}</span><span className="text-xs text-slate-400">v{v.version_no} · {fmtDateTime(v.verified_at)}</span></div>
          {v.remarks && <p className="mt-1.5 text-sm">{v.remarks}</p>}
          <div className="mt-2 flex flex-wrap gap-1.5">{Object.entries(v.checklist ?? {}).map(([k, ok]) => <span key={k} className={clsx('rounded-full px-2 py-0.5 text-[11px]', ok ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500')}>{ok ? '✓' : '○'} {labels[k] ?? k}</span>)}</div></li>))}</ul>}
    </Card>
  );
}

// ------------------------------------------------------------------ accounting
export function Accounting({ data, meta, editable, reload, onVerify }: { data: any; meta: any; editable: boolean; reload: () => void; onVerify: () => void }) {
  const toast = useToast(); const a = data.accounting; const [f, setF] = useState<any>({}); const [busy, setBusy] = useState(false); const [dirty, setDirty] = useState(false);
  useEffect(() => { setF(a ? { ...a } : {}); setDirty(false); }, [a?.updated_at]);
  const cl = data.control as any;
  const set = (k: string, v: any) => { setF((x: any) => ({ ...x, [k]: v })); setDirty(true); };
  const sel = (k: string, list: any[], label: string, req = false) => (
    <Field label={label} required={req}><select className="input" disabled={!editable} value={f[k] ?? ''} onChange={(e) => set(k, e.target.value)}><option value="">—</option>{list.map((x) => <option key={x.code} value={x.code}>{x.code} · {x.name}</option>)}{f[k] && !list.find((x) => x.code === f[k]) && <option value={f[k]}>{f[k]}</option>}</select></Field>);
  const num = (k: string, label: string) => <Field label={label}><input type="number" step="0.01" className="input num" disabled={!editable} value={f[k] ?? ''} onChange={(e) => set(k, e.target.value)} /></Field>;
  async function save() {
    setBusy(true);
    try { const b: any = {}; for (const k of ['ledger_account', 'cost_centre', 'department', 'project', 'gst_treatment', 'tds_section', 'voucher_no', 'erp_reference', 'accounting_date']) b[k] = f[k] || null;
      for (const k of ['tds_amount', 'gst_amount', 'basic_amount', 'other_deductions', 'advance_adjustment', 'net_payable']) if (f[k] !== '' && f[k] != null) b[k] = Number(f[k]);
      b.vendor_ledger_checked = !!f.control_flags?.vendor_ledger_checked; b.debit_credit_note_checked = !!f.control_flags?.debit_credit_note_checked;
      await api.put(`/payments/${data.payment.id}/accounting`, b); toast.ok('Accounting details saved.'); setDirty(false); reload(); } catch (e) { toast.err(e); } finally { setBusy(false); }
  }
  if (!a && !editable) return <Card title="Accounting verification"><Empty title="Accounting has not started" hint="It opens after C verifies the original documents." /></Card>;
  const flags = f.control_flags ?? {};
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card className="lg:col-span-2" title="Accounting treatment" actions={a?.verified ? <Badge tone="green" dot>Verified by {a.verified_by_name}</Badge> : <Badge tone="amber" dot>Not yet verified</Badge>}>
        <div className="grid gap-3 sm:grid-cols-2">
          {sel('ledger_account', meta.ledgers, 'Ledger account / GL code', true)}{sel('cost_centre', meta.costCentres, 'Cost centre', true)}{sel('department', meta.departments.map((d: any) => ({ code: d.name, name: '' })), 'Department', true)}{sel('project', meta.projects, 'Project', true)}
          {sel('gst_treatment', meta.gstTreatments, 'GST treatment', true)}{sel('tds_section', meta.tdsSections, 'TDS section', true)}
          {num('basic_amount', 'Basic amount (₹)')}{num('gst_amount', 'GST amount (₹)')}{num('tds_amount', 'TDS amount (₹)')}{num('other_deductions', 'Other deductions (₹)')}{num('advance_adjustment', 'Advance adjustment (₹)')}{num('net_payable', 'Net payable (₹)')}
          <Field label="Voucher number" required><input className="input" disabled={!editable} value={f.voucher_no ?? ''} onChange={(e) => set('voucher_no', e.target.value)} /></Field>
          <Field label="Accounting date"><input type="date" className="input" disabled={!editable} value={(f.accounting_date ?? '').slice(0, 10)} onChange={(e) => set('accounting_date', e.target.value)} /></Field>
          <Field label="ERP reference" className="sm:col-span-2"><input className="input" disabled={!editable} value={f.erp_reference ?? ''} onChange={(e) => set('erp_reference', e.target.value)} /></Field>
        </div>
        <div className="mt-4 grid gap-2 rounded-lg border border-slate-200 p-3 sm:grid-cols-2">
          <Toggle disabled={!editable} checked={!!flags.vendor_ledger_checked} onChange={(v) => { setF({ ...f, control_flags: { ...flags, vendor_ledger_checked: v } }); setDirty(true); }} label="Vendor ledger checked" />
          <Toggle disabled={!editable} checked={!!flags.debit_credit_note_checked} onChange={(v) => { setF({ ...f, control_flags: { ...flags, debit_credit_note_checked: v } }); setDirty(true); }} label="Debit / credit notes considered" />
        </div>
        {editable && <div className="mt-4 flex flex-wrap justify-end gap-2"><Btn busy={busy} className="btn-outline" disabled={!dirty} onClick={save}>Save accounting details</Btn><Btn className="btn-green" disabled={dirty || busy} onClick={onVerify}><Icon name="check" className="h-4 w-4" />Verify accounting</Btn></div>}
        {editable && dirty && <p className="mt-2 text-right text-[11px] text-slate-400">Save your changes before verifying.</p>}
      </Card>
      <Card title="Control checklist">
        {!cl ? <p className="text-sm text-slate-500">Available once original documents are verified.</p> : (
          <ul className="space-y-2">{cl.items.map((i: any) => <li key={i.key} className="flex items-start gap-2 text-sm"><span className={clsx('mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white', i.ok ? 'bg-emerald-500' : 'bg-red-500')}>{i.ok ? '✓' : '!'}</span><span><span className="font-medium text-slate-800">{i.label}</span><span className="block text-xs text-slate-500">{i.message}</span></span></li>)}
            <li className={clsx('mt-3 rounded-lg px-3 py-2 text-xs font-semibold', cl.ready ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-50 text-amber-800')}>{cl.ready ? 'All controls passed — ready for bank initiation.' : 'Bank initiation is blocked until every control passes.'}</li></ul>)}
      </Card>
    </div>
  );
}

// ------------------------------------------------------------------ bank
export function Bank({ data }: { data: any }) {
  const tx = data.bank_transactions;
  const tone = (s: string) => (['PROCESSED', 'RECONCILED', 'APPROVED'].includes(s) ? 'green' : ['FAILED', 'RETURNED', 'REVERSED'].includes(s) ? 'red' : 'amber');
  return (
    <Card title="Bank payment details" pad={false}>
      {tx.length === 0 ? <Empty title="Not initiated on the bank portal" hint="C records the bank reference here after initiating the payment manually on the bank’s website." /> : <ul className="divide-y divide-slate-100">{tx.map((t: any) => (
        <li key={t.id} className="p-4"><div className="mb-3 flex flex-wrap items-center gap-2"><span className="text-sm font-semibold">Attempt {t.seq_no}</span>{t.is_current && <Badge tone="blue">Current</Badge>}<Badge tone={tone(t.bank_status)} dot>{t.bank_status}</Badge></div>
          <Row wide><KV label="Bank">{t.bank_name}</KV><KV label="Portal">{t.bank_portal}</KV><KV label="Mode">{t.payment_mode}</KV><KV label="Amount">{money(t.amount, true)}</KV>
            <KV label="Bank reference" mono>{t.bank_ref_no}</KV><KV label="UTR" mono>{t.utr}</KV><KV label="Bank txn ID" mono>{t.bank_txn_id}</KV><KV label="Initiated by">{t.initiated_by_name}</KV>
            <KV label="Initiated on">{fmtDateTime(t.initiated_at)}</KV><KV label="Actual debit date">{fmtDate(t.actual_debit_date)}</KV><KV label="Actual debit amount">{t.actual_debit_amount != null ? money(t.actual_debit_amount, true) : '—'}</KV><KV label="Beneficiary">{t.beneficiary_name} · XXXX {t.beneficiary_account_last4}</KV>
            {Object.entries(t.mode_details ?? {}).filter(([k]) => k !== 'bank_ref_no').map(([k, v]) => <KV key={k} label={toTitle(k)}>{String(v)}</KV>)}</Row>
          {t.remarks && <p className="mt-3 text-sm text-slate-600">{t.remarks}</p>}</li>))}</ul>}
    </Card>
  );
}

export function Timeline({ data }: { data: any }) {
  return (
    <Card title="Status history" pad={false}>
      <ol className="relative px-6 py-5">
        <span className="absolute bottom-6 left-[31px] top-6 w-px bg-slate-200" />
        {[...data.history].reverse().map((h: any) => (
          <li key={h.id} className="relative mb-5 flex gap-4 last:mb-0"><span className="z-10 mt-1 h-3 w-3 shrink-0 rounded-full border-2 border-white bg-navy-600 ring-2 ring-navy-100" />
            <div className="min-w-0"><div className="text-sm font-semibold text-slate-800">{h.to_label}</div><div className="text-xs text-slate-500">{h.changed_by_name ?? 'System'} · {fmtDateTime(h.at)}</div>{h.remarks && <div className="mt-1 text-sm text-slate-600">{h.remarks}</div>}</div></li>))}
      </ol>
    </Card>
  );
}

export function Versions({ data }: { data: any }) {
  const [sel, setSel] = useState<number | null>(null);
  const v = useAsync(() => (sel ? api.get(`/payments/${data.payment.id}/versions/${sel}`) : Promise.resolve(null)), [sel]);
  const snap = (v.data as any)?.snapshot;
  return (
    <Card title="Version history" pad={false}>
      <div className="overflow-x-auto"><table className="w-full min-w-[520px]"><thead><tr><th className="th">Version</th><th className="th">Reason</th><th className="th">By</th><th className="th">When</th><th className="th"></th></tr></thead>
        <tbody className="divide-y divide-slate-100">{data.versions.map((x: any) => <tr key={x.version_no} className={sel === x.version_no ? 'bg-navy-50/50' : ''}><td className="td font-semibold">v{x.version_no}{x.version_no === data.payment.version_no && <Badge tone="green">Current</Badge>}</td><td className="td">{toTitle(x.reason)}</td><td className="td">{x.created_by_name}</td><td className="td whitespace-nowrap">{fmtDateTime(x.created_at)}</td><td className="td text-right"><button className="link text-xs" onClick={() => setSel(sel === x.version_no ? null : x.version_no)}>{sel === x.version_no ? 'Hide' : 'View snapshot'}</button></td></tr>)}</tbody></table></div>
      {sel && <div className="border-t border-slate-100 p-4">{v.loading ? <Loading /> : snap ? <Row>{Object.entries(snap).filter(([k, x]) => typeof x !== 'object' && !['id', 'created_by', 'is_demo'].includes(k)).map(([k, x]: any) => <KV key={k} label={toTitle(k)}>{['gross_amount', 'net_payable', 'gst_amount', 'tds_amount', 'other_deduction', 'advance_adjustment'].includes(k) ? money(x, true) : /_at$|_date$/.test(k) ? fmtDate(x) : String(x ?? '—')}</KV>)}</Row> : null}</div>}
    </Card>
  );
}

export function AuditTab({ id }: { id: number }) {
  const a = useAsync(() => api.get(`/payments/${id}/audit`), [id]); const [open, setOpen] = useState<number | null>(null);
  if (a.loading) return <Loading />; if (a.error) return <ErrorBox error={a.error} retry={a.reload} />;
  const rows = a.data as any[];
  return (
    <Card title={`Audit trail (${rows.length} entries)`} pad={false} actions={<span className="text-[11px] text-slate-400"><Icon name="lock" className="mr-1 inline h-3 w-3" />Immutable — hash-chained</span>}>
      <div className="overflow-x-auto"><table className="w-full min-w-[760px]"><thead><tr><th className="th">Date & time</th><th className="th">User</th><th className="th">Action</th><th className="th">Details</th><th className="th">IP</th></tr></thead>
        <tbody className="divide-y divide-slate-100">{rows.map((r) => (
          <tr key={r.id} className="align-top hover:bg-slate-50/60"><td className="td whitespace-nowrap text-xs">{fmtDateTime(r.at)}</td><td className="td text-xs"><div className="font-medium">{r.user_name}</div><div className="text-slate-400">{r.role_code}</div></td>
            <td className="td"><Badge tone={/REJECT|CANCEL|FAIL|OVERRIDE/.test(r.action) ? 'red' : /APPROV|VERIFIED|COMPLETED/.test(r.action) ? 'green' : 'slate'}>{r.action.replace(/_/g, ' ')}</Badge></td>
            <td className="td max-w-md text-sm">{r.remarks}{(r.old_value || r.new_value) && <button className="ml-2 text-[11px] font-semibold text-navy-600 hover:underline" onClick={() => setOpen(open === r.id ? null : r.id)}>{open === r.id ? 'hide' : 'old / new'}</button>}
              {open === r.id && <pre className="mt-2 max-h-52 overflow-auto rounded bg-slate-900 p-2 text-[11px] leading-snug text-slate-100">{JSON.stringify({ old: r.old_value, new: r.new_value }, null, 1)}</pre>}</td><td className="td whitespace-nowrap text-xs text-slate-400">{r.ip}</td></tr>))}</tbody></table></div>
    </Card>
  );
}

export function PdfTab({ id, pa }: { id: number; pa: string }) {
  const [url, setUrl] = useState(''); const [err, setErr] = useState('');
  useEffect(() => { let u = ''; fetch(`/api/payments/${id}/pdf`, { credentials: 'same-origin' }).then(async (r) => { if (!r.ok) throw new Error((await r.json().catch(() => null))?.error ?? 'Could not generate the PDF.'); const b = await r.blob(); u = URL.createObjectURL(b); setUrl(u); }).catch((e) => setErr(errMsg(e))); return () => { if (u) URL.revokeObjectURL(u); }; }, [id]);
  return (
    <Card title="Payment Advice PDF" pad={false} actions={<><a className="btn-outline btn-sm" href={url || undefined} download={`${pa}.pdf`}><Icon name="download" className="h-3.5 w-3.5" />Download</a><a className="btn-outline btn-sm" href={url || undefined} target="_blank" rel="noreferrer"><Icon name="print" className="h-3.5 w-3.5" />Open / print</a></>}>
      {err ? <div className="p-4"><ErrorBox error={err} /></div> : !url ? <Loading text="Generating PDF…" /> : <iframe title="Payment Advice PDF" src={url} className="h-[75vh] w-full rounded-b-xl" />}
    </Card>
  );
}
export { StatusBadge };
