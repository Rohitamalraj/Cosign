'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/store';
import { Card } from './ui';

interface Item {
  id: number; channel: string; fromAddr: string; subject: string; text: string; ocr: boolean;
  status: 'new' | 'processed' | 'dismissed' | 'failed'; invoiceUid: string | null; error: string | null; createdAt: string;
}

const TONE: Record<Item['status'], string> = {
  new: 'border-citrine/60 bg-sand/30 text-[#7a5a14]', processed: 'border-jade/70 bg-jade/15 text-[#2c6b57]',
  dismissed: 'border-ink/20 text-cement', failed: 'border-[#b4443f]/60 bg-[#b4443f]/10 text-[#8e2e2a]',
};
const LABEL: Record<Item['status'], string> = { new: 'needs your check', processed: 'run through the agents', dismissed: 'dismissed', failed: 'could not be read' };

/**
 * Invoices that arrived by email. Text PDFs and plain bodies are run through the agents automatically (they appear in the
 * list below as invoices). A scan read by OCR waits here: you check the text, fix any misread digit, and run it yourself.
 */
export function IntakePanel({ onLoad, onOpen, refreshKey }: { onLoad: (text: string, id: number) => void; onOpen: (uid: string) => void; refreshKey: number }) {
  const [items, setItems] = useState<Item[]>([]);
  const [configured, setConfigured] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const load = async () => {
    try {
      const r = await api<{ items: Item[]; configured: boolean }>('/api/intake');
      setItems(r.items);
      setConfigured(r.configured);
    } catch (e) { setErr(e instanceof Error ? e.message : 'could not load the inbox'); }
  };
  useEffect(() => { void load(); }, [refreshKey]); // eslint-disable-line react-hooks/exhaustive-deps

  async function dismiss(id: number) {
    try { await api(`/api/intake/${id}`, { method: 'POST', body: JSON.stringify({ action: 'dismiss' }) }); await load(); }
    catch (e) { setErr(e instanceof Error ? e.message : 'could not dismiss'); }
  }

  const open = items.filter((i) => i.status === 'new' || i.status === 'failed');

  return (
    <Card className="mb-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="h2">Email inbox</h2>
        <span className="font-mono text-[12px] text-ink/55">{open.length} waiting · {items.length} received</span>
      </div>
      {!configured && (
        <p className="mt-2 text-[13px] text-ink/65">
          Email intake is off on this server. Set <span className="font-mono">COSIGN_INBOUND_TOKEN</span> (16+ random characters) and point your mail provider’s inbound webhook at
          <span className="font-mono"> /api/intake/email</span> (see docs/EMAIL-INTAKE.md).
        </p>
      )}
      {err && <p role="alert" className="mt-2 text-[13px] text-[#8e2e2a]">{err}</p>}
      {items.length === 0 ? (
        <p className="mt-2 text-[13px] text-ink/55">{configured ? 'No email received yet.' : ''}</p>
      ) : (
        <ul className="mt-3 divide-y divide-ink/10">
          {items.slice(0, 8).map((i) => (
            <li key={i.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
              <div className="min-w-0">
                <p className="truncate font-semibold">{i.subject || '(no subject)'}</p>
                <p className="font-mono text-[12px] text-ink/60">{i.fromAddr} · {new Date(i.createdAt).toLocaleString()}</p>
                {i.error && <p className="mt-1 text-[12px] text-[#8e2e2a]">{i.error}</p>}
                {i.status === 'new' && i.ocr && <p className="mt-1 text-[12px] text-ink/65">An attachment was read by OCR. Check the text before running the agents.</p>}
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-2">
                <span className={`border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.06em] ${TONE[i.status]}`}>{LABEL[i.status]}</span>
                {i.status === 'new' && <button type="button" className="btn-ghost !px-3 !py-1.5 text-[12px]" onClick={() => onLoad(i.text, i.id)}>Check and run</button>}
                {i.status === 'processed' && i.invoiceUid && <button type="button" className="text-[12px] text-violet underline" onClick={() => onOpen(i.invoiceUid!)}>Open invoice</button>}
                {(i.status === 'new' || i.status === 'failed') && <button type="button" className="text-[12px] text-ink/55 underline" onClick={() => void dismiss(i.id)}>Dismiss</button>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
