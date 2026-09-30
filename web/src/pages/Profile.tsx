import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, errMsg } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Badge, Btn, Card, Field, KV, PageHeader, useAsync, useToast } from '../components/ui';
import { fmtDateTime } from '../lib/format';

export default function Profile() {
  const { me, refresh } = useAuth(); const toast = useToast(); const [sp] = useSearchParams(); const u = me!.user;
  const [pw, setPw] = useState({ current: '', next: '', again: '' }); const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const [tf, setTf] = useState<any>(null); const [code, setCode] = useState(''); const [dpw, setDpw] = useState(''); const [tfErr, setTfErr] = useState('');
  const sessions = useAsync(() => api.get<any[]>('/auth/sessions'), []);
  const roleNames: Record<string, string> = { ADMIN: 'System Administrator', A: 'Payment Advice Maker (A)', B: 'Payment Approver (B)', C: 'Verification & Bank Initiation (C)', D: 'Final Bank Approver (D)', AUDITOR: 'Auditor' };
  async function change() {
    setErr(''); if (pw.next !== pw.again) return setErr('The new passwords do not match.');
    setBusy(true); try { await api.post('/auth/change-password', { current: pw.current, next: pw.next }); toast.ok('Password changed.'); setPw({ current: '', next: '', again: '' }); await refresh(); } catch (e) { setErr(errMsg(e)); } finally { setBusy(false); }
  }
  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title="My profile" subtitle="Your account, password and sign-in security." />
      {sp.get('force') && u.mustChangePassword && <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900"><b>Please choose a new password to continue.</b> Your administrator requires a change on first sign-in.</div>}
      <div className="grid gap-4 md:grid-cols-2">
        <Card title="Account"><dl className="grid grid-cols-2 gap-4">
          <KV label="Name">{u.name}</KV><KV label="User ID" mono>{u.loginId}</KV><KV label="E-mail">{u.email}</KV><KV label="Mobile">{u.mobile}</KV>
          <KV label="Roles">{u.roles.map((r) => <Badge key={r} tone="blue">{roleNames[r] ?? r}</Badge>)}</KV>
          <KV label="Special authority"><div className="flex flex-wrap gap-1">{u.isSeniorApprover && <Badge tone="purple">Senior approver</Badge>}{u.canOverrideDuplicate && <Badge tone="orange">Duplicate override</Badge>}{u.canViewFullAccount && <Badge tone="teal">Full account view</Badge>}{!u.isSeniorApprover && !u.canOverrideDuplicate && !u.canViewFullAccount && <span className="text-slate-400">None</span>}</div></KV></dl></Card>
        <Card title="Change password">
          <div className="space-y-3">
            <Field label="Current password"><input type="password" className="input" autoComplete="current-password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} /></Field>
            <Field label="New password" hint="At least 10 characters with upper- and lower-case, a digit and a special character."><input type="password" className="input" autoComplete="new-password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} /></Field>
            <Field label="Repeat new password"><input type="password" className="input" autoComplete="new-password" value={pw.again} onChange={(e) => setPw({ ...pw, again: e.target.value })} /></Field>
            {err && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{err}</div>}
            <Btn busy={busy} className="btn-primary" onClick={change}>Change password</Btn></div></Card>
        <Card title="Two-factor authentication (authenticator app)" className="md:col-span-2">
          {u.twoFactorEnabled ? (
            <div className="flex flex-wrap items-end gap-3"><Badge tone="green" dot>Enabled</Badge><Field label="Confirm password to disable"><input type="password" className="input" value={dpw} onChange={(e) => setDpw(e.target.value)} /></Field>
              <Btn className="btn-outline text-red-600" onClick={async () => { try { await api.post('/auth/2fa/disable', { password: dpw }); toast.ok('Two-factor authentication disabled.'); setDpw(''); refresh(); } catch (e) { toast.err(e); } }}>Disable</Btn></div>
          ) : !tf ? (
            <div className="flex flex-wrap items-center justify-between gap-3"><p className="max-w-xl text-sm text-slate-600">Add a second step at sign-in using Google Authenticator, Microsoft Authenticator or any TOTP app. Strongly recommended for approvers.</p><Btn className="btn-primary" onClick={async () => { try { setTf(await api.post('/auth/2fa/setup')); } catch (e) { toast.err(e); } }}>Set up</Btn></div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-[auto_1fr] sm:items-center"><img src={tf.qr} alt="Scan this QR code with your authenticator app" className="h-44 w-44 rounded-lg border border-slate-200" />
              <div className="space-y-3"><p className="text-sm text-slate-600">1. Scan the QR code with your authenticator app.<br />2. Enter the 6-digit code it shows.</p><p className="text-xs text-slate-400">Can’t scan? Enter this key manually: <code className="select-all rounded bg-slate-100 px-1.5 py-0.5 font-mono">{tf.secret}</code></p>
                <div className="flex flex-wrap items-end gap-2"><Field label="6-digit code"><input className="input tracking-[0.3em]" inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} /></Field>
                  <Btn className="btn-primary" onClick={async () => { setTfErr(''); try { await api.post('/auth/2fa/enable', { code }); toast.ok('Two-factor authentication enabled.'); setTf(null); setCode(''); refresh(); } catch (e) { setTfErr(errMsg(e)); } }}>Verify & enable</Btn></div>
                {tfErr && <p className="text-sm text-red-600">{tfErr}</p>}</div></div>)}
        </Card>
        <Card title="Active sessions" className="md:col-span-2" pad={false}>
          <div className="overflow-x-auto"><table className="w-full"><thead><tr><th className="th">Signed in</th><th className="th">Last activity</th><th className="th">IP</th><th className="th">Device</th></tr></thead>
            <tbody className="divide-y divide-slate-100">{((sessions.data as any[]) ?? []).map((s, i) => <tr key={i}><td className="td text-xs">{fmtDateTime(s.created_at)} {s.current && <Badge tone="green">This device</Badge>}</td><td className="td text-xs">{fmtDateTime(s.last_activity_at)}</td><td className="td text-xs">{s.ip}</td><td className="td max-w-xs truncate text-xs text-slate-500" title={s.user_agent}>{s.user_agent}</td></tr>)}</tbody></table></div></Card>
      </div>
    </div>
  );
}
