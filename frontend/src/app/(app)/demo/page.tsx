'use client';

import { useEffect, useMemo, useState } from 'react';
import { Quorum } from '@/components/Quorum';
import { Card, PageHeader, SimTag, StatusPill, usd } from '@/components/ui';
import { useStore } from '@/lib/store';

const proves: Record<string, string> = {
  A: 'Normal path works end to end.',
  B: 'Duplicate defense in two layers: Sentinel, then the on-chain paid set.',
  C: 'Wallet-swap fraud is held by cooling-off and challenge.',
  D: 'Prompt injection in invoice text is read as data and never followed.',
  E: 'Bounded autonomy: a human signs above the limit.',
};

const stepLabels = ['Invoice in', 'Reader', 'Verifier', 'Matcher', 'Sentinel', 'Treasurer', 'Contract', 'Outcome'];

export default function Demo() {
  const { invoices, loading } = useStore();
  // One row per case, from the live agent results (the most recent run of that sample wins).
  const cases = useMemo(() => {
    const seen = new Map<string, (typeof invoices)[number]>();
    for (const i of invoices) if (i.caseId && !seen.has(i.caseId)) seen.set(i.caseId, i);
    return [...seen.values()].sort((a, b) => a.caseId!.localeCompare(b.caseId!));
  }, [invoices]);

  const [caseId, setCaseId] = useState<string>('A');
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(false);

  const inv = cases.find((c) => c.caseId === caseId) ?? cases[0];
  const last = stepLabels.length - 1;

  useEffect(() => {
    if (!playing) return;
    if (step >= last) { setPlaying(false); return; }
    const t = setTimeout(() => setStep((s) => s + 1), 1100);
    return () => clearTimeout(t);
  }, [playing, step, last]);

  const pick = (id: string) => { setCaseId(id); setStep(0); setPlaying(false); };
  // Step 1-5 reveal one attestation each; step 6 (Contract) also reveals the rules.
  const reveal = Math.min(step, 6);
  const done = step >= last;

  if (!inv) {
    return (
      <>
        <PageHeader eyebrow="Five scripted cases" title="Watch the contract hold on every attack." />
        <Card><p className="text-ink/60">{loading ? 'The agents are reading the five demo invoices…' : 'No demo cases found. Use "Reset demo" in the invoice inbox.'}</p></Card>
      </>
    );
  }

  const outcome =
    inv.decision === 'READY' ? 'All five agents signed PASS, so the contract would release the payment and a receipt would be written.'
    : inv.decision === 'NEEDS_HUMAN' ? 'All agents passed, but the contract holds: the amount is above the limit and needs a human signature.'
    : 'The contract would hold the payment and route it to a human. Nothing moves.';

  return (
    <>
      <PageHeader
        eyebrow="Five scripted cases"
        title="Watch the contract hold on every attack."
        sub="These are the real agents' verdicts on five scripted invoices, replayed step by step: the five attestations, then what the eight contract rules would do."
      />

      <div className="mb-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
        {cases.map((c) => (
          <button
            key={c.caseId}
            type="button"
            onClick={() => pick(c.caseId!)}
            className={`border p-4 text-left transition-colors ${caseId === c.caseId ? 'border-ink bg-ink text-opal' : 'border-ink/15 bg-white hover:border-ink'}`}
          >
            <span className="font-mono text-[11px] uppercase tracking-[0.08em] opacity-70">Case {c.caseId}</span>
            <p className="mt-1 font-semibold leading-snug">{c.vendor}</p>
            <p className="mt-1 text-[13px] opacity-70">{usd(c.amount)} USDC</p>
          </button>
        ))}
      </div>

      <Card className="mb-4">
        <div className="flex flex-col justify-between gap-5 lg:flex-row lg:items-center">
          <div>
            <p className="eyebrow">{inv.id} · proves</p>
            <h2 className="h3 mt-2">{inv.headline}</h2>
            <p className="mt-2 text-ink/70">{proves[caseId]}</p>
            {inv.injectedText && (
              <p className="mt-3 max-w-2xl border-l-2 border-[#b4443f] bg-[#b4443f]/5 p-3 font-mono text-[12px]">
                Untrusted invoice text: “{inv.injectedText}”
              </p>
            )}
          </div>
          <div className="flex shrink-0 gap-2">
            <button type="button" className="btn-solid" onClick={() => { if (done) setStep(0); setPlaying((p) => !p); }}>
              {playing ? 'Pause' : done ? 'Replay' : step === 0 ? 'Play' : 'Resume'}
            </button>
            <button type="button" className="btn-ghost" disabled={playing || done} onClick={() => setStep((s) => Math.min(s + 1, last))}>
              Next step
            </button>
          </div>
        </div>

        <ol className="mt-6 grid grid-cols-4 gap-1 sm:grid-cols-8">
          {stepLabels.map((l, i) => (
            <li key={l} className={`border-t-2 pt-2 font-mono text-[11px] ${i <= step ? 'border-violet text-ink' : 'border-ink/15 text-cement'}`}>
              {l}
            </li>
          ))}
        </ol>
      </Card>

      <Quorum inv={inv} reveal={reveal} />

      {done && (
        <Card className="mt-4 !border-violet bg-violet/5">
          <div className="flex flex-wrap items-center gap-3">
            <p className="eyebrow">Outcome</p>
            <StatusPill s={inv.status} />{inv.simulated && <SimTag />}
          </div>
          <p className="mt-2 text-[16px]">{outcome}</p>
          {caseId === 'B' && (
            <p className="mt-2 text-ink/70">
              Even if someone sends a direct second payment for INV-1041’s hash, rule 7 rejects it: the paid set already contains it.
            </p>
          )}
          {caseId === 'A' && <p className="mt-2 font-mono text-[12px] text-cement">Recorded as paid in the demo ledger. No chain transaction exists yet.</p>}
        </Card>
      )}
    </>
  );
}
