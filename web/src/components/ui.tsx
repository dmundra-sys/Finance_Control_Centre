import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode, type ButtonHTMLAttributes } from 'react';
import clsx from 'clsx';
import { errMsg } from '../lib/api';

// ------------------------------------------------------------------ toast
type Toast = { id: number; kind: 'ok' | 'err' | 'info'; text: string };
const ToastCtx = createContext<{ ok: (t: string) => void; err: (t: any) => void; info: (t: string) => void }>(null as any);
export const useToast = () => useContext(ToastCtx);
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]); const n = useRef(0);
  const push = useCallback((kind: Toast['kind'], text: string) => {
    const id = ++n.current; setItems((x) => [...x, { id, kind, text }]);
    setTimeout(() => setItems((x) => x.filter((i) => i.id !== id)), kind === 'err' ? 8000 : 4500);
  }, []);
  const api = { ok: (t: string) => push('ok', t), err: (t: any) => push('err', typeof t === 'string' ? t : errMsg(t)), info: (t: string) => push('info', t) };
  return (
    <ToastCtx.Provider value={api}>
      {children}
      <div className="fixed right-3 top-3 z-[100] flex w-[calc(100%-1.5rem)] max-w-sm flex-col gap-2 no-print" role="status" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={clsx('rounded-lg border px-4 py-3 text-sm shadow-pop', t.kind === 'ok' && 'border-emerald-200 bg-emerald-50 text-emerald-900', t.kind === 'err' && 'border-red-200 bg-red-50 text-red-900', t.kind === 'info' && 'border-navy-200 bg-white text-navy-900')}>
            {t.text}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

// ------------------------------------------------------------------ primitives
export function Spinner({ className }: { className?: string }) {
  return <svg className={clsx('h-5 w-5 animate-spin text-navy-500', className)} viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity=".2" strokeWidth="4" /><path d="M22 12a10 10 0 0 0-10-10" stroke="currentColor" strokeWidth="4" strokeLinecap="round" /></svg>;
}
export function Loading({ text = 'Loading…' }: { text?: string }) { return <div className="flex items-center justify-center gap-2 py-16 text-sm text-slate-500"><Spinner />{text}</div>; }
export function ErrorBox({ error, retry }: { error: any; retry?: () => void }) {
  return <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">{errMsg(error)} {retry && <button className="ml-2 font-semibold underline" onClick={retry}>Try again</button>}</div>;
}
export function Empty({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) {
  return <div className="flex flex-col items-center justify-center px-4 py-12 text-center"><div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-400"><Icon name="inbox" className="h-6 w-6" /></div><div className="text-sm font-semibold text-slate-700">{title}</div>{hint && <div className="mt-1 max-w-sm text-xs text-slate-500">{hint}</div>}{action && <div className="mt-4">{action}</div>}</div>;
}

export function Btn({ busy, children, className, ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { busy?: boolean }) {
  return <button {...p} disabled={p.disabled || busy} className={className}>{busy && <Spinner className="h-4 w-4 !text-current" />}{children}</button>;
}

const TONES: Record<string, string> = {
  slate: 'bg-slate-100 text-slate-700 ring-1 ring-slate-200', blue: 'bg-blue-50 text-blue-700 ring-1 ring-blue-200', amber: 'bg-amber-50 text-amber-800 ring-1 ring-amber-200',
  green: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200', red: 'bg-red-50 text-red-700 ring-1 ring-red-200', teal: 'bg-teal-50 text-teal-700 ring-1 ring-teal-200',
  indigo: 'bg-indigo-50 text-indigo-700 ring-1 ring-indigo-200', orange: 'bg-orange-50 text-orange-800 ring-1 ring-orange-200', purple: 'bg-purple-50 text-purple-700 ring-1 ring-purple-200',
};
export const DOT: Record<string, string> = { slate: 'bg-slate-400', blue: 'bg-blue-500', amber: 'bg-amber-500', green: 'bg-emerald-500', red: 'bg-red-500', teal: 'bg-teal-500', indigo: 'bg-indigo-500', orange: 'bg-orange-500', purple: 'bg-purple-500' };
export function Badge({ tone = 'slate', children, dot }: { tone?: string; children: ReactNode; dot?: boolean }) {
  return <span className={clsx('badge', TONES[tone] ?? TONES.slate)}>{dot && <span className={clsx('h-1.5 w-1.5 rounded-full', DOT[tone] ?? DOT.slate)} />}{children}</span>;
}
export function StatusBadge({ label, color }: { label: string; color: string }) { return <Badge tone={color} dot>{label}</Badge>; }
export function PriorityBadge({ p }: { p: string }) {
  const t = p === 'URGENT' ? 'red' : p === 'HIGH' ? 'orange' : p === 'LOW' ? 'slate' : 'blue';
  return <Badge tone={t}>{p}</Badge>;
}

export function Card({ title, actions, children, className, pad = true }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; pad?: boolean }) {
  return <section className={clsx('card', className)}>{(title || actions) && <div className="card-h"><h3 className="card-t">{title}</h3><div className="flex items-center gap-2">{actions}</div></div>}<div className={pad ? 'p-4' : ''}>{children}</div></section>;
}
export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return <div className="mb-5 flex flex-wrap items-start justify-between gap-3"><div><h1 className="text-xl font-bold tracking-tight text-navy-900 sm:text-2xl">{title}</h1>{subtitle && <p className="mt-0.5 text-sm text-slate-500">{subtitle}</p>}</div><div className="flex flex-wrap items-center gap-2">{actions}</div></div>;
}

// ------------------------------------------------------------------ forms
export function Field({ label, error, hint, required, children, className }: { label?: string; error?: string; hint?: string; required?: boolean; children: ReactNode; className?: string }) {
  return <div className={className}>{label && <label className="label">{label}{required && <span className="text-red-500"> *</span>}</label>}{children}{hint && !error && <p className="mt-1 text-[11px] text-slate-400">{hint}</p>}{error && <p className="mt-1 text-xs text-red-600">{error}</p>}</div>;
}
export function Toggle({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label?: ReactNode; disabled?: boolean }) {
  return (
    <label className={clsx('inline-flex items-center gap-2 text-sm text-slate-700', disabled ? 'opacity-50' : 'cursor-pointer')}>
      <button type="button" role="switch" aria-checked={checked} disabled={disabled} onClick={() => onChange(!checked)} className={clsx('relative h-5 w-9 shrink-0 rounded-full transition-colors', checked ? 'bg-emerald-500' : 'bg-slate-300')}>
        <span className={clsx('absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all', checked ? 'left-[18px]' : 'left-0.5')} />
      </button>{label}
    </label>
  );
}
export function Check({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; disabled?: boolean }) {
  return <label className={clsx('flex items-start gap-2 text-sm text-slate-700', disabled ? 'opacity-60' : 'cursor-pointer')}><input type="checkbox" className="mt-0.5 h-4 w-4 rounded border-slate-300 text-navy-700 focus:ring-navy-400" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} /><span>{label}</span></label>;
}

