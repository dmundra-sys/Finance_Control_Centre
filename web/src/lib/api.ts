export class ApiError extends Error {
  status: number; code?: string; details?: any;
  constructor(status: number, message: string, code?: string, details?: any) { super(message); this.status = status; this.code = code; this.details = details; }
}
let csrf = '';
export const setCsrf = (t: string) => { csrf = t; };
let onUnauthorised: (() => void) | null = null;
export const setUnauthorisedHandler = (fn: () => void) => { onUnauthorised = fn; };

async function req<T = any>(method: string, url: string, body?: any, isForm = false): Promise<T> {
  const headers: Record<string, string> = {};
  if (method !== 'GET') headers['X-CSRF-Token'] = csrf;
  if (body !== undefined && !isForm) headers['Content-Type'] = 'application/json';
  let res: Response;
  try {
    res = await fetch('/api' + url, { method, headers, credentials: 'same-origin', body: body === undefined ? undefined : isForm ? body : JSON.stringify(body) });
  } catch { throw new ApiError(0, 'Cannot reach the server. Check your connection and try again.'); }
  const ct = res.headers.get('content-type') ?? '';
  const data = ct.includes('json') ? await res.json().catch(() => null) : null;
  if (!res.ok) {
    if (res.status === 401 && !url.startsWith('/auth/login')) onUnauthorised?.();
    throw new ApiError(res.status, data?.error ?? `Request failed (${res.status}).`, data?.code, data?.details ?? data?.fields);
  }
  return (data ?? ({} as any)) as T;
}
export const api = {
  get: <T = any>(url: string, params?: Record<string, any>) => req<T>('GET', url + qs(params)),
  post: <T = any>(url: string, body?: any) => req<T>('POST', url, body ?? {}),
  put: <T = any>(url: string, body?: any) => req<T>('PUT', url, body ?? {}),
  del: <T = any>(url: string) => req<T>('DELETE', url),
  upload: <T = any>(url: string, form: FormData) => req<T>('POST', url, form, true),
  url: (url: string, params?: Record<string, any>) => '/api' + url + qs(params),
};
export function qs(params?: Record<string, any>) {
  if (!params) return '';
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  const s = p.toString(); return s ? '?' + s : '';
}
export async function download(url: string, filename: string) {
  const res = await fetch(url, { credentials: 'same-origin' });
  if (!res.ok) { const d = await res.json().catch(() => null); throw new ApiError(res.status, d?.error ?? 'Download failed.'); }
  const blob = await res.blob(); const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = filename; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
export const errMsg = (e: any) => (e instanceof ApiError ? e.message : e?.message ?? 'Something went wrong.');
