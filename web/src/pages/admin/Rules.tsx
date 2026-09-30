import { useState } from 'react';
import { api } from '../../lib/api';
import { Badge, Btn, Card, Check, Empty, ErrorBox, Field, Icon, Loading, PageHeader, Tabs, Toggle, useAsync, useToast } from '../../components/ui';
import { FormModal } from '../../components/forms';
import { money } from '../../lib/format';

// ------------------------------------------------------------------ approval matrix
const blankM = { name: '', company_id: '', department: '', bank_account_id: '', payment_type: '', min_amount: 0, max_amount: '', b_levels: [{ label: 'Payment Approver', senior: false, count: 1 }], d_count: 1, sort_order: 10, is_active: true };
export function Matrix() {
  const list = useAsync(() => api.get<any[]>('/admin/approval-matrix'), []); const meta = useAsync(() => api.get('/payments/meta'), []); const [edit, setEdit] = useState<any>(null);
  const m = meta.data as any;
  return (
    <div>
      <PageHeader title="Approval matrix" subtitle="Who must approve, by amount. The most specific matching rule wins (company, bank, department, payment type, then amount band). It is frozen onto each advice at submission." actions={<button className="btn-primary" onClick={() => setEdit({ ...blankM })}><Icon name="plus" className="h-4 w-4" />Add rule</button>} />
      <div className="grid gap-4 2xl:grid-cols-3">
        <Card className="2xl:col-span-2" pad={false}>{list.loading ? <Loading /> : list.error ? <div className="p-4"><ErrorBox error={list.error} retry={list.reload} /></div> : (list.data as any[]).length === 0 ? <Empty title="No rules" hint="Without a matching rule, submission is blocked." /> : (
          <div className="overflow-x-auto"><table className="w-full min-w-[780px]"><thead><tr><th className="th">Rule</th><th className="th">Applies to</th><th className="th text-right">Amount band</th><th className="th">B levels</th><th className="th">D</th><th className="th"></th></tr></thead>
            <tbody className="divide-y divide-slate-100">{(list.data as any[]).map((r) => (
              <tr key={r.id} className={r.is_active ? '' : 'opacity-50'}><td className="td font-medium">{r.name}{!r.is_active && <Badge>Off</Badge>}</td>
                <td className="td text-xs">{[r.company_short, r.bank_name, r.department, r.payment_type && r.payment_type.replace(/_/g, ' ')].filter(Boolean).join(' · ') || <span className="text-slate-400">Everything</span>}</td>
                <td className="td num whitespace-nowrap text-right text-xs">{money(r.min_amount)} – {r.max_amount != null ? money(r.max_amount) : 'no limit'}</td>
                <td className="td text-xs">{r.b_levels.map((l: any, i: number) => <div key={i}>{i + 1}. {l.label}{l.senior && <Badge tone="purple">Senior</Badge>} ×{l.count}</div>)}</td><td className="td text-xs">{r.d_count} approval{r.d_count > 1 ? 's' : ''}</td>
                <td className="td text-right"><button className="link text-xs" onClick={() => setEdit({ ...r, company_id: r.company_id ?? '', bank_account_id: r.bank_account_id ?? '', department: r.department ?? '', payment_type: r.payment_type ?? '', max_amount: r.max_amount ?? '' })}>Edit</button></td></tr>))}</tbody></table></div>)}</Card>
        <Tester m={m} />
      </div>
      {edit && m && <FormModal open onClose={() => setEdit(null)} title={edit.id ? 'Edit rule' : 'Add rule'} size="lg" onSubmit={async () => {
        const b = { name: edit.name, company_id: edit.company_id ? +edit.company_id : null, bank_account_id: edit.bank_account_id ? +edit.bank_account_id : null, department: edit.department || null, payment_type: edit.payment_type || null, min_amount: Number(edit.min_amount) || 0, max_amount: edit.max_amount === '' ? null : Number(edit.max_amount), b_levels: edit.b_levels.map((l: any) => ({ ...l, count: Number(l.count) || 1 })), d_count: Number(edit.d_count) || 1, sort_order: Number(edit.sort_order) || 0, is_active: edit.is_active };
        if (edit.id) await api.put(`/admin/approval-matrix/${edit.id}`, b); else await api.post('/admin/approval-matrix', b); setEdit(null); list.reload(); return 'Rule saved. It applies to advices submitted from now on.'; }}>
        <Field label="Rule name" required><input className="input" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Company (blank = all)"><select className="input" value={edit.company_id} onChange={(e) => setEdit({ ...edit, company_id: e.target.value })}><option value="">All companies</option>{m.companies.map((c: any) => <option key={c.id} value={c.id}>{c.short_name}</option>)}</select></Field>
          <Field label="Bank account (blank = all)"><select className="input" value={edit.bank_account_id} onChange={(e) => setEdit({ ...edit, bank_account_id: e.target.value })}><option value="">All accounts</option>{m.banks.map((b: any) => <option key={b.id} value={b.id}>{b.company_short} · {b.bank_name} {b.account_masked}</option>)}</select></Field>
          <Field label="Department (blank = all)"><select className="input" value={edit.department} onChange={(e) => setEdit({ ...edit, department: e.target.value })}><option value="">All departments</option>{m.departments.map((d: any) => <option key={d.code} value={d.name}>{d.name}</option>)}</select></Field>
          <Field label="Payment type (blank = all)"><select className="input" value={edit.payment_type} onChange={(e) => setEdit({ ...edit, payment_type: e.target.value })}><option value="">All types</option>{m.paymentTypes.map((t: any) => <option key={t.code} value={t.code}>{t.name}</option>)}</select></Field>
          <Field label="From amount (₹)" required><input type="number" className="input num" value={edit.min_amount} onChange={(e) => setEdit({ ...edit, min_amount: e.target.value })} /></Field>
          <Field label="Up to amount (₹, blank = no limit)"><input type="number" className="input num" value={edit.max_amount} onChange={(e) => setEdit({ ...edit, max_amount: e.target.value })} /></Field></div>
        <div className="rounded-lg border border-slate-200 p-3"><div className="mb-2 flex items-center justify-between"><span className="text-xs font-semibold uppercase tracking-wide text-slate-500">B approval levels (in order)</span><button type="button" className="btn-outline btn-sm" onClick={() => setEdit({ ...edit, b_levels: [...edit.b_levels, { label: 'Approver', senior: false, count: 1 }] })}>+ Level</button></div>
          {edit.b_levels.map((l: any, i: number) => (<div key={i} className="mb-2 grid grid-cols-12 items-center gap-2"><input className="input col-span-5" value={l.label} onChange={(e) => setEdit({ ...edit, b_levels: edit.b_levels.map((x: any, j: number) => j === i ? { ...x, label: e.target.value } : x) })} />
            <input type="number" min={1} max={5} className="input col-span-2" value={l.count} onChange={(e) => setEdit({ ...edit, b_levels: edit.b_levels.map((x: any, j: number) => j === i ? { ...x, count: e.target.value } : x) })} title="Approvals required" />
            <div className="col-span-4"><Check checked={l.senior} onChange={(v) => setEdit({ ...edit, b_levels: edit.b_levels.map((x: any, j: number) => j === i ? { ...x, senior: v } : x) })} label="Senior only" /></div>
            <button type="button" disabled={edit.b_levels.length === 1} className="col-span-1 text-red-600 disabled:opacity-30" onClick={() => setEdit({ ...edit, b_levels: edit.b_levels.filter((_: any, j: number) => j !== i) })} aria-label="Remove level">✕</button></div>))}</div>
        <div className="grid gap-3 sm:grid-cols-3"><Field label="Final (D) approvals required"><input type="number" min={1} max={5} className="input" value={edit.d_count} onChange={(e) => setEdit({ ...edit, d_count: e.target.value })} /></Field><Field label="Priority order" hint="Lower first among equals."><input type="number" className="input" value={edit.sort_order} onChange={(e) => setEdit({ ...edit, sort_order: e.target.value })} /></Field><div className="flex items-end pb-2"><Toggle checked={edit.is_active} onChange={(v) => setEdit({ ...edit, is_active: v })} label="Active" /></div></div></FormModal>}
    </div>
  );
}
function Tester({ m }: { m: any }) {
  const [f, setF] = useState<any>({ company_id: '', bank_account_id: '', payment_type: 'VENDOR', net_payable: '' }); const [r, setR] = useState<any>(null); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const banks = (m?.banks ?? []).filter((b: any) => String(b.company_id) === String(f.company_id));
  return (
    <Card title="Test the matrix"><p className="mb-3 text-xs text-slate-500">See which rule and approvers a payment would need.</p>
      <div className="space-y-3">
        <Field label="Company"><select className="input" value={f.company_id} onChange={(e) => setF({ ...f, company_id: e.target.value, bank_account_id: '' })}><option value="">Select…</option>{m?.companies.map((c: any) => <option key={c.id} value={c.id}>{c.short_name}</option>)}</select></Field>
        <Field label="Bank account"><select className="input" value={f.bank_account_id} onChange={(e) => setF({ ...f, bank_account_id: e.target.value })}><option value="">Select…</option>{banks.map((b: any) => <option key={b.id} value={b.id}>{b.bank_name} {b.account_masked}</option>)}</select></Field>
        <Field label="Payment type"><select className="input" value={f.payment_type} onChange={(e) => setF({ ...f, payment_type: e.target.value })}>{m?.paymentTypes.map((t: any) => <option key={t.code} value={t.code}>{t.name}</option>)}</select></Field>
        <Field label="Net payable (₹)"><input type="number" className="input num" value={f.net_payable} onChange={(e) => setF({ ...f, net_payable: e.target.value })} /></Field>
        <Btn busy={busy} className="btn-outline w-full" disabled={!f.company_id || !f.bank_account_id || f.net_payable === ''} onClick={async () => { setBusy(true); setErr(''); setR(null); try { setR(await api.post('/admin/approval-matrix/preview', { ...f, company_id: +f.company_id, bank_account_id: +f.bank_account_id, net_payable: Number(f.net_payable) })); } catch (e: any) { setErr(e.message); } finally { setBusy(false); } }}>Show approval route</Btn>
        {err && <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{err}</p>}
        {r && <div className="rounded-lg bg-navy-50 p-3 text-sm"><div className="font-semibold text-navy-900">{r.matrix_name}</div><ol className="mt-2 space-y-1 text-xs text-slate-700">{r.b_levels.map((l: any, i: number) => <li key={i}>B{i + 1}: {l.label}{l.senior ? ' (Senior)' : ''} × {l.count}</li>)}<li>D: {r.d_count} final approval{r.d_count > 1 ? 's' : ''}</li></ol></div>}
      </div></Card>
  );
}

