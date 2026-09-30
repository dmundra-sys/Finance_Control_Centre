import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api, errMsg } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Btn, Icon } from '../components/ui';

const ROLE_LABEL: Record<string, string> = { ADMIN: 'System Administrator', A: 'A · Payment Advice Maker', B: 'B · Payment Approver', C: 'C · Verification & Bank Initiation', D: 'D · Final Bank Approver', AUDITOR: 'Auditor (view only)' };

function Shell({ children, wide }: { children: React.ReactNode; wide?: boolean }) {
  return (
    <div className="grid min-h-screen lg:grid-cols-[1.05fr_1fr]">
      <div className="relative hidden overflow-hidden bg-navy-900 p-12 text-white lg:flex lg:flex-col lg:justify-between">
        <div className="absolute -right-24 -top-24 h-96 w-96 rounded-full bg-teal-400/10 blur-3xl" /><div className="absolute -bottom-32 -left-16 h-96 w-96 rounded-full bg-navy-500/30 blur-3xl" />
        <div className="relative flex items-center gap-3"><div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/10"><svg viewBox="0 0 32 32" className="h-7 w-7"><path d="M8 21l5-5 4 3 7-8" fill="none" stroke="#5eead4" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" /><circle cx="24" cy="11" r="2.2" fill="#5eead4" /></svg></div><span className="text-sm font-semibold tracking-wide text-navy-100">Group Finance</span></div>
        <div className="relative">
          <h1 className="max-w-md text-4xl font-bold leading-tight tracking-tight !text-white">Payment Approval &amp; Banking Workflow</h1>
          <p className="mt-4 max-w-md text-lg text-navy-200">From Payment Advice to Final Bank Approval — One Controlled Workflow</p>
          <ol className="mt-10 grid max-w-md gap-3 text-sm text-navy-100">
            {[['A', 'Creates the Payment Advice'], ['B', 'Approves against the approval matrix'], ['C', 'Verifies originals & initiates on the bank portal'], ['D', 'Gives final bank approval'], ['✓', 'C is notified on WhatsApp — full audit trail kept']].map(([k, t]) => (
              <li key={k} className="flex items-center gap-3"><span className="flex h-7 w-7 items-center justify-center rounded-full bg-white/10 text-xs font-bold text-teal-200 ring-1 ring-white/15">{k}</span>{t}</li>))}
          </ol>
        </div>
        <p className="relative text-xs text-navy-300">Bank credentials, passwords and OTPs are never stored in this system. Payments are initiated manually on the bank’s own portal.</p>
      </div>
      <div className="flex items-center justify-center bg-slate-50 px-4 py-10"><div className={wide ? 'w-full max-w-lg' : 'w-full max-w-md'}>
        <div className="mb-6 text-center lg:hidden"><h1 className="text-xl font-bold text-navy-900">Payment Approval &amp; Banking Workflow</h1><p className="mt-1 text-sm text-slate-500">From Payment Advice to Final Bank Approval</p></div>
        {children}
      </div></div>
    </div>
  );
}
export { Shell };

