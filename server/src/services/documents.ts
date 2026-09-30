import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from '../config.js';
import { decryptBuffer, encryptBuffer, sha256 } from '../lib/crypto.js';
import { badRequest, notFound } from '../lib/errors.js';
import { getSetting } from './settings.js';
import { audit, type Ctx } from './audit.js';
import { fmtDateTime } from '../lib/format.js';

const MIME: Record<string, string> = {
  pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
  xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

function signatureOk(ext: string, buf: Buffer): boolean {
  const h = buf.subarray(0, 8);
  switch (ext) {
    case 'pdf': return buf.subarray(0, 5).toString() === '%PDF-';
    case 'png': return h[0] === 0x89 && h[1] === 0x50 && h[2] === 0x4e && h[3] === 0x47;
    case 'jpg': case 'jpeg': return h[0] === 0xff && h[1] === 0xd8;
    case 'xlsx': case 'docx': return h[0] === 0x50 && h[1] === 0x4b;               // ZIP container
    case 'xls': case 'doc': return h[0] === 0xd0 && h[1] === 0xcf && h[2] === 0x11 && h[3] === 0xe0; // OLE2
    default: return false;
  }
}
const cleanName = (n: string) => n.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').slice(0, 180);

export async function storeDocument(ctx: Ctx, paymentId: number, file: { originalname: string; buffer: Buffer }, meta: { doc_type: string; doc_name?: string; replaces_id?: number; payment_version_no: number }) {
  const cfg = await getSetting<{ max_file_mb: number; allowed_extensions: string[] }>('documents');
  const original = cleanName(file.originalname);
  const ext = path.extname(original).slice(1).toLowerCase();
  if (!cfg.allowed_extensions.includes(ext)) throw badRequest(`File type .${ext || '?'} is not allowed. Allowed: ${cfg.allowed_extensions.join(', ')}.`);
  if (file.buffer.length === 0) throw badRequest('The uploaded file is empty.');
  if (file.buffer.length > cfg.max_file_mb * 1024 * 1024) throw badRequest(`File is larger than the ${cfg.max_file_mb} MB limit.`);
  if (!signatureOk(ext, file.buffer)) throw badRequest(`The file content does not match its .${ext} extension.`);

  const key = path.join(String(ctx.now.getUTCFullYear()), String(ctx.now.getUTCMonth() + 1).padStart(2, '0'), crypto.randomBytes(16).toString('hex') + '.enc');
  const abs = path.join(config.storageDir, key);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, encryptBuffer(file.buffer), { mode: 0o600 });

  let version = 1; let groupId: number | null = null;
  if (meta.replaces_id) {
    const old = (await ctx.db.query('SELECT * FROM payment_documents WHERE id=$1 AND payment_id=$2', [meta.replaces_id, paymentId])).rows[0];
    if (!old) throw notFound('The document to replace was not found.');
    version = old.version + 1; groupId = old.group_id ?? old.id;
    await ctx.db.query(`UPDATE payment_documents SET status='SUPERSEDED' WHERE id=$1`, [old.id]);
  }
  const ins = await ctx.db.query(
    `INSERT INTO payment_documents(payment_id,group_id,version,doc_name,doc_type,original_filename,storage_key,mime_type,size_bytes,sha256,status,payment_version_no,uploaded_by,uploaded_at)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'ACTIVE',$11,$12,$13) RETURNING *`,
    [paymentId, groupId, version, meta.doc_name?.trim() || original, meta.doc_type, original, key, MIME[ext], file.buffer.length, sha256(file.buffer), meta.payment_version_no, ctx.user!.id, ctx.now]);
  const doc = ins.rows[0];
  if (!doc.group_id) await ctx.db.query('UPDATE payment_documents SET group_id=id WHERE id=$1', [doc.id]);
  await audit(ctx, { action: meta.replaces_id ? 'DOCUMENT_VERSION_UPLOADED' : 'DOCUMENT_UPLOADED', entityType: 'document', entityId: doc.id, paymentId,
    new: { name: doc.doc_name, type: doc.doc_type, version, size: doc.size_bytes, sha256: doc.sha256, file: original }, remarks: `${ctx.user!.name} uploaded ${doc.doc_name} (v${version}) at ${fmtDateTime(ctx.now)}` });
  return { ...doc, group_id: doc.group_id ?? doc.id };
}

export async function readDocument(doc: { storage_key: string }): Promise<Buffer> {
  const blob = await fs.readFile(path.join(config.storageDir, doc.storage_key));
  return decryptBuffer(blob);
}
