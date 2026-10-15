'use client';

import { useEffect, useMemo, useState } from 'react';
import { Quorum } from '@/components/Quorum';
import { Card, PageHeader, StatusPill, usd } from '@/components/ui';
import { useStore } from '@/lib/store';

const proves: Record<string, string> = {
  A: 'Normal path works end to end.',
  B: 'Duplicate defense in two layers: Sentinel, then the on-chain paid set. (Needs example A to have been paid first.)',
  C: 'Wallet-swap fraud is held by cooling-off and challenge.',
  D: 'Prompt injection in invoice text is read as data and never followed.',
  E: 'Bounded autonomy: a human signs above the limit.',
  F: 'Cross-chain: all five agents sign the destination, and the contract burns USDC on Arc for a mint on Base through CCTP.',
  G: 'Chain swap: a vendor registered for Arc asks to be paid on another chain, and the Verifier holds it.',
};

const stepLabels = ['Invoice in', 'Reader', 'Verifier', 'Matcher', 'Sentinel', 'Treasurer', 'Contract', 'Outcome'];

interface Sample { id: string; title: string; text: string }

/**
 * Seven example invoices we wrote, including the attacks. They are INPUTS: nothing here is pre-recorded. Press Run and
 * the real agents sign and the real contract is asked; then replay the result step by step.
 */
export default function Demo() {
  const { invoices, session, status, submit, signIn } = useStore();
  const [samples, setSamples] = useState<Sample[]>([]);
  const [caseId, setCaseId] = useState<string>('A');
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => { fetch('/api/samples').then((r) => r.json()).then((b) => setSamples(b.samples ?? [])).catch(() => undefined); }, []);

  const results = useMemo(() => {
    const m = new Map<string, (typeof invoices)[number]>();
    for (const i of invoices) if (i.caseId && !m.has(i.caseId)) m.set(i.caseId, i);
    return m;
  }, [invoices]);

  const inv = results.get(caseId);
  const last = stepLabels.length - 1;

  useEffect(() => {
    if (!playing) return;
    if (step >= last) { setPlaying(false); return; }
    const t = setTimeout(() => setStep((s) => s + 1), 1100);
    return () => clearTimeout(t);
  }, [playing, step, last]);

  const pick = (id: string) => { setCaseId(id); setStep(0); setPlaying(false); };
  const reveal = Math.min(step, 6);
  const done = step >= last;

  async function run(id: string) {
    const s = samples.find((x) => x.id === id);
    if (!s) return;
    setBusy(id);
    setErr(null);
    try { await submit(s.text); pick(id); }
    catch (e) { setErr(e instanceof Error ? e.message : 'could not run the example'); }
    finally { setBusy(null); }
  }

  const outcome = !inv ? ''
    : inv.status === 'released' ? 'Paid. The contract released the payment and a receipt was written.'
    : inv.status === 'ready' ? 'All five agents signed PASS and the contract would release the payment now.'
    : inv.status === 'escalated' && inv.ruleOverrides[6] === 'wait' ? 'All agents passed, but the contract holds: the amount is above the limit and needs the approver’s signature.'
    : 'The contract holds the payment and routes it to a human. Nothing moves.';

  return (
    <>
      <PageHeader
        eyebrow="Seven example invoices"
        title="Watch the contract hold on every attack."
        sub="We wrote seven invoices, including the attacks. Press Run on any of them: the real agents sign through Circle wallets and the real contract answers. Then replay the verdicts and the eight rules step by step."
      />

      {!session && <Card className="mb-4"><p className="text-ink/70">Sign in with your wallet to run the examples.</p><button type="button" className="btn-solid mt-3" onClick={() => void signIn().catch((e) => setErr(e.message))}>Sign in with wallet</button></Card>}
      {status?.mode === 'live' && (
        <p className="mb-4 border border-ink/15 bg-white p-3 text-[13px] text-ink/70">
          Examples use the vendors in the ledger. Examples A to G match the vendors we registered for the first run; if your ledger does not have them, the Verifier will correctly hold the example. That is the system working, not a bug.
        </p>
      )}
      {err && <p role="alert" className="mb-4 border border-[#b4443f]/60 bg-[#b4443f]/10 p-3 text-[#8e2e2a]">{err}</p>}

      <div className="mb-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
        {samples.map((s) => {
          const r = results.get(s.id);
          return (
            <div key={s.id} className={`border p-4 text-left ${caseId === s.id ? 'border-ink bg-ink text-opal' : 'border-ink/15 bg-white'}`}>
              <button type="button" onClick={() => pick(s.id)} className="block w-full text-left">
                <span className="font-mono text-[11px] uppercase tracking-[0.08em] opacity-70">Example {s.id}</span>
                <p className="mt-1 font-semibold leading-snug">{s.title}</p>
                <p className="mt-1 text-[13px] opacity-70">{r ? `${usd(r.amount)} USDC · ${r.status}` : 'not run yet'}</p>
              </button>
              {session && <button type="button" disabled={busy !== null} onClick={() => void run(s.id)} className={`mt-2 border px-2 py-1 font-mono text-[11px] ${caseId === s.id ? 'border-opal/50' : 'border-ink/30 hover:border-ink'}`}>{busy === s.id ? 'Running…' : r ? 'Run again' : 'Run'}</button>}
            </div>
          );
        })}
      </div>

      {!inv ? (
        <Card><p className="text-ink/60">{session ? `Press Run on example ${caseId} to see the agents’ verdicts.` : 'Sign in, then run an example.'}</p></Card>
      ) : (
        <>
          <Card className="mb-4">
            <div className="flex flex-col justify-between gap-5 lg:flex-row lg:items-center">
              <div>
                <p className="eyebrow">{inv.id} · proves</p>
                <h2 className="h3 mt-2">{inv.headline}</h2>
                <p className="mt-2 text-ink/70">{proves[caseId]}</p>
                {inv.injectedText && <p className="mt-3 max-w-2xl border-l-2 border-[#b4443f] bg-[#b4443f]/5 p-3 font-mono text-[12px]">Untrusted invoice text: “{inv.injectedText}”</p>}
              </div>
              <div className="flex shrink-0 gap-2">
                <button type="button" className="btn-solid" onClick={() => { if (done) setStep(0); setPlaying((p) => !p); }}>{playing ? 'Pause' : done ? 'Replay' : step === 0 ? 'Play' : 'Resume'}</button>
                <button type="button" className="btn-ghost" disabled={playing || done} onClick={() => setStep((s) => Math.min(s + 1, last))}>Next step</button>
              </div>
            </div>
            <ol className="mt-6 grid grid-cols-4 gap-1 sm:grid-cols-8">
              {stepLabels.map((l, i) => <li key={l} className={`border-t-2 pt-2 font-mono text-[11px] ${i <= step ? 'border-violet text-ink' : 'border-ink/15 text-cement'}`}>{l}</li>)}
            </ol>
          </Card>

          <Quorum inv={inv} reveal={reveal} />

          {done && (
            <Card className="mt-4 !border-violet bg-violet/5">
              <div className="flex flex-wrap items-center gap-3"><p className="eyebrow">Outcome</p><StatusPill s={inv.status} /></div>
              <p className="mt-2 text-[16px]">{outcome}</p>
              {caseId === 'B' && <p className="mt-2 text-ink/70">Even if someone sends a direct second payment for the original invoice’s hash, rule 7 rejects it: the paid set already contains it.</p>}
            </Card>
          )}
        </>
      )}
    </>
  );
}
