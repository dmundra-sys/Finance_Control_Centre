import { useState } from 'react';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { Badge, Card, Empty, ErrorBox, Field, Icon, Loading, PageHeader, Tabs, Toggle, useAsync, useToast } from '../../components/ui';
import { FormModal } from '../../components/forms';
import { money, toTitle } from '../../lib/format';

// ------------------------------------------------------------------ companies
const blankC = { name: '', short_name: '', cin: '', pan: '', gstin: '', tan: '', address: '', is_active: true, logo_data: null as string | null };
export function Companies() {
  const list = useAsync(() => api.get<any[]>('/companies'), []); const [edit, setEdit] = useState<any>(null);
  return (
    <div>
      <PageHeader title="Companies" subtitle="Group companies that raise Payment Advices. Logos appear on the Payment Advice PDF." actions={<button className="btn-primary" onClick={() => setEdit({ ...blankC })}><Icon name="plus" className="h-4 w-4" />Add company</button>} />
      <Card pad={false}>{list.loading ? <Loading /> : list.error ? <div className="p-4"><ErrorBox error={list.error} retry={list.reload} /></div> : (
        <div className="overflow-x-auto"><table className="w-full min-w-[820px]"><thead><tr><th className="th">Company</th><th className="th">Short</th><th className="th">PAN</th><th className="th">GSTIN</th><th className="th">CIN</th><th className="th">Status</th><th className="th"></th></tr></thead>
          <tbody className="divide-y divide-slate-100">{(list.data as any[]).map((c) => <tr key={c.id} className="hover:bg-slate-50/70"><td className="td font-medium">{c.name}{c.has_logo && <Badge tone="teal">Logo</Badge>}</td><td className="td">{c.short_name}</td><td className="td font-mono text-xs">{c.pan}</td><td className="td font-mono text-xs">{c.gstin}</td><td className="td font-mono text-xs">{c.cin}</td><td className="td">{c.is_active ? <Badge tone="green" dot>Active</Badge> : <Badge>Inactive</Badge>}</td>
            <td className="td text-right"><button className="link text-xs" onClick={() => setEdit({ ...blankC, ...Object.fromEntries(Object.entries(c).map(([k, v]) => [k, v ?? ''])), logo_data: null })}>Edit</button></td></tr>)}</tbody></table></div>)}</Card>
      {edit && <CompanyForm init={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); list.reload(); }} />}
    </div>
  );
}
function CompanyForm({ init, onClose, onSaved }: { init: any; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState<any>(init); const set = (k: string, v: any) => setF((x: any) => ({ ...x, [k]: v })); const toast = useToast();
  return (
    <FormModal open onClose={onClose} title={init.id ? `Edit ${init.name}` : 'Add company'} size="lg" onSubmit={async () => {
      const b: any = { ...f }; delete b.id; delete b.is_demo; delete b.has_logo; for (const k of ['cin', 'pan', 'gstin', 'tan', 'address']) if (b[k] === '') b[k] = null; if (!b.logo_data) delete b.logo_data;
      if (init.id) await api.put(`/companies/${init.id}`, b); else await api.post('/companies', b); onSaved(); return 'Company saved.';
    }}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Legal name" required className="sm:col-span-2"><input className="input" value={f.name} onChange={(e) => set('name', e.target.value)} /></Field>
        <Field label="Short name" required><input className="input uppercase" maxLength={30} value={f.short_name} onChange={(e) => set('short_name', e.target.value.toUpperCase())} /></Field>
        <Field label="PAN"><input className="input font-mono uppercase" maxLength={10} value={f.pan} onChange={(e) => set('pan', e.target.value.toUpperCase())} /></Field>
        <Field label="GSTIN"><input className="input font-mono uppercase" maxLength={15} value={f.gstin} onChange={(e) => set('gstin', e.target.value.toUpperCase())} /></Field>
        <Field label="TAN"><input className="input font-mono uppercase" maxLength={10} value={f.tan} onChange={(e) => set('tan', e.target.value.toUpperCase())} /></Field>
        <Field label="CIN" className="sm:col-span-2"><input className="input font-mono uppercase" value={f.cin} onChange={(e) => set('cin', e.target.value.toUpperCase())} /></Field>
        <Field label="Registered address" className="sm:col-span-2"><textarea className="input" rows={2} value={f.address} onChange={(e) => set('address', e.target.value)} /></Field>
        <Field label="Logo (PNG/JPEG, up to ~200 KB)" className="sm:col-span-2"><input type="file" accept="image/png,image/jpeg" className="text-sm" onChange={(e) => { const file = e.target.files?.[0]; if (!file) return; if (file.size > 200 * 1024) { toast.err('Logo must be under 200 KB.'); e.target.value = ''; return; } const r = new FileReader(); r.onload = () => set('logo_data', r.result); r.readAsDataURL(file); }} />{f.logo_data && <img src={f.logo_data} alt="Logo preview" className="mt-2 h-12" />}</Field>
        <div className="sm:col-span-2"><Toggle checked={f.is_active} onChange={(v) => set('is_active', v)} label="Active" /></div>
      </div>
    </FormModal>
  );
}

// ------------------------------------------------------------------ banks
const blankB = { company_id: '', bank_name: '', account_name: '', account_number: '', ifsc: '', branch: '', account_type: 'CURRENT', bank_portal: '', is_active: true };
export function Banks() {
  const { me } = useAuth(); const toast = useToast();
  const list = useAsync(() => api.get<any[]>('/bank-accounts'), []); const companies = useAsync(() => api.get<any[]>('/companies'), []); const [edit, setEdit] = useState<any>(null); const [shown, setShown] = useState<Record<number, string>>({});
  return (
    <div>
      <PageHeader title="Bank accounts" subtitle="Company bank accounts payments are made from. Account numbers are encrypted and shown masked. Never store internet-banking credentials." actions={<button className="btn-primary" onClick={() => setEdit({ ...blankB })}><Icon name="plus" className="h-4 w-4" />Add bank account</button>} />
      <Card pad={false}>{list.loading ? <Loading /> : list.error ? <div className="p-4"><ErrorBox error={list.error} retry={list.reload} /></div> : (
        <div className="overflow-x-auto"><table className="w-full min-w-[900px]"><thead><tr><th className="th">Company</th><th className="th">Bank / account</th><th className="th">Account no.</th><th className="th">IFSC</th><th className="th">Portal</th><th className="th">Status</th><th className="th"></th></tr></thead>
          <tbody className="divide-y divide-slate-100">{(list.data as any[]).map((b) => (
            <tr key={b.id} className="hover:bg-slate-50/70"><td className="td">{b.company_short}</td><td className="td"><div className="font-medium">{b.bank_name}</div><div className="text-xs text-slate-400">{b.account_name} · {toTitle(b.account_type)}</div></td>
              <td className="td font-mono text-xs">{shown[b.id] ?? b.account_masked}{me!.user.canViewFullAccount && !shown[b.id] && <button className="ml-2 font-sans font-semibold text-navy-600 hover:underline" onClick={async () => { try { const r = await api.post(`/bank-accounts/${b.id}/reveal`); setShown({ ...shown, [b.id]: r.account_number }); setTimeout(() => setShown((s) => { const n = { ...s }; delete n[b.id]; return n; }), 15000); } catch (e) { toast.err(e); } }}>Reveal</button>}</td>
              <td className="td font-mono text-xs">{b.ifsc}</td><td className="td text-xs">{b.bank_portal}</td><td className="td">{b.is_active ? <Badge tone="green" dot>Active</Badge> : <Badge>Inactive</Badge>}</td>
              <td className="td text-right"><button className="link text-xs" onClick={() => setEdit({ ...blankB, ...Object.fromEntries(Object.entries(b).map(([k, v]) => [k, v ?? ''])), account_number: '' })}>Edit</button></td></tr>))}</tbody></table></div>)}</Card>
      {edit && <FormModal open onClose={() => setEdit(null)} title={edit.id ? `Edit ${edit.bank_name}` : 'Add bank account'} size="lg" onSubmit={async () => {
        const b: any = { company_id: +edit.company_id, bank_name: edit.bank_name, account_name: edit.account_name, ifsc: edit.ifsc, branch: edit.branch || null, account_type: edit.account_type, bank_portal: edit.bank_portal || null, is_active: edit.is_active }; if (edit.account_number) b.account_number = edit.account_number;
        if (edit.id) await api.put(`/bank-accounts/${edit.id}`, b); else await api.post('/bank-accounts', b); setEdit(null); list.reload(); return 'Bank account saved.'; }}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Company" required><select className="input" value={edit.company_id} onChange={(e) => setEdit({ ...edit, company_id: e.target.value })}><option value="">Select…</option>{((companies.data as any[]) ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
          <Field label="Bank name" required><input className="input" value={edit.bank_name} onChange={(e) => setEdit({ ...edit, bank_name: e.target.value })} /></Field>
          <Field label="Account name" required className="sm:col-span-2"><input className="input" value={edit.account_name} onChange={(e) => setEdit({ ...edit, account_name: e.target.value })} /></Field>
          <Field label={edit.id ? 'Account number (leave blank to keep)' : 'Account number'} required={!edit.id}><input className="input font-mono" inputMode="numeric" value={edit.account_number} onChange={(e) => setEdit({ ...edit, account_number: e.target.value.replace(/\D/g, '') })} /></Field>
          <Field label="IFSC" required><input className="input font-mono uppercase" maxLength={11} value={edit.ifsc} onChange={(e) => setEdit({ ...edit, ifsc: e.target.value.toUpperCase() })} /></Field>
          <Field label="Branch"><input className="input" value={edit.branch} onChange={(e) => setEdit({ ...edit, branch: e.target.value })} /></Field>
          <Field label="Account type"><select className="input" value={edit.account_type} onChange={(e) => setEdit({ ...edit, account_type: e.target.value })}>{['CURRENT', 'SAVINGS', 'CASH_CREDIT', 'OVERDRAFT', 'ESCROW'].map((x) => <option key={x} value={x}>{toTitle(x)}</option>)}</select></Field>
          <Field label="Bank portal name / URL" hint="Shown to C as a reminder — no credentials." className="sm:col-span-2"><input className="input" value={edit.bank_portal} onChange={(e) => setEdit({ ...edit, bank_portal: e.target.value })} /></Field>
          <div className="sm:col-span-2"><Toggle checked={edit.is_active} onChange={(v) => setEdit({ ...edit, is_active: v })} label="Active" /></div></div></FormModal>}
    </div>
  );
}

// ------------------------------------------------------------------ master lists
const CATS: [string, string][] = [['DEPARTMENT', 'Departments'], ['LEDGER', 'Ledger accounts'], ['COST_CENTRE', 'Cost centres'], ['PROJECT', 'Projects'], ['GST_TREATMENT', 'GST treatments'], ['TDS_SECTION', 'TDS sections']];
export function Lists() {
  const [cat, setCat] = useState('DEPARTMENT'); const list = useAsync(() => api.get<any[]>(`/master-data/${cat}`), [cat]); const [edit, setEdit] = useState<any>(null);
  return (
    <div>
      <PageHeader title="Master lists" subtitle="Drop-down values used on Payment Advices and in accounting." actions={<button className="btn-primary" onClick={() => setEdit({ code: '', name: '', sort_order: 0, is_active: true })}><Icon name="plus" className="h-4 w-4" />Add value</button>} />
      <Tabs tabs={CATS.map(([key, label]) => ({ key, label }))} value={cat} onChange={setCat} />
      <Card className="mt-4" pad={false}>{list.loading ? <Loading /> : list.error ? <div className="p-4"><ErrorBox error={list.error} retry={list.reload} /></div> : (list.data as any[]).length === 0 ? <Empty title="No values yet" /> : (
        <table className="w-full"><thead><tr><th className="th">Code</th><th className="th">Name</th><th className="th">Order</th><th className="th">Status</th><th className="th"></th></tr></thead>
          <tbody className="divide-y divide-slate-100">{(list.data as any[]).map((r) => <tr key={r.id}><td className="td font-mono text-xs">{r.code}</td><td className="td">{r.name}</td><td className="td">{r.sort_order}</td><td className="td">{r.is_active ? <Badge tone="green">Active</Badge> : <Badge>Inactive</Badge>}</td><td className="td text-right"><button className="link text-xs" onClick={() => setEdit(r)}>Edit</button></td></tr>)}</tbody></table>)}</Card>
      {edit && <FormModal open onClose={() => setEdit(null)} title={edit.id ? 'Edit value' : 'Add value'} size="sm" onSubmit={async () => { const b = { code: edit.code, name: edit.name, sort_order: Number(edit.sort_order) || 0, is_active: edit.is_active }; if (edit.id) await api.put(`/master-data/${cat}/${edit.id}`, b); else await api.post(`/master-data/${cat}`, b); setEdit(null); list.reload(); return 'Saved.'; }}>
        <Field label="Code" required><input className="input font-mono uppercase" value={edit.code} onChange={(e) => setEdit({ ...edit, code: e.target.value })} /></Field><Field label="Name" required><input className="input" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
        <Field label="Sort order"><input type="number" className="input" value={edit.sort_order} onChange={(e) => setEdit({ ...edit, sort_order: e.target.value })} /></Field><Toggle checked={edit.is_active} onChange={(v) => setEdit({ ...edit, is_active: v })} label="Active" /></FormModal>}
    </div>
  );
}

// ------------------------------------------------------------------ payment modes
const FIELDS = [['bank_ref_no', 'Bank reference number'], ['cheque_no', 'Cheque number'], ['cheque_date', 'Cheque date'], ['dd_no', 'Demand draft number'], ['dd_favouring', 'Draft favouring'], ['upi_id', 'UPI ID'], ['destination_account', 'Destination account']];
export function Modes() {
  const list = useAsync(() => api.get<any[]>('/payment-modes'), []); const [edit, setEdit] = useState<any>(null);
  return (
    <div>
      <PageHeader title="Payment modes" subtitle="Amount limits and the details C must record for each mode." actions={<button className="btn-primary" onClick={() => setEdit({ code: '', name: '', min_amount: '', max_amount: '', required_fields: ['bank_ref_no'], requires_beneficiary_bank: true, is_active: true, sort_order: 50 })}><Icon name="plus" className="h-4 w-4" />Add mode</button>} />
      <Card pad={false}>{list.loading ? <Loading /> : list.error ? <div className="p-4"><ErrorBox error={list.error} retry={list.reload} /></div> : (
        <div className="overflow-x-auto"><table className="w-full min-w-[720px]"><thead><tr><th className="th">Mode</th><th className="th text-right">Minimum</th><th className="th text-right">Maximum</th><th className="th">C must record</th><th className="th">Beneficiary bank</th><th className="th">Status</th><th className="th"></th></tr></thead>
          <tbody className="divide-y divide-slate-100">{(list.data as any[]).map((m) => <tr key={m.code}><td className="td font-medium">{m.name}<div className="font-mono text-[11px] text-slate-400">{m.code}</div></td><td className="td num text-right">{m.min_amount != null ? money(m.min_amount) : '—'}</td><td className="td num text-right">{m.max_amount != null ? money(m.max_amount) : '—'}</td>
            <td className="td text-xs">{m.required_fields.map((f: string) => FIELDS.find(([k]) => k === f)?.[1] ?? f).join(', ')}</td><td className="td text-xs">{m.requires_beneficiary_bank ? 'Required' : 'Not needed'}</td><td className="td">{m.is_active ? <Badge tone="green">Active</Badge> : <Badge>Inactive</Badge>}</td><td className="td text-right"><button className="link text-xs" onClick={() => setEdit({ ...m, min_amount: m.min_amount ?? '', max_amount: m.max_amount ?? '', _edit: true })}>Edit</button></td></tr>)}</tbody></table></div>)}</Card>
      {edit && <FormModal open onClose={() => setEdit(null)} title={edit._edit ? `Edit ${edit.name}` : 'Add payment mode'} onSubmit={async () => { const b = { code: edit.code, name: edit.name, min_amount: edit.min_amount === '' ? null : Number(edit.min_amount), max_amount: edit.max_amount === '' ? null : Number(edit.max_amount), required_fields: edit.required_fields, requires_beneficiary_bank: edit.requires_beneficiary_bank, is_active: edit.is_active, sort_order: Number(edit.sort_order) || 0 }; if (edit._edit) await api.put(`/payment-modes/${edit.code}`, b); else await api.post('/payment-modes', b); setEdit(null); list.reload(); return 'Payment mode saved.'; }}>
        <div className="grid gap-3 sm:grid-cols-2"><Field label="Code" required><input className="input font-mono uppercase" disabled={edit._edit} value={edit.code} onChange={(e) => setEdit({ ...edit, code: e.target.value })} /></Field><Field label="Name" required><input className="input" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
          <Field label="Minimum amount (₹)"><input type="number" className="input" value={edit.min_amount} onChange={(e) => setEdit({ ...edit, min_amount: e.target.value })} /></Field><Field label="Maximum amount (₹)"><input type="number" className="input" value={edit.max_amount} onChange={(e) => setEdit({ ...edit, max_amount: e.target.value })} /></Field></div>
        <div className="rounded-lg border border-slate-200 p-3"><div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Details C must record</div><div className="grid gap-1 sm:grid-cols-2">{FIELDS.map(([k, l]) => <label key={k} className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4 rounded border-slate-300" checked={edit.required_fields.includes(k)} onChange={(e) => setEdit({ ...edit, required_fields: e.target.checked ? [...edit.required_fields, k] : edit.required_fields.filter((x: string) => x !== k) })} />{l}</label>)}</div></div>
        <Toggle checked={edit.requires_beneficiary_bank} onChange={(v) => setEdit({ ...edit, requires_beneficiary_bank: v })} label="Requires authorised beneficiary bank account" /><Toggle checked={edit.is_active} onChange={(v) => setEdit({ ...edit, is_active: v })} label="Active" /></FormModal>}
    </div>
  );
}

// ------------------------------------------------------------------ status labels
const COLORS = ['slate', 'blue', 'amber', 'green', 'red', 'teal', 'indigo', 'orange', 'purple'];
export function Statuses() {
  const toast = useToast(); const list = useAsync(() => api.get<any[]>('/statuses'), []); const [edit, setEdit] = useState<any>(null);
  return (
    <div>
      <PageHeader title="Status labels & colours" subtitle="Rename statuses (for example “PAYMENT APPROVED”) and choose badge colours. The underlying workflow does not change." />
      <Card pad={false}>{list.loading ? <Loading /> : list.error ? <div className="p-4"><ErrorBox error={list.error} retry={list.reload} /></div> : (
        <table className="w-full"><thead><tr><th className="th">Internal code</th><th className="th">Label shown</th><th className="th">Colour</th><th className="th"></th></tr></thead>
          <tbody className="divide-y divide-slate-100">{(list.data as any[]).map((s) => <tr key={s.code}><td className="td font-mono text-xs text-slate-500">{s.code}</td><td className="td"><Badge tone={s.color} dot>{s.label}</Badge></td><td className="td text-xs">{s.color}</td><td className="td text-right"><button className="link text-xs" onClick={() => setEdit({ ...s })}>Edit</button></td></tr>)}</tbody></table>)}</Card>
      {edit && <FormModal open onClose={() => setEdit(null)} title={`Edit ${edit.code}`} size="sm" onSubmit={async () => { await api.put(`/admin/statuses/${edit.code}`, { label: edit.label, color: edit.color, description: edit.description ?? null, is_active: true }); setEdit(null); list.reload(); toast.info('Reload other open tabs to see the new label.'); return 'Status updated.'; }}>
        <Field label="Label" required><input className="input" value={edit.label} onChange={(e) => setEdit({ ...edit, label: e.target.value })} /></Field>
        <Field label="Colour"><div className="flex flex-wrap gap-2">{COLORS.map((c) => <button key={c} type="button" onClick={() => setEdit({ ...edit, color: c })} className={`rounded-full ring-2 ${edit.color === c ? 'ring-navy-600' : 'ring-transparent'}`}><Badge tone={c}>{c}</Badge></button>)}</div></Field>
        <div className="text-xs text-slate-400">Preview: <Badge tone={edit.color} dot>{edit.label}</Badge></div></FormModal>}
    </div>
  );
}
