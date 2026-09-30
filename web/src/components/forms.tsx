import { useState, type ReactNode } from 'react';
import { errMsg } from '../lib/api';
import { Btn, Modal, useToast } from './ui';

/** Generic modal form wrapper: handles busy state, inline error and toast. */
export function FormModal({ open, onClose, title, size = 'md', children, submitLabel = 'Save', onSubmit, danger, extra }: { open: boolean; onClose: () => void; title: string; size?: 'sm' | 'md' | 'lg' | 'xl'; children: ReactNode; submitLabel?: string; onSubmit: () => Promise<string | void>; danger?: boolean; extra?: ReactNode }) {
  const [busy, setBusy] = useState(false); const [err, setErr] = useState(''); const toast = useToast();
  if (!open) return null;
  return (
    <Modal open onClose={onClose} title={title} size={size} footer={<>{extra}<button className="btn-outline" onClick={onClose}>Cancel</button><Btn busy={busy} className={danger ? 'btn-red' : 'btn-primary'} onClick={async () => { setBusy(true); setErr(''); try { const m = await onSubmit(); if (m) toast.ok(m); } catch (e) { setErr(errMsg(e)); } finally { setBusy(false); } }}>{submitLabel}</Btn></>}>
      <form onSubmit={(e) => e.preventDefault()} className="space-y-3">{children}</form>
      {err && <div role="alert" className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{err}</div>}
    </Modal>
  );
}
export const yesNo = (v: boolean) => (v ? 'Yes' : 'No');
