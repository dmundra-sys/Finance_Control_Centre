import { useState } from 'react';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { Badge, Card, Check, Empty, ErrorBox, Field, Icon, Loading, PageHeader, Toggle, useAsync, useToast } from '../../components/ui';
import { FormModal } from '../../components/forms';
import { fmtDateTime } from '../../lib/format';

const ROLES = [['ADMIN', 'System Administrator'], ['A', 'A · Payment Advice Maker'], ['B', 'B · Payment Approver'], ['C', 'C · Verification & Bank Initiation'], ['D', 'D · Final Bank Approver'], ['AUDITOR', 'Auditor / View only']];
const blank = { login_id: '', name: '', email: '', mobile: '', employee_code: '', role_code: 'A', extra_roles: [] as string[], is_active: true, is_senior_approver: false, can_view_full_account: false, can_override_duplicate: false, sod_exception: false, is_super_admin: false, company_ids: [] as number[], bank_account_ids: [] as number[], password: '', must_change_password: true };

export default function Users() {
  const { me } = useAuth(); const toast = useToast();
  const users = useAsync(() => api.get<any[]>('/admin/users'), []); const companies = useAsync(() => api.get<any[]>('/companies'), []); const banks = useAsync(() => api.get<any[]>('/bank-accounts'), []);
  const [edit, setEdit] = useState<any>(null); const [pw, setPw] = useState<any>(null); const [q, setQ] = useState(''); const [role, setRole] = useState('');
  const rows = ((users.data as any[]) ?? []).filter((u) => (!role || u.role_code === role) && (!q || `${u.name} ${u.login_id} ${u.email}`.toLowerCase().includes(q.toLowerCase())));
  return (
    <div>
      <PageHeader title="Users" subtitle="Create users, assign roles and restrict them to companies and bank accounts." actions={<button className="btn-primary" onClick={() => setEdit({ ...blank })}><Icon name="plus" className="h-4 w-4" />Add user</button>} />
      <Card pad={false}>
        <div className="flex flex-wrap gap-2 border-b border-slate-100 p-3"><input className="input max-w-xs" placeholder="Search name, user ID, e-mail…" value={q} onChange={(e) => setQ(e.target.value)} /><select className="input !w-auto" value={role} onChange={(e) => setRole(e.target.value)}><option value="">All roles</option>{ROLES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
        {users.loading ? <Loading /> : users.error ? <div className="p-4"><ErrorBox error={users.error} retry={users.reload} /></div> : rows.length === 0 ? <Empty title="No users" /> : (
          <div className="overflow-x-auto"><table className="w-full min-w-[900px]"><thead><tr><th className="th">User</th><th className="th">Role</th><th className="th">Companies</th><th className="th">Flags</th><th className="th">Last sign-in</th><th className="th">Status</th><th className="th"></th></tr></thead>
            <tbody className="divide-y divide-slate-100">{rows.map((u) => (
              <tr key={u.id} className="hover:bg-slate-50/70"><td className="td"><div className="font-medium text-slate-800">{u.name}</div><div className="text-xs text-slate-400"><span className="font-mono">{u.login_id}</span> · {u.email}</div></td>
                <td className="td text-xs"><Badge tone="blue">{u.role_code}</Badge>{u.extra_roles?.map((r: string) => <Badge key={r} tone="slate">+{r}</Badge>)}</td>
                <td className="td text-xs">{((companies.data as any[]) ?? []).filter((c) => u.company_ids.includes(c.id)).map((c) => c.short_name).join(', ') || <span className="text-slate-400">{['ADMIN', 'AUDITOR'].includes(u.role_code) ? 'All' : 'None'}</span>}</td>
                <td className="td"><div className="flex flex-wrap gap-1">{u.is_senior_approver && <Badge tone="purple">Senior</Badge>}{u.can_override_duplicate && <Badge tone="orange">Dup. override</Badge>}{u.can_view_full_account && <Badge tone="teal">Full A/c</Badge>}{u.sod_exception && <Badge tone="red">SoD exception</Badge>}{u.two_factor_enabled && <Badge tone="green">2FA</Badge>}{u.is_super_admin && <Badge tone="indigo">Super-admin</Badge>}</div></td>
                <td className="td whitespace-nowrap text-xs">{fmtDateTime(u.last_login_at)}</td>
                <td className="td">{!u.is_active ? <Badge>Inactive</Badge> : u.locked_until && new Date(u.locked_until) > new Date() ? <Badge tone="red" dot>Locked</Badge> : <Badge tone="green" dot>Active</Badge>}</td>
                <td className="td whitespace-nowrap text-right text-xs"><button className="link" onClick={() => setEdit({ ...blank, ...u, password: '' })}>Edit</button><button className="ml-3 link" onClick={() => setPw(u)}>Reset password</button>
                  {u.locked_until && new Date(u.locked_until) > new Date() && <button className="ml-3 link" onClick={async () => { try { await api.post(`/admin/users/${u.id}/unlock`); toast.ok('Account unlocked.'); users.reload(); } catch (e) { toast.err(e); } }}>Unlock</button>}</td></tr>))}</tbody></table></div>)}
      </Card>
      {edit && <UserForm init={edit} me={me!.user} companies={(companies.data as any[]) ?? []} banks={(banks.data as any[]) ?? []} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); users.reload(); }} />}
      {pw && <PwForm u={pw} onClose={() => setPw(null)} onSaved={() => { setPw(null); users.reload(); }} />}
    </div>
  );
}