// ------------------------------------------------------------------ roles
export function Roles() {
  const toast = useToast(); const r = useAsync(() => api.get('/admin/roles'), []); const [active, setActive] = useState('A'); const [draft, setDraft] = useState<Record<string, string[]>>({}); const [busy, setBusy] = useState(false);
  if (r.loading) return <Loading />; if (r.error) return <ErrorBox error={r.error} retry={r.reload} />;
  const d = r.data as any; const role = d.roles.find((x: any) => x.code === active); const perms: string[] = draft[active] ?? role.permissions; const dirty = !!draft[active];
  const groups: Record<string, any[]> = {}; d.catalog.forEach((p: any) => { (groups[p.group] ??= []).push(p); });
  return (
    <div>
      <PageHeader title="Roles & permissions" subtitle="What each role may do. Changes apply at the next request — no restart needed. Segregation-of-duties rules are enforced regardless." />
      <Tabs tabs={d.roles.map((x: any) => ({ key: x.code, label: x.code === 'ADMIN' ? 'Admin' : x.code === 'AUDITOR' ? 'Auditor' : `Role ${x.code}` }))} value={active} onChange={setActive} />
      <Card className="mt-4" title={role.name} actions={<Btn busy={busy} className="btn-primary btn-sm" disabled={!dirty} onClick={async () => { setBusy(true); try { await api.put(`/admin/roles/${active}/permissions`, { permissions: perms }); toast.ok('Permissions saved.'); setDraft((x) => { const n = { ...x }; delete n[active]; return n; }); r.reload(); } catch (e) { toast.err(e); } finally { setBusy(false); } }}>Save changes</Btn>}>
        <p className="mb-4 text-sm text-slate-500">{role.description}</p>
        <div className="grid gap-4 md:grid-cols-2">{Object.entries(groups).map(([g, list]) => (<div key={g} className="rounded-lg border border-slate-200 p-3"><div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{g}</div><div className="space-y-1.5">{list.map((p) => <Check key={p.key} checked={perms.includes(p.key)} onChange={(v) => setDraft({ ...draft, [active]: v ? [...perms, p.key] : perms.filter((x) => x !== p.key) })} label={<>{p.label} <span className="font-mono text-[10px] text-slate-400">{p.key}</span></>} />)}</div></div>))}</div>
      </Card>
    </div>
  );
}

