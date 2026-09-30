import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, download, errMsg } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { Badge, Btn, Card, Empty, ErrorBox, Field, Icon, Loading, PageHeader, Tabs, Toggle, useAsync, useToast } from '../../components/ui';
import { bytes, fmtDateTime } from '../../lib/format';

// ------------------------------------------------------------------ settings
const TABS = [['whatsapp', 'WhatsApp'], ['email', 'E-mail'], ['sms', 'SMS'], ['documents', 'Documents'], ['password_policy', 'Password policy'], ['session', 'Sessions'], ['backup', 'Backup schedule'], ['bank_integration', 'Bank integration'], ['app', 'General'], ['recovery', 'Recovery contact']];
export function Settings() {
  const [tab, setTab] = useState('whatsapp'); const s = useAsync(() => api.get('/admin/settings'), []);
  return (
    <div>
      <PageHeader title="System settings" subtitle="Integrations, security and limits. Secrets are encrypted on the server and are never sent back to the browser." />
      <Tabs tabs={TABS.map(([key, label]) => ({ key, label }))} value={tab} onChange={setTab} />
      <div className="mt-4">{s.loading ? <Loading /> : s.error ? <ErrorBox error={s.error} retry={s.reload} /> : tab === 'recovery' ? <Recovery /> : <SettingForm key={tab} k={tab} init={(s.data as any)[tab]} onSaved={s.reload} />}</div>
    </div>
  );
}