// ------------------------------------------------------------------ modal
export function Modal({ open, onClose, title, children, footer, size = 'md', dismissable = true }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode; size?: 'sm' | 'md' | 'lg' | 'xl'; dismissable?: boolean }) {
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape' && dismissable) onClose(); };
    window.addEventListener('keydown', k); const prev = document.body.style.overflow; document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', k); document.body.style.overflow = prev; };
  }, [open, onClose, dismissable]);
  if (!open) return null;
  const w = { sm: 'max-w-md', md: 'max-w-xl', lg: 'max-w-3xl', xl: 'max-w-5xl' }[size];
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4 no-print" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-navy-950/50 backdrop-blur-[1px]" onClick={dismissable ? onClose : undefined} />
      <div className={clsx('relative flex max-h-[92vh] w-full flex-col rounded-t-2xl bg-white shadow-pop sm:rounded-2xl', w)}>
        <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-5 py-4"><h2 className="text-base font-semibold text-navy-900">{title}</h2><button onClick={onClose} className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label="Close"><Icon name="x" className="h-5 w-5" /></button></div>
        <div className="overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-100 bg-slate-50/60 px-5 py-3 sm:rounded-b-2xl">{footer}</div>}
      </div>
    </div>
  );
}
export function Confirm({ open, title, message, confirmLabel = 'Confirm', danger, onConfirm, onClose }: { open: boolean; title: string; message: ReactNode; confirmLabel?: string; danger?: boolean; onConfirm: () => Promise<any> | any; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <Modal open={open} onClose={onClose} title={title} size="sm" footer={<><button className="btn-outline" onClick={onClose}>Cancel</button><Btn busy={busy} className={danger ? 'btn-red' : 'btn-primary'} onClick={async () => { setBusy(true); try { await onConfirm(); } finally { setBusy(false); } }}>{confirmLabel}</Btn></>}>
      <div className="text-sm text-slate-600">{message}</div>
    </Modal>
  );
}