export default function Login() {
  const { refresh, notice, me } = useAuth(); const nav = useNavigate(); const [sp] = useSearchParams();
  const [userId, setUserId] = useState(''); const [password, setPassword] = useState(''); const [otp, setOtp] = useState(''); const [remember, setRemember] = useState(false);
  const [needOtp, setNeedOtp] = useState(false); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false); const [show, setShow] = useState(false);
  const [cfg, setCfg] = useState<any>({ demoLogins: [] });
  useEffect(() => { api.get('/auth/public-config').then(setCfg).catch(() => {}); }, []);
  useEffect(() => { if (me) nav(sp.get('next') || '/', { replace: true }); }, [me]);
  async function submit(e?: FormEvent, override?: { u: string; p: string }) {
    e?.preventDefault(); setErr(''); setBusy(true);
    try {
      const r = await api.post('/auth/login', { userId: (override?.u ?? userId).trim(), password: override?.p ?? password, otp: needOtp ? otp : undefined, remember });
      if (r.requiresOtp) { setNeedOtp(true); return; }
      await refresh();
    } catch (ex) { setErr(errMsg(ex)); } finally { setBusy(false); }
  }
  return (
    <Shell>
      <div className="card p-6 sm:p-8">
        <h2 className="text-xl font-bold text-navy-900">Sign in</h2>
        <p className="mt-1 text-sm text-slate-500">Use the credentials issued by your System Administrator.</p>
        {notice && <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">{notice}</div>}
        <form onSubmit={submit} className="mt-5 space-y-4" noValidate>
          <div><label className="label" htmlFor="uid">User ID</label><input id="uid" className="input" autoComplete="username" autoFocus value={userId} onChange={(e) => setUserId(e.target.value)} disabled={needOtp} placeholder="e.g. b.rajesh" /></div>
          <div><label className="label" htmlFor="pw">Password</label>
            <div className="relative"><input id="pw" type={show ? 'text' : 'password'} className="input pr-16" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} disabled={needOtp} />
              <button type="button" className="absolute right-2 top-1/2 -translate-y-1/2 rounded px-2 py-1 text-xs font-medium text-slate-500 hover:bg-slate-100" onClick={() => setShow(!show)}>{show ? 'Hide' : 'Show'}</button></div></div>
          {needOtp && <div><label className="label" htmlFor="otp">Authenticator code</label><input id="otp" className="input tracking-[0.4em]" inputMode="numeric" maxLength={6} autoFocus value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))} placeholder="6-digit code" /></div>}
          <div className="flex items-center justify-between text-sm">
            <label className="flex cursor-pointer items-center gap-2 text-slate-600"><input type="checkbox" className="h-4 w-4 rounded border-slate-300 text-navy-700" checked={remember} onChange={(e) => setRemember(e.target.checked)} />Remember me</label>
            <Link to="/forgot" className="link">Forgot password?</Link>
          </div>
          {err && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{err}</div>}
          <Btn busy={busy} type="submit" className="btn-primary w-full !py-2.5">{needOtp ? 'Verify & sign in' : 'Sign in'}</Btn>
        </form>
      </div>
      {cfg.demoLogins?.length > 0 && (
        <div className="mt-5 rounded-xl border border-dashed border-amber-300 bg-amber-50/70 p-4">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-amber-800"><Icon name="key" className="h-4 w-4" />Demo credentials <span className="font-normal normal-case text-amber-700">· password <code className="rounded bg-white/70 px-1 font-mono">{cfg.demoPassword}</code></span></div>
          <div className="mt-3 grid gap-1.5 sm:grid-cols-2">
            {cfg.demoLogins.map((d: any) => (
              <button key={d.login_id} type="button" disabled={busy} onClick={() => { setUserId(d.login_id); setPassword(cfg.demoPassword); submit(undefined, { u: d.login_id, p: cfg.demoPassword }); }}
                className="rounded-lg border border-amber-200 bg-white px-3 py-2 text-left transition hover:border-amber-400 hover:shadow-sm">
                <div className="text-[13px] font-semibold text-slate-800">{d.name.replace(' (DEMO)', '')}</div><div className="text-[11px] text-slate-500"><span className="font-mono">{d.login_id}</span> · {ROLE_LABEL[d.role_code] ?? d.role_code}</div>
              </button>))}
          </div>
          <p className="mt-2 text-[11px] text-amber-700">Click a user to sign in instantly. Shown only in demo mode; hidden in production.</p>
        </div>)}
    </Shell>
  );
}

export function Forgot() {
  const [id, setId] = useState(''); const [busy, setBusy] = useState(false); const [msg, setMsg] = useState(''); const [err, setErr] = useState('');
  return (
    <Shell><div className="card p-6 sm:p-8">
      <h2 className="text-xl font-bold text-navy-900">Reset your password</h2><p className="mt-1 text-sm text-slate-500">Enter your User ID or registered e-mail. If an account exists we will send a reset link that expires shortly.</p>
      {msg ? <div className="mt-5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-3 text-sm text-emerald-800">{msg}</div> :
        <form className="mt-5 space-y-4" onSubmit={async (e) => { e.preventDefault(); setErr(''); setBusy(true); try { const r = await api.post('/auth/forgot', { identifier: id }); setMsg(r.message); } catch (ex) { setErr(errMsg(ex)); } finally { setBusy(false); } }}>
          <div><label className="label">User ID or e-mail</label><input className="input" value={id} onChange={(e) => setId(e.target.value)} autoFocus /></div>
          {err && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{err}</div>}
          <Btn busy={busy} className="btn-primary w-full" type="submit">Send reset link</Btn>
        </form>}
      <p className="mt-5 text-center text-sm"><Link to="/login" className="link">← Back to sign in</Link></p>
    </div></Shell>
  );
}

export function Reset() {
  const [sp] = useSearchParams(); const token = sp.get('token') ?? ''; const nav = useNavigate();
  const [pw, setPw] = useState(''); const [pw2, setPw2] = useState(''); const [busy, setBusy] = useState(false); const [err, setErr] = useState(''); const [done, setDone] = useState(false);
  return (
    <Shell><div className="card p-6 sm:p-8">
      <h2 className="text-xl font-bold text-navy-900">Choose a new password</h2>
      {done ? <><div className="mt-5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-3 text-sm text-emerald-800">Your password has been changed. You can now sign in.</div><button className="btn-primary mt-4 w-full" onClick={() => nav('/login')}>Go to sign in</button></> :
        <form className="mt-5 space-y-4" onSubmit={async (e) => { e.preventDefault(); if (pw !== pw2) return setErr('The two passwords do not match.'); setErr(''); setBusy(true); try { await api.post('/auth/reset', { token, password: pw }); setDone(true); } catch (ex) { setErr(errMsg(ex)); } finally { setBusy(false); } }}>
          {!token && <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">This link is missing its token. Please use the link from your e-mail.</div>}
          <div><label className="label">New password</label><input type="password" className="input" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" /></div>
          <div><label className="label">Confirm new password</label><input type="password" className="input" value={pw2} onChange={(e) => setPw2(e.target.value)} autoComplete="new-password" /></div>
          <p className="text-[11px] text-slate-400">At least 10 characters with upper- and lower-case letters, a digit and a special character.</p>
          {err && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{err}</div>}
          <Btn busy={busy} className="btn-primary w-full" type="submit">Change password</Btn>
        </form>}
    </div></Shell>
  );
}