function SettingForm({ k, init, onSaved }: { k: string; init: any; onSaved: () => void }) {
  const toast = useToast(); const [f, setF] = useState<any>({ ...init.value }); const [busy, setBusy] = useState(false); const [test, setTest] = useState(''); const [tb, setTb] = useState(false);
  const set = (x: string, v: any) => setF((p: any) => ({ ...p, [x]: v }));
  const num = (x: string, label: string, hint?: string, min = 0) => <Field label={label} hint={hint}><input type="number" min={min} className="input" value={f[x] ?? ''} onChange={(e) => set(x, e.target.value === '' ? '' : Number(e.target.value))} /></Field>;
  const txt = (x: string, label: string, hint?: string, type = 'text') => <Field label={label} hint={hint}><input type={type} className="input" value={f[x] ?? ''} onChange={(e) => set(x, e.target.value)} autoComplete="off" /></Field>;
  async function save() { setBusy(true); try { const b: any = { ...f }; for (const x of Object.keys(b)) if (x.startsWith('has_')) delete b[x]; await api.put(`/admin/settings/${k}`, b); toast.ok('Settings saved.'); set('access_token', ''); set('password', ''); onSaved(); } catch (e) { toast.err(e); } finally { setBusy(false); } }
  async function sendTest(channel: 'WHATSAPP' | 'EMAIL') { setTb(true); try { const r = await api.post('/admin/settings/test-message', { channel, to: test }); toast.ok(r.ok === false ? `Test failed: ${r.error}` : `Test sent${r.mock ? ' (MOCK provider — nothing left the server)' : ''}.`); } catch (e) { toast.err(e); } finally { setTb(false); } }
  return (
    <Card title={init.description} className="max-w-3xl">
      <div className="space-y-4">
        {k === 'whatsapp' && <>
          <Field label="Provider"><select className="input" value={f.provider} onChange={(e) => set('provider', e.target.value)}><option value="MOCK">MOCK — simulate (safe for demo/testing)</option><option value="META_CLOUD">Meta WhatsApp Cloud API</option><option value="WEBHOOK">Generic webhook (Twilio / Gupshup / in-house gateway)</option></select></Field>
          {f.provider === 'META_CLOUD' && <div className="grid gap-3 sm:grid-cols-2">{txt('phone_number_id', 'Phone number ID')}{txt('api_version', 'API version')}{txt('template_name', 'Approved template name', 'Business-initiated messages must use an approved template.')}{txt('template_language', 'Template language')}
            <Field label="Access token" className="sm:col-span-2" hint={f.has_access_token ? 'A token is stored (encrypted). Leave blank to keep it.' : 'Paste the permanent system-user token. Stored encrypted; never shown again.'}><input type="password" className="input font-mono" autoComplete="new-password" placeholder={f.has_access_token ? '••••••••••••••••' : ''} value={f.access_token ?? ''} onChange={(e) => set('access_token', e.target.value)} /></Field></div>}
          {f.provider === 'WEBHOOK' && <div className="grid gap-3">{txt('webhook_url', 'Webhook URL', 'HTTPS endpoint that receives {to, text}.')}<Field label="Bearer token (optional)" hint={f.has_access_token ? 'A token is stored. Leave blank to keep.' : ''}><input type="password" className="input font-mono" autoComplete="new-password" value={f.access_token ?? ''} onChange={(e) => set('access_token', e.target.value)} /></Field></div>}
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3"><div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Send a test message</div><div className="flex flex-wrap gap-2"><input className="input max-w-xs" placeholder="Mobile e.g. 9876543210" value={test} onChange={(e) => setTest(e.target.value)} /><Btn busy={tb} disabled={!test} className="btn-outline" onClick={() => sendTest('WHATSAPP')}>Send test</Btn></div><p className="mt-1 text-[11px] text-slate-400">Save your changes first — the test uses the saved settings.</p></div></>}
        {k === 'email' && <>
          <Field label="Provider"><select className="input" value={f.provider} onChange={(e) => set('provider', e.target.value)}><option value="MOCK">MOCK — simulate</option><option value="SMTP">SMTP server</option></select></Field>
          {f.provider === 'SMTP' && <div className="grid gap-3 sm:grid-cols-2">{txt('host', 'SMTP host')}{num('port', 'Port')}{txt('user', 'Username')}<Field label="Password" hint={f.has_password ? 'A password is stored (encrypted). Leave blank to keep.' : ''}><input type="password" className="input" autoComplete="new-password" value={f.password ?? ''} onChange={(e) => set('password', e.target.value)} /></Field><div className="sm:col-span-2"><Toggle checked={!!f.secure} onChange={(v) => set('secure', v)} label="Use implicit TLS (port 465). Leave off for STARTTLS on 587." /></div></div>}
          <div className="grid gap-3 sm:grid-cols-2">{txt('from_name', 'From name')}{txt('from_email', 'From address')}</div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3"><div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Send a test e-mail</div><div className="flex flex-wrap gap-2"><input className="input max-w-xs" placeholder="you@company.com" value={test} onChange={(e) => setTest(e.target.value)} /><Btn busy={tb} disabled={!test} className="btn-outline" onClick={() => sendTest('EMAIL')}>Send test</Btn></div></div></>}
        {k === 'sms' && <><Field label="Provider"><select className="input" value={f.provider} onChange={(e) => set('provider', e.target.value)}><option value="MOCK">MOCK — simulate</option><option value="FUTURE" disabled>Real SMS gateway — Future integration</option></select></Field><p className="text-sm text-slate-500">SMS is disabled by default. Enable individual SMS messages under Notification Templates; they are logged to the outbox by the mock provider.</p></>}
        {k === 'documents' && <div className="grid gap-3 sm:grid-cols-2">{num('max_file_mb', 'Maximum file size (MB)', undefined, 1)}<Field label="Allowed extensions" hint="Comma separated. Files are also checked by content, not just name."><input className="input" value={(f.allowed_extensions ?? []).join(', ')} onChange={(e) => set('allowed_extensions', e.target.value.split(',').map((x: string) => x.trim().toLowerCase().replace(/^\./, '')).filter(Boolean))} /></Field></div>}
        {k === 'password_policy' && <><div className="grid gap-3 sm:grid-cols-2">{num('min_length', 'Minimum length', undefined, 8)}{num('expiry_days', 'Password expires after (days, 0 = never)')}{num('max_failed_attempts', 'Lock account after failed attempts', undefined, 3)}{num('lockout_minutes', 'Lock duration (minutes)', undefined, 1)}</div>
          <div className="grid gap-2 sm:grid-cols-2">{[['require_upper', 'Require upper-case letter'], ['require_lower', 'Require lower-case letter'], ['require_digit', 'Require digit'], ['require_special', 'Require special character']].map(([x, l]) => <Toggle key={x} checked={!!f[x]} onChange={(v) => set(x, v)} label={l} />)}</div></>}
        {k === 'session' && <div className="grid gap-3 sm:grid-cols-2">{num('idle_minutes', 'Sign out after inactivity (minutes)', undefined, 5)}{num('absolute_hours', 'Maximum session length (hours)', undefined, 1)}{num('remember_me_days', '“Remember me” lasts (days)', undefined, 1)}{num('remember_idle_hours', 'Idle limit with “Remember me” (hours)', undefined, 1)}</div>}
        {k === 'backup' && <><div className="grid gap-3 sm:grid-cols-3"><div className="flex items-end pb-2"><Toggle checked={!!f.enabled} onChange={(v) => set('enabled', v)} label="Automatic daily backup" /></div><Field label="Time (IST, 24 h)"><input type="time" className="input" value={f.time} onChange={(e) => set('time', e.target.value)} /></Field>{num('retention_days', 'Keep for (days)', undefined, 1)}</div><p className="text-xs text-slate-500">Backups are PostgreSQL dumps stored on the server. Copy them off-site regularly — see Backup & Recovery.</p></>}
        {k === 'bank_integration' && <><Field label="Bank integration mode"><select className="input" value={f.provider} onChange={(e) => set('provider', e.target.value)}><option value="MANUAL">MANUAL — C initiates on the bank portal and records the reference</option><option value="API" disabled>Bank API / host-to-host — Future integration</option></select></Field><p className="text-sm text-slate-500">The system is built with an integration seam so a bank API can be plugged in later. Bank credentials are never stored here.</p></>}
        {k === 'app' && <div className="space-y-3">{txt('org_name', 'Organisation name')}<Toggle checked={!!f.demo_mode} onChange={(v) => set('demo_mode', v)} label="Demo mode (shows demo banner and demo sign-in shortcuts)" /><p className="text-xs text-slate-500">Turn demo mode off before real use. Demo sign-in shortcuts are additionally hidden whenever SHOW_DEMO_LOGINS=false (the default in production).</p></div>}
        {k !== 'sms' && <div className="flex justify-end"><Btn busy={busy} className="btn-primary" onClick={save}>Save settings</Btn></div>}
        {k === 'sms' && <div className="flex justify-end"><Btn busy={busy} className="btn-primary" onClick={save}>Save settings</Btn></div>}
      </div>
    </Card>
  );
}

function Recovery() {
  const { me } = useAuth(); const toast = useToast(); const r = useAsync(() => api.get('/admin/recovery'), []); const [m, setM] = useState(''); const [pw, setPw] = useState(''); const [busy, setBusy] = useState(false); const [shown, setShown] = useState(false);
  useEffect(() => { if (r.data) setM((r.data as any).mobile); }, [r.data]);
  if (r.loading) return <Loading />; if (r.error) return <ErrorBox error={r.error} />;
  const d = r.data as any;
  return (
    <Card title="System administrator recovery / contact mobile" className="max-w-xl">
      <p className="mb-4 text-sm text-slate-600">Used only for account-recovery and emergency contact. It is shown on this screen only — never on the login page or any public page.</p>
      <div className="mb-4 flex items-center gap-3 rounded-lg bg-slate-50 px-4 py-3"><Icon name="lock" className="h-5 w-5 text-slate-400" /><span className="font-mono text-lg tracking-wider">{shown ? d.mobile : d.mobile.replace(/\d(?=\d{2})/g, '•')}</span><button className="ml-auto text-xs font-semibold text-navy-600 hover:underline" onClick={() => setShown(!shown)}>{shown ? 'Hide' : 'Show'}</button></div>
      {d.can_change && me!.user.isSuperAdmin ? (
        <div className="space-y-3"><Field label="New recovery mobile"><input className="input font-mono" inputMode="numeric" value={m} onChange={(e) => setM(e.target.value.replace(/[^\d+]/g, ''))} /></Field><Field label="Confirm with your password" required><input type="password" className="input" autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} /></Field>
          <Btn busy={busy} className="btn-primary" disabled={!pw || m === d.mobile} onClick={async () => { setBusy(true); try { await api.put('/admin/recovery', { mobile: m, password: pw }); toast.ok('Recovery number updated and audited.'); setPw(''); r.reload(); } catch (e) { toast.err(e); } finally { setBusy(false); } }}>Update number</Btn></div>
      ) : <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">Only a super-admin can change this number.</p>}
    </Card>
  );
}

// ------------------------------------------------------------------ outbox / simulator
export function Outbox() {
  const toast = useToast(); const [ch, setCh] = useState(''); const r = useAsync(() => api.get<any[]>('/admin/outbox', { channel: ch }), [ch]); const [busy, setBusy] = useState(false); const [open, setOpen] = useState<number | null>(null);
  const rows = (r.data as any[]) ?? [];
  const tone = (s: string) => (s === 'SENT' ? 'green' : s === 'FAILED' ? 'red' : 'amber');
  return (
    <div>
      <PageHeader title="Message outbox" subtitle="Every e-mail, WhatsApp and SMS the system has queued. With the MOCK provider nothing leaves the server — this is your WhatsApp simulator."
        actions={<><Link to="/admin/settings" className="btn-outline">Provider settings</Link><Btn busy={busy} className="btn-primary" onClick={async () => { setBusy(true); try { await api.post('/admin/outbox/flush'); toast.ok('Pending messages processed.'); r.reload(); } catch (e) { toast.err(e); } finally { setBusy(false); } }}>Send pending now</Btn></>} />
      <Tabs tabs={[{ key: '', label: 'All' }, { key: 'WHATSAPP', label: 'WhatsApp' }, { key: 'EMAIL', label: 'E-mail' }, { key: 'SMS', label: 'SMS' }]} value={ch} onChange={setCh} />
      <div className="mt-4">{r.loading && !r.data ? <Loading /> : r.error ? <ErrorBox error={r.error} retry={r.reload} /> : rows.length === 0 ? <Card><Empty title="Nothing queued" /></Card> : ch === 'WHATSAPP' ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{rows.map((m) => (
          <div key={m.id} className="rounded-2xl border border-slate-200 bg-[#e5ddd5] p-3 shadow-card">
            <div className="mb-2 flex items-center justify-between text-[11px] text-slate-600"><span className="font-semibold">To: {m.recipient ?? '—'} · {m.to_address}</span><Badge tone={tone(m.status)}>{m.status}</Badge></div>
            <div className="rounded-lg rounded-tl-none bg-white p-3 text-[13px] leading-snug shadow-sm"><pre className="whitespace-pre-wrap font-sans text-slate-800">{m.body}</pre><div className="mt-1 text-right text-[10px] text-slate-400">{fmtDateTime(m.sent_at ?? m.created_at)} {m.status === 'SENT' && '✓✓'}</div></div>
            {m.error && <p className="mt-2 text-xs text-red-700">{m.error}</p>}<div className="mt-1 text-[10px] text-slate-500">{m.pa_number} · {m.provider ?? 'not sent'}</div></div>))}</div>
      ) : (
        <Card pad={false}><div className="overflow-x-auto"><table className="w-full min-w-[800px]"><thead><tr><th className="th">Queued</th><th className="th">Channel</th><th className="th">To</th><th className="th">Event</th><th className="th">Subject / message</th><th className="th">Status</th></tr></thead>
          <tbody className="divide-y divide-slate-100">{rows.map((m) => (
            <tr key={m.id} className="align-top hover:bg-slate-50/70"><td className="td whitespace-nowrap text-xs">{fmtDateTime(m.created_at)}</td><td className="td"><Badge tone={m.channel === 'WHATSAPP' ? 'green' : m.channel === 'EMAIL' ? 'blue' : 'slate'}>{m.channel}</Badge></td><td className="td text-xs">{m.recipient}<div className="text-slate-400">{m.to_address}</div></td><td className="td text-xs">{m.event_code}<div className="text-slate-400">{m.pa_number}</div></td>
              <td className="td max-w-md text-sm"><button className="text-left hover:underline" onClick={() => setOpen(open === m.id ? null : m.id)}>{m.subject ?? m.body.slice(0, 80)}</button>{open === m.id && <pre className="mt-2 whitespace-pre-wrap rounded bg-slate-50 p-2 font-sans text-xs text-slate-700">{m.body}</pre>}</td>
              <td className="td"><Badge tone={tone(m.status)}>{m.status}</Badge>{m.error && <div className="mt-1 max-w-[200px] text-[11px] text-red-600">{m.error}</div>}</td></tr>))}</tbody></table></div></Card>)}</div>
    </div>
  );
}

// ------------------------------------------------------------------ backup
export function Backup() {
  const toast = useToast(); const r = useAsync(() => api.get('/admin/backups'), []); const [busy, setBusy] = useState(false); const d = r.data as any;
  return (
    <div>
      <PageHeader title="Backup & recovery" subtitle="Create and download PostgreSQL backups. Automatic scheduling is under System settings → Backup schedule." actions={<Btn busy={busy} className="btn-primary" onClick={async () => { setBusy(true); try { const x = await api.post('/admin/backups'); toast.ok(`Backup created (${bytes(x.size)}).`); r.reload(); } catch (e) { toast.err(e); } finally { setBusy(false); } }}><Icon name="db" className="h-4 w-4" />Back up now</Btn>} />
      <Card pad={false}>{r.loading ? <Loading /> : r.error ? <div className="p-4"><ErrorBox error={r.error} retry={r.reload} /></div> : d.files.length === 0 ? <Empty title="No backups yet" hint="Click “Back up now” to create the first one." /> : (
        <table className="w-full"><thead><tr><th className="th">File</th><th className="th">Created</th><th className="th text-right">Size</th><th className="th"></th></tr></thead>
          <tbody className="divide-y divide-slate-100">{d.files.map((f: any) => <tr key={f.file}><td className="td font-mono text-xs">{f.file}</td><td className="td text-xs">{fmtDateTime(f.created_at)}</td><td className="td text-right text-xs">{bytes(f.size)}</td><td className="td text-right"><button className="link text-xs" onClick={async () => { try { await download(`/api/admin/backups/${f.file}`, f.file); } catch (e) { toast.err(e); } }}>Download</button></td></tr>)}</tbody></table>)}</Card>
      <Card className="mt-4" title="How to restore"><ol className="list-decimal space-y-1.5 pl-5 text-sm text-slate-600"><li>Stop the application (or put it in maintenance).</li><li>Create an empty database and run: <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs">pg_restore --clean --if-exists --no-owner -d pawf backup-file.dump</code></li><li>Make sure <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs">DATA_ENCRYPTION_KEY</code> is the <b>same</b> key as when the backup was taken — without it encrypted account numbers and stored documents cannot be read.</li><li>Start the application and use Audit Trail → Verify integrity to confirm the audit chain is intact.</li></ol></Card>
    </div>
  );
}

export function Logins() {
  const r = useAsync(() => api.get<any[]>('/admin/login-history'), []);
  return (
    <div>
      <PageHeader title="Login history" subtitle="The last 200 sign-in attempts, successful or not." />
      <Card pad={false}>{r.loading ? <Loading /> : r.error ? <div className="p-4"><ErrorBox error={r.error} retry={r.reload} /></div> : (
        <div className="overflow-x-auto"><table className="w-full min-w-[720px]"><thead><tr><th className="th">When</th><th className="th">User ID</th><th className="th">Name</th><th className="th">Result</th><th className="th">IP</th><th className="th">Device</th></tr></thead>
          <tbody className="divide-y divide-slate-100">{(r.data as any[]).map((l) => <tr key={l.id}><td className="td whitespace-nowrap text-xs">{fmtDateTime(l.at)}</td><td className="td font-mono text-xs">{l.login_id}</td><td className="td text-xs">{l.name ?? '—'}</td><td className="td">{l.success ? <Badge tone="green" dot>Success</Badge> : <Badge tone="red" dot>{l.reason ?? 'Failed'}</Badge>}</td><td className="td text-xs">{l.ip}</td><td className="td max-w-xs truncate text-xs text-slate-400" title={l.user_agent}>{l.user_agent}</td></tr>)}</tbody></table></div>)}</Card>
    </div>
  );
}
export { errMsg };