// ------------------------------------------------------------------ tabs
export function Tabs({ tabs, value, onChange }: { tabs: { key: string; label: string; count?: number }[]; value: string; onChange: (k: string) => void }) {
  return (
    <div className="-mx-1 overflow-x-auto"><div className="flex min-w-max gap-1 border-b border-slate-200 px-1">
      {tabs.map((t) => (
        <button key={t.key} onClick={() => onChange(t.key)} className={clsx('relative whitespace-nowrap px-3.5 py-2.5 text-sm font-medium transition-colors', value === t.key ? 'text-navy-900' : 'text-slate-500 hover:text-slate-800')}>
          {t.label}{t.count != null && <span className="ml-1.5 rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600">{t.count}</span>}
          {value === t.key && <span className="absolute inset-x-2 -bottom-px h-0.5 rounded bg-navy-900" />}
        </button>
      ))}
    </div></div>
  );
}

export function KV({ label, children, mono }: { label: string; children: ReactNode; mono?: boolean }) {
  return <div className="min-w-0"><dt className="text-[11px] font-medium uppercase tracking-wide text-slate-400">{label}</dt><dd className={clsx('mt-0.5 break-words text-sm text-slate-800', mono && 'font-mono text-[13px]')}>{children ?? '—'}</dd></div>;
}

export function Pagination({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize)); if (total <= pageSize) return <div className="px-4 py-2.5 text-xs text-slate-400">{total} record{total === 1 ? '' : 's'}</div>;
  return (
    <div className="flex items-center justify-between gap-2 border-t border-slate-100 px-4 py-2.5 text-xs text-slate-500">
      <span>{(page - 1) * pageSize + 1}–{Math.min(total, page * pageSize)} of {total}</span>
      <div className="flex items-center gap-1"><button className="btn-outline btn-sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>Previous</button><span className="px-2">Page {page} / {pages}</span><button className="btn-outline btn-sm" disabled={page >= pages} onClick={() => onPage(page + 1)}>Next</button></div>
    </div>
  );
}

