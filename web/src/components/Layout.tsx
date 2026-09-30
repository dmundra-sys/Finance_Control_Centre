import { useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate, Link } from 'react-router-dom';
import clsx from 'clsx';
import { useAuth } from '../lib/auth';
import { api } from '../lib/api';
import { Icon, useDebounced, StatusBadge, Spinner } from './ui';
import { ago, money } from '../lib/format';

type NavItem = { to: string; label: string; icon: string; perm?: string; anyRole?: string[]; end?: boolean };
const MAIN: NavItem[] = [
  { to: '/', label: 'Dashboard', icon: 'home', end: true },
  { to: '/management', label: 'Management Dashboard', icon: 'chart', perm: 'dashboard.management' },
  { to: '/queue', label: 'Processing Queue', icon: 'list', perm: 'payment.verify_c' },
  { to: '/payments/new', label: 'New Payment Advice', icon: 'plus', perm: 'payment.create' },
  { to: '/payments', label: 'Payment Advices', icon: 'file', perm: 'payment.view', end: true },
  { to: '/vendors', label: 'Vendors & Parties', icon: 'users', perm: 'vendor.view' },
  { to: '/reports', label: 'Reports', icon: 'book', perm: 'report.view' },
  { to: '/audit', label: 'Audit Trail', icon: 'shield', perm: 'audit.view' },
];
const ADMIN: NavItem[] = [
  { to: '/admin/users', label: 'Users', icon: 'users' }, { to: '/admin/roles', label: 'Roles & Permissions', icon: 'lock' },
  { to: '/admin/companies', label: 'Companies', icon: 'building' }, { to: '/admin/banks', label: 'Bank Accounts', icon: 'bank' },
  { to: '/admin/matrix', label: 'Approval Matrix', icon: 'sliders' }, { to: '/admin/modes', label: 'Payment Modes', icon: 'tag' },
  { to: '/admin/lists', label: 'Master Lists', icon: 'list' }, { to: '/admin/statuses', label: 'Status Labels', icon: 'tag' },
  { to: '/admin/templates', label: 'Notification Templates', icon: 'msg' }, { to: '/admin/outbox', label: 'Message Outbox', icon: 'inbox' },
  { to: '/admin/settings', label: 'System Settings', icon: 'settings' }, { to: '/admin/backup', label: 'Backup & Recovery', icon: 'db' },
  { to: '/admin/logins', label: 'Login History', icon: 'clock' },
];

