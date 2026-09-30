import nodemailer from 'nodemailer';
import { decryptText } from '../../lib/crypto.js';

export interface SendResult { ok: boolean; ref?: string; response?: any; error?: string; provider: string }

/** ---------- WhatsApp Business API ----------
 *  MOCK          – nothing leaves the server; the message is stored in the outbox (visible in Admin ▸ Message Outbox).
 *  META_CLOUD    – WhatsApp Cloud API (graph.facebook.com). Credentials are read from encrypted server-side settings only.
 *  WEBHOOK       – POSTs {to, text, template, variables} to a BSP / gateway URL with a Bearer token.
 */
export async function sendWhatsApp(cfg: any, msg: { to: string; text: string; vars: Record<string, any> }): Promise<SendResult> {
  const provider = cfg.provider ?? 'MOCK';
  const to = msg.to.replace(/[^\d]/g, '');
  const e164 = to.length === 10 ? `91${to}` : to;
  if (provider === 'MOCK') return { ok: true, provider, ref: `MOCK-WA-${Date.now()}`, response: { note: 'Mock provider – message not sent externally', to: e164 } };
  try {
    const token = cfg.access_token_enc ? decryptText(cfg.access_token_enc) : process.env.WHATSAPP_ACCESS_TOKEN;
    if (!token) return { ok: false, provider, error: 'WhatsApp access token is not configured' };
    if (provider === 'META_CLOUD') {
      if (!cfg.phone_number_id) return { ok: false, provider, error: 'WhatsApp phone number ID is not configured' };
      const body: any = { messaging_product: 'whatsapp', to: e164 };
      if (cfg.template_name) {
        const order = ['pa_no', 'company', 'vendor', 'amount', 'bank', 'approved_by', 'approval_date', 'bank_reference', 'status'];
        body.type = 'template';
        body.template = { name: cfg.template_name, language: { code: cfg.template_language || 'en' },
          components: [{ type: 'body', parameters: order.map((k) => ({ type: 'text', text: String(msg.vars[k] ?? '-') })) }] };
      } else { body.type = 'text'; body.text = { body: msg.text, preview_url: false }; }
      const res = await fetch(`https://graph.facebook.com/${cfg.api_version || 'v20.0'}/${cfg.phone_number_id}/messages`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      const json: any = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, provider, error: json?.error?.message ?? `HTTP ${res.status}`, response: json };
      return { ok: true, provider, ref: json?.messages?.[0]?.id, response: json };
    }
    if (provider === 'WEBHOOK') {
      if (!cfg.webhook_url) return { ok: false, provider, error: 'Webhook URL is not configured' };
      const res = await fetch(cfg.webhook_url, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: e164, text: msg.text, template: cfg.template_name || undefined, variables: msg.vars }) });
      const txt = await res.text();
      return res.ok ? { ok: true, provider, ref: `HTTP-${res.status}`, response: { body: txt.slice(0, 500) } } : { ok: false, provider, error: `HTTP ${res.status}`, response: { body: txt.slice(0, 500) } };
    }
    return { ok: false, provider, error: `Unknown WhatsApp provider ${provider}` };
  } catch (e: any) {
    return { ok: false, provider, error: e.message };
  }
}

/** ---------- E-mail ---------- */
export async function sendEmail(cfg: any, msg: { to: string; subject: string; text: string; html: string }): Promise<SendResult> {
  const provider = cfg.provider ?? 'MOCK';
  if (provider === 'MOCK') return { ok: true, provider, ref: `MOCK-MAIL-${Date.now()}`, response: { note: 'Mock provider – e-mail not sent externally' } };
  try {
    const pass = cfg.pass_enc ? decryptText(cfg.pass_enc) : process.env.SMTP_PASSWORD;
    const transport = nodemailer.createTransport({ host: cfg.host, port: Number(cfg.port) || 587, secure: !!cfg.secure, auth: cfg.user ? { user: cfg.user, pass } : undefined });
    const info = await transport.sendMail({ from: `"${cfg.from_name}" <${cfg.from_email}>`, to: msg.to, subject: msg.subject, text: msg.text, html: msg.html });
    return { ok: true, provider, ref: info.messageId, response: { accepted: info.accepted } };
  } catch (e: any) {
    return { ok: false, provider, error: e.message };
  }
}

/** ---------- SMS (future integration) ---------- */
export async function sendSms(cfg: any, msg: { to: string; text: string }): Promise<SendResult> {
  const provider = cfg.provider ?? 'MOCK';
  if (provider === 'MOCK') return { ok: true, provider, ref: `MOCK-SMS-${Date.now()}`, response: { note: 'Mock provider – SMS gateway is a Future Integration' } };
  return { ok: false, provider, error: 'SMS gateway integration is not implemented yet (Future Integration)' };
}