function UserForm({ init, me, companies, banks, onClose, onSaved }: { init: any; me: any; companies: any[]; banks: any[]; onClose: () => void; onSaved: () => void }) {
  const isNew = !init.id; const [f, setF] = useState<any>(init); const set = (k: string, v: any) => setF((x: any) => ({ ...x, [k]: v }));
  const toggle = (k: string, v: number | string) => set(k, f[k].includes(v) ? f[k].filter((x: any) => x !== v) : [...f[k], v]);
  const bankList = banks.filter((b) => f.company_ids.includes(b.company_id));
  return (
    <FormModal open onClose={onClose} title={isNew ? 'Add user' : `Edit ${init.name}`} size="lg" onSubmit={async () => {
      const b: any = { name: f.name, email: f.email, mobile: f.mobile || null, employee_code: f.employee_code || null, role_code: f.role_code, extra_roles: f.extra_roles, is_active: f.is_active, is_senior_approver: f.is_senior_approver, can_view_full_account: f.can_view_full_account, can_override_duplicate: f.can_override_duplicate, sod_exception: f.sod_exception, is_super_admin: f.is_super_admin, company_ids: f.company_ids, bank_account_ids: f.bank_account_ids.filter((id: number) => bankList.some((x) => x.id === id)) };
      if (isNew) { b.login_id = f.login_id; b.password = f.password; b.must_change_password = f.must_change_password; await api.post('/admin/users', b); } else await api.put(`/admin/users/${f.id}`, b);
      onSaved(); return isNew ? 'User created.' : 'User updated.';
    }}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Full name" required><input className="input" value={f.name} onChange={(e) => set('name', e.target.value)} /></Field>
        <Field label="User ID" required hint={isNew ? '3–40 characters: letters, digits, . _ -' : 'Cannot be changed.'}><input className="input font-mono" disabled={!isNew} value={f.login_id} onChange={(e) => set('login_id', e.target.value)} /></Field>
        <Field label="E-mail" required><input className="input" type="email" value={f.email} onChange={(e) => set('email', e.target.value)} /></Field>
        <Field label="Mobile (for WhatsApp / SMS)" hint="10 digits or with country code."><input className="input" value={f.mobile ?? ''} onChange={(e) => set('mobile', e.target.value)} /></Field>
        <Field label="Employee code"><input className="input" value={f.employee_code ?? ''} onChange={(e) => set('employee_code', e.target.value)} /></Field>
        <Field label="Primary role" required><select className="input" value={f.role_code} onChange={(e) => set('role_code', e.target.value)}>{ROLES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
        {isNew && <><Field label="Temporary password" required><input className="input font-mono" value={f.password} onChange={(e) => set('password', e.target.value)} autoComplete="new-password" /></Field><div className="flex items-end pb-2"><Toggle checked={f.must_change_password} onChange={(v) => set('must_change_password', v)} label="Must change at first sign-in" /></div></>}
      </div>
      <div className="rounded-lg border border-slate-200 p-3"><div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Additional roles <span className="font-normal normal-case text-slate-400">(segregation-of-duties still applies per payment)</span></div>
        <div className="flex flex-wrap gap-x-5 gap-y-1">{ROLES.filter(([k]) => k !== f.role_code).map(([k, l]) => <Check key={k} checked={f.extra_roles.includes(k)} onChange={() => toggle('extra_roles', k)} label={l} />)}</div></div>
      <div className="rounded-lg border border-slate-200 p-3"><div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Companies this user can access</div>
        <div className="grid gap-1 sm:grid-cols-2">{companies.map((c) => <Check key={c.id} checked={f.company_ids.includes(c.id)} onChange={() => toggle('company_ids', c.id)} label={c.name} />)}</div>
        {['C', 'D'].includes(f.role_code) && bankList.length > 0 && <div className="mt-3 border-t border-slate-100 pt-3"><div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Restrict to bank accounts <span className="font-normal normal-case text-slate-400">(leave all unticked = every account of the companies)</span></div>
          <div className="grid gap-1 sm:grid-cols-2">{bankList.map((b) => <Check key={b.id} checked={f.bank_account_ids.includes(b.id)} onChange={() => toggle('bank_account_ids', b.id)} label={`${b.company_short} · ${b.bank_name} ${b.account_masked}`} />)}</div></div>}</div>
      <div className="grid gap-2 rounded-lg border border-slate-200 p-3 sm:grid-cols-2">
        <Toggle checked={f.is_senior_approver} onChange={(v) => set('is_senior_approver', v)} label="Senior approver (B)" />
        <Toggle checked={f.can_override_duplicate} onChange={(v) => set('can_override_duplicate', v)} label="May override duplicate warning" />
        <Toggle checked={f.can_view_full_account} onChange={(v) => set('can_view_full_account', v)} label="May view full bank account numbers" />
        <Toggle checked={f.sod_exception} onChange={(v) => set('sod_exception', v)} label="Segregation-of-duties exception (B→C)" />
        {me.isSuperAdmin && <Toggle checked={f.is_super_admin} onChange={(v) => set('is_super_admin', v)} label="Super-admin (recovery number)" />}
        <Toggle checked={f.is_active} onChange={(v) => set('is_active', v)} label="Account active" />
      </div>
    </FormModal>
  );
}
function PwForm({ u, onClose, onSaved }: { u: any; onClose: () => void; onSaved: () => void }) {
  const [p, setP] = useState('');
  return <FormModal open onClose={onClose} title={`Reset password — ${u.name}`} size="sm" submitLabel="Reset password" onSubmit={async () => { await api.post(`/admin/users/${u.id}/reset-password`, { password: p }); onSaved(); return 'Password reset. The user must change it at next sign-in.'; }}>
    <Field label="Temporary password" required hint="Share it through a secure channel. All active sessions of the user are ended."><input className="input font-mono" value={p} onChange={(e) => setP(e.target.value)} autoComplete="new-password" /></Field></FormModal>;
}