// ------------------------------------------------------------------ notification templates
const CH = ['INAPP', 'EMAIL', 'WHATSAPP', 'SMS'];
export function Templates() {
  const r = useAsync(() => api.get('/admin/notification-templates'), []); const [ev, setEv] = useState<string>(''); const [edit, setEdit] = useState<any>(null);
  if (r.loading) return <Loading />; if (r.error) return <ErrorBox error={r.error} retry={r.reload} />;
  const d = r.data as any; const events: [string, string][] = d.events; const cur = ev || events[0][0]; const rows = d.templates.filter((t: any) => t.event_code === cur);
  return (
    <div>
      <PageHeader title="Notification templates" subtitle="Message text per event and channel. Placeholders are filled automatically." />
      <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
        <Card pad={false}><ul className="max-h-[70vh] divide-y divide-slate-100 overflow-y-auto">{events.map(([k, l]) => <li key={k}><button onClick={() => setEv(k)} className={`w-full px-4 py-2.5 text-left text-sm ${cur === k ? 'bg-navy-50 font-semibold text-navy-900' : 'text-slate-600 hover:bg-slate-50'}`}>{l}<div className="font-mono text-[10px] text-slate-400">{k}</div></button></li>)}</ul></Card>
        <div className="space-y-3">{CH.map((c) => { const t = rows.find((x: any) => x.channel === c); if (!t) return null; return (
          <Card key={c} title={<span>{c === 'INAPP' ? 'In-app' : c === 'EMAIL' ? 'E-mail' : c === 'WHATSAPP' ? 'WhatsApp' : 'SMS'} {t.is_enabled ? <Badge tone="green" dot>On</Badge> : <Badge>Off</Badge>}</span>} actions={<button className="btn-outline btn-sm" onClick={() => setEdit({ ...t })}>Edit</button>}>
            {t.subject && <div className="mb-1 text-sm font-medium">{t.subject}</div>}<pre className="whitespace-pre-wrap font-sans text-sm text-slate-600">{t.body}</pre></Card>); })}</div></div>
      {edit && <FormModal open onClose={() => setEdit(null)} title={`${edit.channel} · ${edit.event_code}`} size="lg" onSubmit={async () => { await api.put(`/admin/notification-templates/${edit.id}`, { is_enabled: edit.is_enabled, subject: edit.subject, body: edit.body }); setEdit(null); r.reload(); return 'Template saved.'; }}>
        <Toggle checked={edit.is_enabled} onChange={(v) => setEdit({ ...edit, is_enabled: v })} label="Send this message" />
        {edit.channel !== 'SMS' && edit.channel !== 'WHATSAPP' && <Field label="Subject / title"><input className="input" value={edit.subject ?? ''} onChange={(e) => setEdit({ ...edit, subject: e.target.value })} /></Field>}
        <Field label="Message" required hint="Placeholders: {{pa_no}} {{company}} {{vendor}} {{amount}} {{bank}} {{approved_by}} {{approval_date}} {{bank_reference}} {{stage}} {{status}} {{due_date}} {{invoice_no}} {{reason}} {{remarks}} {{user_name}} {{link}}"><textarea className="input font-mono text-[13px]" rows={12} value={edit.body} onChange={(e) => setEdit({ ...edit, body: e.target.value })} /></Field></FormModal>}
    </div>
  );
}
