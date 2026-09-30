import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api, setCsrf, setUnauthorisedHandler } from './api';

export interface Me {
  user: { id: number; loginId: string; name: string; email: string; mobile?: string; employeeCode?: string; roleCode: string; roles: string[]; isSuperAdmin: boolean; isSeniorApprover: boolean; canViewFullAccount: boolean; canOverrideDuplicate: boolean; twoFactorEnabled: boolean; mustChangePassword: boolean };
  permissions: string[]; csrfToken: string; app: { demoMode: boolean; orgName: string }; idleMinutes: number; statuses: { code: string; label: string; color: string; sort_order: number }[]; unread: number;
}
interface Ctx { me: Me | null; loading: boolean; refresh: () => Promise<void>; logout: (reason?: string) => Promise<void>; can: (p: string) => boolean; hasRole: (...r: string[]) => boolean; statusMap: Record<string, { label: string; color: string }>; notice: string; }
const AuthCtx = createContext<Ctx>(null as any);
export const useAuth = () => useContext(AuthCtx);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null); const [loading, setLoading] = useState(true); const [notice, setNotice] = useState('');
  const refresh = useCallback(async () => {
    try { const m = await api.get<Me>('/auth/me'); setCsrf(m.csrfToken); setMe(m); } catch { setMe(null); } finally { setLoading(false); }
  }, []);
  useEffect(() => { refresh(); }, [refresh]);
  const logout = useCallback(async (reason?: string) => {
    try { await api.post('/auth/logout'); } catch { /* ignore */ }
    setMe(null); setNotice(reason ?? '');
  }, []);
  useEffect(() => { setUnauthorisedHandler(() => { setMe((m) => { if (m) setNotice('Your session has expired. Please sign in again.'); return null; }); }); }, []);
  // idle timeout (server enforces too)
  const last = useRef(Date.now());
  useEffect(() => {
    if (!me) return;
    const bump = () => { last.current = Date.now(); };
    const evs = ['mousemove', 'keydown', 'click', 'touchstart'];
    evs.forEach((e) => window.addEventListener(e, bump, { passive: true }));
    const t = setInterval(() => { if (Date.now() - last.current > me.idleMinutes * 60000) logout('You were signed out after a period of inactivity.'); }, 30000);
    return () => { evs.forEach((e) => window.removeEventListener(e, bump)); clearInterval(t); };
  }, [me, logout]);
  const value = useMemo<Ctx>(() => {
    const perms = new Set(me?.permissions ?? []);
    const sm: Record<string, { label: string; color: string }> = {}; (me?.statuses ?? []).forEach((s) => { sm[s.code] = { label: s.label, color: s.color }; });
    return { me, loading, refresh, logout, notice, can: (p) => perms.has(p), hasRole: (...r) => !!me && r.some((x) => me.user.roles.includes(x)), statusMap: sm };
  }, [me, loading, refresh, logout, notice]);
  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}
