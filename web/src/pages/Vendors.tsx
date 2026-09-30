import { useState } from 'react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Badge, Card, Empty, ErrorBox, Field, Icon, Loading, Modal, PageHeader, Tabs, Toggle, useAsync, useDebounced, useToast } from '../components/ui';
import { FormModal } from '../components/forms';
import { fmtDate, fmtDateTime, toTitle } from '../lib/format';

const PARTY = ['VENDOR', 'SUPPLIER', 'CUSTOMER', 'EMPLOYEE', 'STATUTORY', 'LOAN', 'INTER_COMPANY', 'OTHER'];
const ACCT = ['CURRENT', 'SAVINGS', 'CASH_CREDIT', 'OVERDRAFT', 'ESCROW'];
const emptyV = { vendor_code: '', name: '', party_type: 'VENDOR', pan: '', gstin: '', address: '', contact_person: '', email: '', mobile: '', msme_status: 'NOT_MSME', tds_section: '', gst_registration: 'REGISTERED', is_active: true, bank_name: '', bank_account_number: '', ifsc: '', account_type: 'CURRENT' };

export default function Vendors() {
  const { can } = useAuth(); const toast = useToast(); const [tab, setTab] = useState('list'); const [q, setQ] = useState(''); const dq = useDebounced(q);
  const list = useAsync(() => api.get('/vendors', { q: dq }), [dq]);
  const reqs = useAsync(() => api.get('/vendors/bank-requests', { status: 'PENDING' }), []);
  const meta = useAsync(() => api.get('/payments/meta'), []);
  const [edit, setEdit] = useState<any>(null); const [bankFor, setBankFor] = useState<any>(null); const [hist, setHist] = useState<any>(null); const [decide, setDecide] = useState<any>(null);
  const manage = can('vendor.manage'); const auth = can('vendor.authorise_bank');
  const rows = (list.data as any[]) ?? []; const pend = (reqs.data as any[]) ?? [];
  return (
    <div>
      <PageHeader title="Vendors & Parties" subtitle="Payee master. Bank-detail changes need a separate authoriser before any payment can use them."
        actions={manage && <button className="btn-primary" onClick={() => setEdit({ ...emptyV })}><Icon name="plus" className="h-4 w-4" />Add vendor / party</button>} />
      <Tabs value={tab} onChange={setTab} tabs={[{ key: 'list', label: 'All vendors', count: rows.length }, { key: 'pending', label: 'Bank changes awaiting authorisation', count: pend.length }]} />
      <div className="mt-4">
        {tab === 'list' && (
          <Card pad={false}>
            <div className="border-b border-slate-100 p-3"><div className="relative max-w-md"><Icon name="search" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><input className="input !pl-9" placeholder="Search name, code, PAN, GSTIN…" value={q} onChange={(e) => setQ(e.target.value)} /></div></div>
            {list.loading && !list.data ? <Loading /> : list.error ? <div className="p-4"><ErrorBox error={list.error} retry={list.reload} /></div> : rows.length === 0 ? <Empty title="No vendors found" /> : (
              <div className="overflow-x-auto"><table className="w-full min-w-[900px]"><thead><tr><th className="th">Code</th><th className="th">Name</th><th className="th">Type</th><th className="th">PAN / GSTIN</th><th className="th">Bank</th><th className="th">Bank status</th><th className="th">MSME</th><th className="th"></th></tr></thead>
                <tbody className="divide-y divide-slate-100">{rows.map((v) => (
                  <tr key={v.id} className="hover:bg-slate-50/70"><td className="td font-mono text-xs">{v.vendor_code}</td><td className="td"><div className="font-medium text-slate-800">{v.name}</div>{!v.is_active && <Badge>Inactive</Badge>}</td><td className="td text-xs">{toTitle(v.party_type)}</td>
                    <td className="td text-xs"><div>{v.pan ?? '—'}</div><div className="text-slate-400">{v.gstin ?? ''}</div></td><td className="td text-xs"><div>{v.bank_name ?? '—'}</div><div className="font-mono text-slate-400">{v.bank_account_masked} · {v.ifsc}</div></td>
                    <td className="td">{v.bank_change_pending ? <Badge tone="amber" dot>Change pending</Badge> : v.bank_authorised ? <Badge tone="green" dot>Authorised</Badge> : <Badge tone="red" dot>Not authorised</Badge>}</td><td className="td text-xs">{v.msme_status === 'NOT_MSME' ? '—' : toTitle(v.msme_status)}</td>
                    <td className="td whitespace-nowrap text-right text-xs">{manage && <button className="link" onClick={() => setEdit({ ...emptyV, ...Object.fromEntries(Object.entries(v).map(([k, x]) => [k, x ?? ''])), bank_account_number: '', is_active: v.is_active, _id: v.id })}>Edit</button>}
                      {manage && <button className="ml-3 link" onClick={() => setBankFor(v)}>Change bank</button>}<button className="ml-3 link" onClick={async () => { try { setHist({ v, rows: await api.get(`/vendors/${v.id}/history`) }); } catch (e) { toast.err(e); } }}>History</button></td></tr>))}</tbody></table></div>)}
          </Card>)}
        {tab === 'pending' && (
          <Card pad={false}>{pend.length === 0 ? <Empty title="No bank changes awaiting authorisation" hint="When a maker adds or changes a vendor’s bank details, a different user must authorise it here." /> : (
            <div className="overflow-x-auto"><table className="w-full min-w-[820px]"><thead><tr><th className="th">Vendor</th><th className="th">Current bank</th><th className="th">Requested bank</th><th className="th">Reason</th><th className="th">Requested by</th><th className="th"></th></tr></thead>
              <tbody className="divide-y divide-slate-100">{pend.map((r) => (
                <tr key={r.id}><td className="td font-medium">{r.vendor}<div className="font-mono text-[11px] text-slate-400">{r.vendor_code}</div></td><td className="td text-xs">{r.old_bank_name ? <>{r.old_bank_name}<div className="font-mono text-slate-400">XXXX {r.old_last4} · {r.old_ifsc}</div></> : <span className="text-slate-400">None</span>}</td>
                  <td className="td text-xs"><b>{r.new_bank_name}</b><div className="font-mono text-slate-500">XXXX {r.new_account_last4} · {r.new_ifsc}</div><div className="text-slate-400">{toTitle(r.new_account_type)}</div></td><td className="td max-w-xs text-xs">{r.reason}</td><td className="td text-xs">{r.requested_by_name}<div className="text-slate-400">{fmtDateTime(r.requested_at)}</div></td>
                  <td className="td text-right">{auth && <button className="btn-primary btn-sm" onClick={() => setDecide(r)}>Review</button>}</td></tr>))}</tbody></table></div>)}</Card>)}
      </div>

      {edit && <VendorForm init={edit} meta={meta.data as any} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); list.reload(); reqs.reload(); }} />}
      {bankFor && <BankChange v={bankFor} onClose={() => setBankFor(null)} onSaved={() => { setBankFor(null); list.reload(); reqs.reload(); setTab('pending'); }} />}
      {decide && <Decide r={decide} onClose={() => setDecide(null)} onDone={() => { setDecide(null); list.reload(); reqs.reload(); }} />}
      <Modal open={!!hist} onClose={() => setHist(null)} title={`Change history — ${hist?.v.name}`} size="lg">
        {hist?.rows.length === 0 ? <p className="text-sm text-slate-500">No changes recorded.</p> : <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr><th className="th">When</th><th className="th">Change</th><th className="th">Old</th><th className="th">New</th><th className="th">By</th></tr></thead><tbody className="divide-y divide-slate-100">{hist?.rows.map((h: any) => <tr key={h.id}><td className="td whitespace-nowrap text-xs">{fmtDateTime(h.changed_at ?? h.at)}</td><td className="td text-xs">{toTitle(h.change_type)}{h.field_name ? ` · ${h.field_name}` : ''}{h.remarks && <div className="text-slate-400">{h.remarks}</div>}</td><td className="td text-xs">{h.old_value ?? '—'}</td><td className="td text-xs">{h.new_value ?? '—'}</td><td className="td text-xs">{h.changed_by_name}</td></tr>)}</tbody></table></div>}
      </Modal>
    </div>
  );
}