// ------------------------------------------------------------------ icons (inline, no dependency)
const PATHS: Record<string, string> = {
  home: 'M3 11l9-8 9 8M5 10v10h5v-6h4v6h5V10',
  file: 'M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8l-5-5zM14 3v5h5M9 13h6M9 17h6',
  plus: 'M12 5v14M5 12h14',
  check: 'M5 13l4 4L19 7',
  x: 'M6 6l12 12M18 6L6 18',
  search: 'M11 4a7 7 0 100 14 7 7 0 000-14zM21 21l-4.3-4.3',
  bell: 'M6 8a6 6 0 1112 0c0 7 3 8 3 8H3s3-1 3-8M10 20a2 2 0 004 0',
  users: 'M16 19v-1a4 4 0 00-4-4H7a4 4 0 00-4 4v1M9.5 10a3.5 3.5 0 100-7 3.5 3.5 0 000 7M21 19v-1a4 4 0 00-3-3.9M16 3.1a3.5 3.5 0 010 6.8',
  building: 'M4 21V5a1 1 0 011-1h9a1 1 0 011 1v16M15 9h4a1 1 0 011 1v11M8 8h3M8 12h3M8 16h3M3 21h18',
  bank: 'M3 10l9-6 9 6M5 10v8M9 10v8M15 10v8M19 10v8M3 21h18',
  chart: 'M4 20V10M10 20V4M16 20v-8M22 20H2',
  settings: 'M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z',
  shield: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3zM9 12l2 2 4-4',
  clock: 'M12 7v5l3 2M12 3a9 9 0 100 18 9 9 0 000-18z',
  download: 'M12 4v11M7 11l5 5 5-5M5 20h14',
  upload: 'M12 16V5M7 9l5-5 5 5M5 20h14',
  inbox: 'M3 13h5l1 3h6l1-3h5M3 13l3-8h12l3 8v6a1 1 0 01-1 1H4a1 1 0 01-1-1v-6z',
  logout: 'M15 4h3a2 2 0 012 2v12a2 2 0 01-2 2h-3M10 17l5-5-5-5M15 12H3',
  menu: 'M4 6h16M4 12h16M4 18h16',
  eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 15a3 3 0 100-6 3 3 0 000 6z',
  lock: 'M6 11V8a6 6 0 1112 0v3M5 11h14v10H5z',
  alert: 'M12 9v4M12 17h.01M10.3 3.9L2.4 18a2 2 0 001.7 3h15.8a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z',
  msg: 'M21 12a8 8 0 01-11.6 7.1L4 20l1-4.6A8 8 0 1121 12z',
  list: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
  book: 'M4 5a2 2 0 012-2h13v16H6a2 2 0 00-2 2V5zM4 19a2 2 0 012-2h13',
  tag: 'M3 12V4a1 1 0 011-1h8l9 9-9 9-9-9zM7.5 7.5h.01',
  sliders: 'M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0M14 4v4M8 10v4M16 16v4',
  db: 'M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3zM4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3',
  refresh: 'M20 11a8 8 0 10-2.3 5.7M20 4v7h-7',
  pen: 'M4 20l4-1 11-11-3-3L5 16l-1 4zM14 6l3 3',
  chevron: 'M9 6l6 6-6 6',
  print: 'M7 9V3h10v6M7 17H4v-6a2 2 0 012-2h12a2 2 0 012 2v6h-3M7 14h10v7H7z',
  copy: 'M9 9h10v12H9zM5 15V3h10',
  play: 'M6 4l14 8-14 8V4z',
  key: 'M14 10a4 4 0 11-2.9 6.8L3 21v-3l3-1 1-2 2-1 .2-.3A4 4 0 0114 10zM16 8h.01',
};
export function Icon({ name, className = 'h-5 w-5' }: { name: string; className?: string }) {
  return <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d={PATHS[name] ?? PATHS.file} /></svg>;
}

// ------------------------------------------------------------------ hooks
export function useAsync<T>(fn: () => Promise<T>, deps: any[]) {
  const [data, setData] = useState<T | null>(null); const [error, setError] = useState<any>(null); const [loading, setLoading] = useState(true);
  const seq = useRef(0);
  const run = useCallback(async () => {
    const id = ++seq.current; setLoading(true);
    try { const d = await fn(); if (id === seq.current) { setData(d); setError(null); } } catch (e) { if (id === seq.current) setError(e); } finally { if (id === seq.current) setLoading(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => { run(); }, [run]);
  return { data, error, loading, reload: run, setData };
}
export function useDebounced<T>(v: T, ms = 300) { const [x, setX] = useState(v); useEffect(() => { const t = setTimeout(() => setX(v), ms); return () => clearTimeout(t); }, [v, ms]); return x; }