export default function Layout() {
  const { me, can, logout } = useAuth(); const nav = useNavigate(); const loc = useLocation();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [loc.pathname]);
  if (!me) return null;
  const vis = (n: NavItem) => !n.perm || can(n.perm);
  const roleNames: Record<string, string> = { ADMIN: 'System Administrator', A: 'Payment Advice Maker (A)', B: 'Payment Approver (B)', C: 'Verification & Bank Initiation (C)', D: 'Final Bank Approver (D)', AUDITOR: 'Auditor' };
  const link = (n: NavItem) => (
    <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => clsx('flex items-center gap-3 rounded-lg px-3 py-2 text-[13px] font-medium transition-colors', isActive ? 'bg-white/12 text-white' : 'text-navy-200 hover:bg-white/8 hover:text-white')}>
      <Icon name={n.icon} className="h-[18px] w-[18px] shrink-0 opacity-90" />{n.label}
    </NavLink>
  );
  const sidebar = (
    <div className="flex h-full flex-col bg-navy-900 text-white">
      <div className="flex items-center gap-2.5 px-4 py-4">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-white/10"><svg viewBox="0 0 32 32" className="h-6 w-6"><path d="M8 21l5-5 4 3 7-8" fill="none" stroke="#5eead4" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" /><circle cx="24" cy="11" r="2.2" fill="#5eead4" /></svg></div>
        <div className="leading-tight"><div className="text-[13px] font-semibold">Payment Approval</div><div className="text-[11px] text-navy-300">& Banking Workflow</div></div>
      </div>
      <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 pb-4">
        {MAIN.filter(vis).map(link)}
        {can('admin.access') && (<><div className="px-3 pb-1 pt-4 text-[10px] font-semibold uppercase tracking-wider text-navy-400">Administration</div>{ADMIN.map(link)}</>)}
        {me.app.demoMode && (<><div className="px-3 pb-1 pt-4 text-[10px] font-semibold uppercase tracking-wider text-navy-400">Demo</div>{link({ to: '/walkthrough', label: 'Demo Walkthrough', icon: 'play' })}</>)}
      </nav>
      <div className="border-t border-white/10 p-3">
        <NavLink to="/profile" className="flex items-center gap-2.5 rounded-lg px-2 py-2 hover:bg-white/8">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-teal-400/20 text-xs font-bold text-teal-200">{me.user.name.split(' ').map((s) => s[0]).slice(0, 2).join('')}</div>
          <div className="min-w-0 flex-1 leading-tight"><div className="truncate text-[13px] font-medium">{me.user.name}</div><div className="truncate text-[11px] text-navy-300">{roleNames[me.user.roleCode] ?? me.user.roleCode}</div></div>
        </NavLink>
        <button onClick={async () => { await logout(); nav('/login'); }} className="mt-1 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-[13px] text-navy-200 hover:bg-white/8 hover:text-white"><Icon name="logout" className="h-4 w-4" />Sign out</button>
      </div>
    </div>
  );
  return (
    <div className="flex min-h-screen">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 lg:block no-print">{sidebar}</aside>
      {open && (<div className="fixed inset-0 z-40 lg:hidden no-print"><div className="absolute inset-0 bg-navy-950/60" onClick={() => setOpen(false)} /><aside className="absolute inset-y-0 left-0 w-72 max-w-[85%]">{sidebar}</aside></div>)}
      <div className="flex min-w-0 flex-1 flex-col lg:pl-64">
        <Header onMenu={() => setOpen(true)} />
        {me.app.demoMode && <div className="border-b border-amber-200 bg-amber-50 px-4 py-1.5 text-center text-[11px] font-medium text-amber-800 no-print">DEMO MODE — sample companies, vendors and payments. No real money moves and no bank credentials are stored.</div>}
        <main className="mx-auto w-full max-w-[1500px] flex-1 px-3 py-5 sm:px-6 lg:px-8"><Outlet /></main>
      </div>
    </div>
  );
}

function Header({ onMenu }: { onMenu: () => void }) {
  return (
    <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-slate-200 bg-white/95 px-3 py-2.5 backdrop-blur sm:px-6 lg:px-8 no-print">
      <button className="rounded-lg p-2 text-slate-600 hover:bg-slate-100 lg:hidden" onClick={onMenu} aria-label="Open menu"><Icon name="menu" /></button>
      <GlobalSearch />
      <div className="ml-auto"><Bell /></div>
    </header>
  );
}

function GlobalSearch() {
  const [q, setQ] = useState(''); const dq = useDebounced(q, 250); const [res, setRes] = useState<any>(null); const [busy, setBusy] = useState(false); const [open, setOpen] = useState(false);
  const nav = useNavigate(); const box = useRef<HTMLDivElement>(null);
  useEffect(() => { let live = true; if (dq.trim().length < 2) { setRes(null); return; } setBusy(true); api.get('/search', { q: dq.trim() }).then((r) => live && setRes(r)).catch(() => live && setRes(null)).finally(() => live && setBusy(false)); return () => { live = false; }; }, [dq]);
  useEffect(() => { const f = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); }; document.addEventListener('mousedown', f); return () => document.removeEventListener('mousedown', f); }, []);
  const go = (to: string) => { setOpen(false); setQ(''); nav(to); };
  return (
    <div ref={box} className="relative w-full max-w-md">
      <Icon name="search" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
      <input value={q} onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} onKeyDown={(e) => { if (e.key === 'Enter' && q.trim()) go(`/payments?q=${encodeURIComponent(q.trim())}`); }}
        placeholder="Search PA number, vendor, invoice, UTR, bank ref…" className="input !pl-9" aria-label="Global search" />
      {open && q.trim().length >= 2 && (
        <div className="absolute left-0 right-0 top-full z-40 mt-1.5 max-h-[70vh] overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-pop">
          {busy && <div className="flex items-center gap-2 px-4 py-3 text-xs text-slate-500"><Spinner className="h-4 w-4" />Searching…</div>}
          {res && !res.payments.length && !res.vendors.length && !busy && <div className="px-4 py-4 text-sm text-slate-500">No matches for “{q}”.</div>}
          {res?.payments?.length > 0 && <div className="py-1"><div className="px-4 py-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">Payment Advices</div>
            {res.payments.map((p: any) => (<button key={p.id} onClick={() => go(`/payments/${p.id}`)} className="flex w-full items-center justify-between gap-3 px-4 py-2 text-left hover:bg-slate-50"><div className="min-w-0"><div className="text-sm font-semibold text-navy-800">{p.pa_number}</div><div className="truncate text-xs text-slate-500">{p.vendor} · {p.company_short} · Inv {p.invoice_number}</div></div><div className="shrink-0 text-right"><div className="num text-xs font-medium">{money(p.net_payable)}</div><StatusBadge label={p.status_label} color={p.status_color} /></div></button>))}
            {res.total > res.payments.length && <button onClick={() => go(`/payments?q=${encodeURIComponent(q.trim())}`)} className="w-full px-4 py-2 text-left text-xs font-semibold text-navy-600 hover:bg-slate-50">See all {res.total} results →</button>}
          </div>}
          {res?.vendors?.length > 0 && <div className="border-t border-slate-100 py-1"><div className="px-4 py-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">Vendors</div>
            {res.vendors.map((v: any) => (<button key={v.id} onClick={() => go(`/payments?vendor_id=${v.id}`)} className="flex w-full items-center justify-between px-4 py-2 text-left hover:bg-slate-50"><span className="text-sm text-slate-800">{v.name}</span><span className="text-xs text-slate-400">{v.vendor_code}</span></button>))}</div>}
        </div>
      )}
    </div>
  );
}

