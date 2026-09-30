import type { AddressInfo } from 'node:net';
import type http from 'node:http';

export class Client {
  cookie = ''; csrf = '';
  constructor(public base: string, public name = '') {}
  async raw(method: string, path: string, body?: any, extraHeaders: Record<string, string> = {}) {
    const isForm = typeof FormData !== 'undefined' && body instanceof FormData;
    const res = await fetch(this.base + path, { method, headers: { ...(isForm ? {} : body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(this.cookie ? { Cookie: this.cookie } : {}), ...(this.csrf ? { 'X-CSRF-Token': this.csrf } : {}), 'User-Agent': `E2E-${this.name}`, ...extraHeaders },
      body: body === undefined ? undefined : isForm ? body : JSON.stringify(body) });
    const sc = res.headers.get('set-cookie'); if (sc) { const m = sc.match(/pawf_sid=([^;]*)/); if (m) this.cookie = m[1] ? `pawf_sid=${m[1]}` : ''; }
    return res;
  }
  async req(method: string, path: string, body?: any) {
    const res = await this.raw(method, path, body);
    const ct = res.headers.get('content-type') ?? '';
    const json = ct.includes('json') ? await res.json() : null;
    return { status: res.status, json, res };
  }
  get(p: string) { return this.req('GET', p); }
  post(p: string, b: any = {}) { return this.req('POST', p, b); }
  put(p: string, b: any = {}) { return this.req('PUT', p, b); }
  del(p: string) { return this.req('DELETE', p); }
  async login(userId: string, password = 'Demo@12345', extra: any = {}) {
    const r = await this.post('/api/auth/login', { userId, password, ...extra });
    if (r.status === 200 && r.json?.ok) { const me = await this.get('/api/auth/me'); this.csrf = me.json.csrfToken; this.name = userId; return me.json; }
    return r;
  }
  async upload(paymentId: number, name = 'invoice.pdf', opts: { type?: string; content?: Buffer; replaces_id?: number; docType?: string } = {}) {
    const fd = new FormData();
    fd.append('file', new Blob([opts.content ?? Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF')], { type: opts.type ?? 'application/pdf' }), name);
    fd.append('doc_type', opts.docType ?? 'Invoice');
    if (opts.replaces_id) fd.append('replaces_id', String(opts.replaces_id));
    const res = await this.raw('POST', `/api/payments/${paymentId}/documents`, fd);
    return { status: res.status, json: await res.json().catch(() => null) as any };
  }
}
export const listen = (app: http.RequestListener | any): Promise<{ server: http.Server; base: string }> => new Promise((resolve) => {
  const server = app.listen(0, () => resolve({ server, base: `http://127.0.0.1:${(server.address() as AddressInfo).port}` }));
});
