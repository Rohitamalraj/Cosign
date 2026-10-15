'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/store';
import { Card } from './ui';

interface Kind { kind: string; label: string; needs: 'paid' | 'unpaid'; help: string }
interface Effect { role: string; agentId: number; scoreDelta: number; slashMicro: string; reason: string; tx?: string; error?: string }
interface Outcome { id: number; kind: string; note: string; reporter: string; effects: Effect[]; createdAt: string }

/**
 * Tell the Auditor what really happened. It changes agent scores (and slashes a bond on a payment that should not have
 * been made) on-chain, once per invoice, so the agents' record comes from a person's judgment, not from a script.
 */
export function OutcomePanel({ uid, paid, canReport }: { uid: string; paid: boolean; canReport: boolean }) {
  const [kinds, setKinds] = useState<Kind[]>([]);
  const [outcomes, setOutcomes] = useState<Outcome[]>([]);
  const [kind, setKind] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = async () => {
    try {
      const r = await api<{ outcomes: Outcome[]; kinds: Kind[] }>(`/api/invoices/${encodeURIComponent(uid)}/outcome`);
      setOutcomes(r.outcomes);
      setKinds(r.kinds);
    } catch { /* not allowed or not found: show nothing */ }
  };
  useEffect(() => { void load(); setKind(''); setErr(null); }, [uid]); // eslint-disable-line react-hooks/exhaustive-deps

  const choices = kinds.filter((k) => (paid ? k.needs === 'paid' : k.needs === 'unpaid'));
  const done = outcomes[0];

  async function submit() {
    setBusy(true);
    setErr(null);
    try {
      await api(`/api/invoices/${encodeURIComponent(uid)}/outcome`, { method: 'POST', body: JSON.stringify({ kind, note }) });
      setNote('');
      await load();
    } catch (e) { setErr(e instanceof Error ? e.message : 'could not record the outcome'); }
    finally { setBusy(false); }
  }

  return (
    <Card className="mt-4">
      <h2 className="h2">What really happened? (the Auditor)</h2>
      {done ? (
        <div className="mt-3">
          <p className="text-[14px]">Reported: <b>{kinds.find((k) => k.kind === done.kind)?.label ?? done.kind}</b>{done.note && <span className="text-ink/60"> · “{done.note}”</span>}</p>
          <ul className="mt-3 space-y-1.5">
            {done.effects.map((e) => (
              <li key={e.role} className="grid gap-1 text-[13px] sm:grid-cols-[110px_80px_1fr]">
                <span className="font-mono text-[12px] uppercase">{e.role}</span>
                <span className={`font-mono ${e.scoreDelta >= 0 ? 'text-[#2c6b57]' : 'text-[#8e2e2a]'}`}>{e.scoreDelta > 0 ? '+' : ''}{e.scoreDelta}{BigInt(e.slashMicro) > 0n ? ` · −${Number(e.slashMicro) / 1e6} USDC` : ''}</span>
                <span className="text-ink/65">
                  {e.reason}
                  {e.tx && <> · <a className="text-violet underline" href={`https://explorer.testnet.arc.io/tx/${e.tx}`} target="_blank" rel="noreferrer">on-chain</a></>}
                  {e.error && <span className="text-[#8e2e2a]"> · not written: {e.error}</span>}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : canReport ? (
        <>
          <p className="mt-1 text-[13px] text-ink/60">
            {paid ? 'This invoice was paid. Was it right? Your answer moves agent reputation on-chain.' : 'This invoice was not paid. Was holding it right? Your answer moves agent reputation on-chain.'} You can report once.
          </p>
          <div className="mt-3 grid gap-2">
            {choices.map((c) => (
              <label key={c.kind} className={`flex cursor-pointer items-start gap-2 border p-3 text-[13px] ${kind === c.kind ? 'border-ink bg-white' : 'border-ink/15 hover:border-ink/50'}`}>
                <input type="radio" name="outcome" className="mt-1" checked={kind === c.kind} onChange={() => setKind(c.kind)} />
                <span><b>{c.label}</b><span className="block text-ink/60">{c.help}</span></span>
              </label>
            ))}
          </div>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={300}
            placeholder="Optional note (what you saw)"
            className="mt-3 w-full border border-ink/20 bg-opal p-2 text-[13px] outline-none focus:border-violet"
            aria-label="Note"
          />
          <div className="mt-3 flex items-center gap-3">
            <button type="button" className="btn-solid" disabled={!kind || busy} onClick={() => void submit()}>{busy ? 'Writing to the chain…' : 'Report to the Auditor'}</button>
            {err && <p role="alert" className="text-[13px] text-[#8e2e2a]">{err}</p>}
          </div>
        </>
      ) : (
        <p className="mt-2 text-[13px] text-ink/60">Only operators and admins can report an outcome.</p>
      )}
    </Card>
  );
}
