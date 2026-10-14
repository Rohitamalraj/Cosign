'use client';

import Link from 'next/link';
import { Card, PageHeader } from '@/components/ui';
import { EXPLORER, ROLE_NAMES, useArc } from '@/lib/useArc';

const JOBS = [
  'Turn an invoice into structured data',
  'Confirm the counterparty and destination wallet',
  'Check the invoice against the contract or PO',
  'Catch duplicates, near-duplicates and anomalies',
  'Choose when to pay',
];

/** The three roles that are not built, so they have no score. Stated plainly instead of showing invented numbers. */
const NOT_BUILT = [
  { name: 'Executor', job: 'Sends the payment the contract releases. Built and tested; it has no score because it never gives a verdict.', note: 'Only role that can spend, and only through the contract' },
  { name: 'Auditor', job: 'Reconciles payments and writes outcomes that move reputation.', note: 'Runs as a script today (contracts/scripts/audit-arc.js) with scripted ground truth' },
  { name: 'Collector', job: 'Chases receivables.', note: 'Not built' },
];

export default function Agents() {
  const { view, loading, error } = useArc();
  const agents = view?.agents ?? [];

  return (
    <>
      <PageHeader
        eyebrow="Agents, reputation and bonds"
        title="Eight roles, one job each. Only one can spend."
        sub="The five signing agents below are read live from the registry on Arc testnet. Only the Auditor address can change a score or slash a bond, and an agent below the thresholds stops counting toward quorum."
      />

      {error && <p role="alert" className="mb-4 border border-[#b4443f]/60 bg-[#b4443f]/10 p-3 text-[#8e2e2a]">{error}</p>}
      {view && !view.available && <Card className="mb-4"><p className="text-ink/70">No on-chain record found, so there is nothing to show. Deploy and run the scripts in the README first.</p></Card>}
      {view?.error && <p role="alert" className="mb-4 border border-citrine/60 bg-sand/30 p-3 text-[#7a5a14]">{view.error}</p>}

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
        {loading && !view && <Card className="md:col-span-2 lg:col-span-5"><p className="text-ink/60">Reading the registry from Arc testnet…</p></Card>}
        {agents.map((a) => (
          <Card key={a.agentId}>
            <p className="eyebrow">Agent #{a.agentId}</p>
            <h2 className="h3 mt-1.5">{ROLE_NAMES[a.role]}</h2>
            <p className="mt-2 min-h-[42px] text-ink/70">{JOBS[a.role]}</p>
            <div className="mt-4">
              <p className="eyebrow">Score (live)</p>
              <p className="font-display text-[40px] font-extrabold leading-none tracking-h3">{a.scoreNow}</p>
              <div className="mt-2 h-1.5 bg-lilac/40"><div className="h-full bg-violet" style={{ width: `${Math.max(0, Math.min(100, a.scoreNow))}%` }} /></div>
            </div>
            <dl className="mt-4 space-y-1.5 border-t border-ink/10 pt-3 font-mono text-[12px]">
              <div className="flex justify-between"><dt className="text-cement">Bond</dt><dd>{a.bondUsdc} USDC</dd></div>
              <div className="flex justify-between"><dt className="text-cement">Quorum</dt><dd className={a.eligible ? 'text-[#2c6b57]' : 'text-[#8e2e2a]'}>{a.eligible ? 'eligible' : 'not eligible'}</dd></div>
              <div className="flex justify-between gap-2"><dt className="text-cement">Key</dt><dd title={a.signer}>Circle wallet</dd></div>
              <div className="flex justify-between gap-2"><dt className="text-cement">Signer</dt><dd><a className="text-violet underline" href={`${EXPLORER}/address/${a.signer}`} target="_blank" rel="noreferrer">{a.signer.slice(0, 6)}…{a.signer.slice(-4)}</a></dd></div>
            </dl>
          </Card>
        ))}
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-3">
        {NOT_BUILT.map((r) => (
          <Card key={r.name} className="!border-dashed">
            <p className="eyebrow">No score</p>
            <h2 className="h3 mt-1.5">{r.name}</h2>
            <p className="mt-2 text-ink/70">{r.job}</p>
            <p className="mt-3 font-mono text-[11px] text-cement">{r.note}</p>
          </Card>
        ))}
      </div>

      <Card className="mt-4">
        <h2 className="h2">How scores move</h2>
        <ul className="mt-3 space-y-2 text-[13px] text-ink/75">
          <li>A confirmed catch (a FAIL or ESCALATE that held a payment later proven bad): score goes up.</li>
          <li>A PASS that contributed to a payment later proven bad: score goes down and part of the bond is slashed into the loss-recovery pool. The operator then has to top the bond up to count again.</li>
          <li>There are no agent-to-agent ratings. Only the Auditor address can write an outcome.</li>
          <li>Thresholds, bond sizes and slash amounts are demo assumptions, not tuned values.</li>
        </ul>
        <p className="mt-4 text-[13px]">
          The full event log, with transaction links and which entries are seeded stand-ins, is on the{' '}
          <Link href="/onchain" className="text-violet underline">On-chain page</Link>.
        </p>
      </Card>
    </>
  );
}