function Bell() {
  const { me } = useAuth(); const [open, setOpen] = useState(false); const [data, setData] = useState<any>(null); const box = useRef<HTMLDivElement>(null); const nav = useNavigate();
  const [unread, setUnread] = useState(me?.unread ?? 0);
  const load = async () => { try { const d = await api.get('/notifications'); setData(d); setUnread(d.unread); } catch { /* ignore */ } };
  useEffect(() => { load(); const t = setInterval(load, 45000); return () => clearInterval(t); }, []);
  useEffect(() => { const f = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); }; document.addEventListener('mousedown', f); return () => document.removeEventListener('mousedown', f); }, []);
  const readAll = async () => { await api.post('/notifications/read', { all: true }); load(); };
  return (
    <div ref={box} className="relative">
      <button onClick={() => { setOpen(!open); if (!open) load(); }} className="relative rounded-lg p-2 text-slate-600 hover:bg-slate-100" aria-label="Notifications">
        <Icon name="bell" />{unread > 0 && <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">{unread > 99 ? '99+' : unread}</span>}
      </button>
      {open && (
        <div className="fixed inset-x-2 top-14 z-40 rounded-xl border border-slate-200 bg-white shadow-pop sm:absolute sm:inset-x-auto sm:right-0 sm:top-full sm:mt-2 sm:w-96">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2.5"><span className="text-sm font-semibold text-navy-900">Notifications</span>{unread > 0 && <button onClick={readAll} className="text-xs font-semibold text-navy-600 hover:underline">Mark all read</button>}</div>
          <div className="max-h-[60vh] overflow-y-auto">
            {!data ? <div className="p-6 text-center"><Spinner className="mx-auto" /></div> : data.rows.length === 0 ? <div className="p-8 text-center text-sm text-slate-500">You're all caught up.</div> :
              data.rows.map((n: any) => (
                <button key={n.id} onClick={async () => { setOpen(false); if (!n.is_read) { await api.post('/notifications/read', { ids: [n.id] }); load(); } if (n.payment_id) nav(`/payments/${n.payment_id}`); }} className={clsx('flex w-full gap-3 border-b border-slate-50 px-4 py-3 text-left hover:bg-slate-50', !n.is_read && 'bg-navy-50/50')}>
                  <span className={clsx('mt-1.5 h-2 w-2 shrink-0 rounded-full', n.is_read ? 'bg-transparent' : 'bg-navy-500')} />
                  <span className="min-w-0"><span className="block text-[13px] font-semibold text-slate-800">{n.title}</span><span className="mt-0.5 line-clamp-2 block text-xs text-slate-500">{n.body}</span><span className="mt-1 block text-[11px] text-slate-400">{ago(n.created_at)}</span></span>
                </button>))}
          </div>
        </div>
      )}
    </div>
  );
}
export { Link };