function VendorForm({ init, meta, onClose, onSaved }: { init: any; meta: any; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState<any>(init); const isNew = !init._id; const set = (k: string, v: any) => setF((x: any) => ({ ...x, [k]: v }));
  const tds = meta?.tdsSections ?? [];
  return (
    <FormModal open onClose={onClose} title={isNew ? 'Add vendor / party' : `Edit ${init.name}`} size="lg" onSubmit={async () => {
      const b: any = { ...f }; delete b._id; for (const k of Object.keys(b)) if (b[k] === '') b[k] = null; if (!isNew) { delete b.bank_name; delete b.bank_account_number; delete b.ifsc; delete b.account_type; }
      if (b.bank_account_number === null) delete b.bank_account_number;
      if (isNew) await api.post('/vendors', b); else await api.put(`/vendors/${init._id}`, b); onSaved(); return isNew ? 'Vendor added. Bank details need authorisation before use.' : 'Vendor updated.';
    }}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Vendor name" required className="sm:col-span-2"><input className="input" value={f.name} onChange={(e) => set('name', e.target.value)} /></Field>
        <Field label="Vendor code" hint="Leave blank to auto-generate."><input className="input" value={f.vendor_code} onChange={(e) => set('vendor_code', e.target.value)} /></Field>
        <Field label="Party type"><select className="input" value={f.party_type} onChange={(e) => set('party_type', e.target.value)}>{PARTY.map((x) => <option key={x} value={x}>{toTitle(x)}</option>)}</select></Field>
        <Field label="PAN"><input className="input uppercase" maxLength={10} value={f.pan} onChange={(e) => set('pan', e.target.value.toUpperCase())} /></Field>
        <Field label="GSTIN"><input className="input uppercase" maxLength={15} value={f.gstin} onChange={(e) => set('gstin', e.target.value.toUpperCase())} /></Field>
        <Field label="GST registration"><select className="input" value={f.gst_registration} onChange={(e) => set('gst_registration', e.target.value)}>{['REGISTERED', 'UNREGISTERED', 'COMPOSITION', 'SEZ', 'OVERSEAS'].map((x) => <option key={x} value={x}>{toTitle(x)}</option>)}</select></Field>
        <Field label="Default TDS section"><select className="input" value={f.tds_section} onChange={(e) => set('tds_section', e.target.value)}><option value="">—</option>{tds.map((t: any) => <option key={t.code} value={t.code}>{t.code} · {t.name}</option>)}</select></Field>
        <Field label="MSME status"><select className="input" value={f.msme_status} onChange={(e) => set('msme_status', e.target.value)}>{['NOT_MSME', 'MICRO', 'SMALL', 'MEDIUM'].map((x) => <option key={x} value={x}>{toTitle(x)}</option>)}</select></Field>
        <Field label="Contact person"><input className="input" value={f.contact_person} onChange={(e) => set('contact_person', e.target.value)} /></Field>
        <Field label="Mobile"><input className="input" value={f.mobile} onChange={(e) => set('mobile', e.target.value)} /></Field>
        <Field label="E-mail" className="sm:col-span-2"><input className="input" value={f.email} onChange={(e) => set('email', e.target.value)} /></Field>
        <Field label="Address" className="sm:col-span-2"><textarea className="input" rows={2} value={f.address} onChange={(e) => set('address', e.target.value)} /></Field>
        {isNew ? (<div className="rounded-lg border border-navy-100 bg-navy-50/50 p-3 sm:col-span-2"><div className="mb-2 text-xs font-semibold uppercase tracking-wide text-navy-600">Bank details (require authorisation)</div>
          <div className="grid gap-3 sm:grid-cols-2"><Field label="Bank name"><input className="input" value={f.bank_name} onChange={(e) => set('bank_name', e.target.value)} /></Field><Field label="Account type"><select className="input" value={f.account_type} onChange={(e) => set('account_type', e.target.value)}>{ACCT.map((x) => <option key={x} value={x}>{toTitle(x)}</option>)}</select></Field>
            <Field label="Account number"><input className="input font-mono" inputMode="numeric" value={f.bank_account_number} onChange={(e) => set('bank_account_number', e.target.value.replace(/\D/g, ''))} /></Field><Field label="IFSC"><input className="input font-mono uppercase" maxLength={11} value={f.ifsc} onChange={(e) => set('ifsc', e.target.value.toUpperCase())} /></Field></div></div>)
          : <p className="text-xs text-slate-500 sm:col-span-2">To change bank details use <b>Change bank</b> — it goes for separate authorisation.</p>}
        <div className="sm:col-span-2"><Toggle checked={f.is_active} onChange={(v) => set('is_active', v)} label="Active" /></div>
      </div>
    </FormModal>
  );
}
function BankChange({ v, onClose, onSaved }: { v: any; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState<any>({ bank_name: '', account_number: '', ifsc: '', account_type: 'CURRENT', reason: '' }); const set = (k: string, x: any) => setF((p: any) => ({ ...p, [k]: x }));
  return (
    <FormModal open onClose={onClose} title={`Change bank details — ${v.name}`} submitLabel="Request change" onSubmit={async () => { await api.post(`/vendors/${v.id}/bank-change`, f); onSaved(); return 'Change requested. A different user must authorise it before payments can use it.'; }}>
      <div className="rounded-lg bg-slate-50 p-3 text-xs text-slate-600">Current: <b>{v.bank_name ?? '—'}</b> · {v.bank_account_masked} · {v.ifsc}</div>
      <div className="grid gap-3 sm:grid-cols-2"><Field label="New bank name" required><input className="input" value={f.bank_name} onChange={(e) => set('bank_name', e.target.value)} /></Field><Field label="Account type"><select className="input" value={f.account_type} onChange={(e) => set('account_type', e.target.value)}>{ACCT.map((x) => <option key={x} value={x}>{toTitle(x)}</option>)}</select></Field>
        <Field label="New account number" required><input className="input font-mono" inputMode="numeric" value={f.account_number} onChange={(e) => set('account_number', e.target.value.replace(/\D/g, ''))} /></Field><Field label="IFSC" required><input className="input font-mono uppercase" maxLength={11} value={f.ifsc} onChange={(e) => set('ifsc', e.target.value.toUpperCase())} /></Field></div>
      <Field label="Reason (with proof reference)" required><textarea className="input" rows={2} value={f.reason} onChange={(e) => set('reason', e.target.value)} placeholder="e.g. Vendor letter dated … verified by call-back to registered number." /></Field>
    </FormModal>
  );
}
function Decide({ r, onClose, onDone }: { r: any; onClose: () => void; onDone: () => void }) {
  const [remarks, setRemarks] = useState(''); const toast = useToast(); const [busy, setBusy] = useState(false);
  const go = async (approve: boolean) => { setBusy(true); try { await api.post(`/vendors/bank-requests/${r.id}/decision`, { approve, remarks }); toast.ok(approve ? 'Bank details authorised.' : 'Change rejected.'); onDone(); } catch (e) { toast.err(e); } finally { setBusy(false); } };
  return (
    <Modal open onClose={onClose} title={`Authorise bank details — ${r.vendor}`} footer={<><button className="btn-outline" onClick={onClose}>Cancel</button><button disabled={busy} className="btn-red" onClick={() => go(false)}>Reject</button><button disabled={busy} className="btn-green" onClick={() => go(true)}>Authorise</button></>}>
      <div className="grid gap-3 sm:grid-cols-2"><div className="rounded-lg bg-slate-50 p-3 text-sm"><div className="text-xs font-semibold uppercase text-slate-400">Current</div>{r.old_bank_name ?? '—'}<div className="font-mono text-xs">{r.old_last4 ? `XXXX ${r.old_last4}` : ''} {r.old_ifsc}</div></div>
        <div className="rounded-lg bg-emerald-50 p-3 text-sm"><div className="text-xs font-semibold uppercase text-emerald-600">Requested</div>{r.new_bank_name}<div className="font-mono text-xs">XXXX {r.new_account_last4} {r.new_ifsc}</div></div></div>
      <p className="mt-3 text-sm text-slate-600"><b>Reason:</b> {r.reason}</p><p className="text-xs text-slate-400">Requested by {r.requested_by_name} on {fmtDate(r.requested_at)}. You cannot authorise your own request.</p>
      <Field className="mt-3" label="Remarks"><textarea className="input" rows={2} value={remarks} onChange={(e) => setRemarks(e.target.value)} /></Field>
    </Modal>
  );
}
