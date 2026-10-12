'use client';

import Link from 'next/link';
import { Card, Stat, VerdictPill, usd } from '@/components/ui';
import { auditEvents, traction } from '@/lib/data';
import { useStore } from '@/lib/store';

const stack = ['Arc', 'USDC', 'Circle Wallets', 'Paymaster', 'USYC', 'CCTP', 'ERC-8004'];

const pipeline = [
  { n: 'Reader', d: 'parses invoice', k: 'sign' },
  { n: 'Verifier', d: 'vendor and wallet', k: 'sign' },
  { n: 'Matcher', d: 'invoice vs contract', k: 'sign' },
  { n: 'Sentinel', d: 'duplicates, drift', k: 'sign' },
  { n: 'Treasurer', d: 'payment timing', k: 'sign' },
  { n: 'Policy contract', d: 'quorum, limits, paid set', k: 'gate' },
  { n: 'Executor', d: 'USDC on Arc', k: 'pay' },
  { n: 'Auditor', d: 'scores outcomes', k: 'audit' },
];

export default function Overview() {
  const { invoices } = useStore();
  const released = invoices.filter((i) => i.status === 'released');
  const inbox = invoices.filter((i) => i.status === 'escalated' || i.status === 'held').length;
  const maxDpo = Math.max(...traction.dpo.map((d) => d.before));
  const paidVolume = released.reduce((s, i) => s + i.amount, 0);
  const attacks = invoices.filter((i) => i.caseId && i.caseId !== 'A');
  const stopped = attacks.filter((i) => i.status === 'held' || i.status === 'escalated').length;
  const duplicatesCaught = invoices.filter((i) => i.attestations.some((a) => a.role === 'SENTINEL' && a.verdict === 'FAIL' && /duplicate/i.test(a.note))).length;

  return (
    <div className="space-y-4">
      {/* Hero */}
      <section className="grid gap-4 lg:grid-cols-12">
        <div className="card flex flex-col justify-between p-6 sm:p-10 lg:col-span-8">
          <div>
            <p className="eyebrow mb-5">Multi-agent AP and AR on Arc</p>
            <h1 className="h1 max-w-3xl">No single agent can move your money.</h1>
            <p className="mt-6 max-w-2xl text-[16px] text-ink/70">
              Eight single-purpose agents each sign what they concluded. An on-chain policy contract checks the quorum.
              Only then does USDC settle, with a replayable receipt for every payment.
            </p>
          </div>
          <div className="mt-10 flex flex-wrap gap-3">
            <Link href="/demo" className="btn-solid">Replay the five demo cases</Link>
            <Link href="/invoices" className="btn-ghost">Open invoice inbox</Link>
          </div>
        </div>

        <div className="grid gap-4 lg:col-span-4">
          <Card className="bg-ink text-opal">
            <p className="eyebrow !text-lilac">Waiting on a human</p>
            <p className="mt-3 font-display text-[64px] font-extrabold leading-none tracking-h1">{inbox}</p>
            <p className="mt-3 text-[14px] text-opal/70">Invoices held or escalated by the contract.</p>
            <Link href="/escalations" className="mt-5 inline-block border-b border-sand pb-0.5 text-sand">Open escalation queue →</Link>
          </Card>
          <Card>
            <p className="eyebrow">Duplicate payments executed</p>
            <p className="mt-3 font-display text-[64px] font-extrabold leading-none tracking-h1 text-violet">{traction.duplicatePaid}</p>
            <p className="mt-3 text-[14px] text-ink/60">Paid set on Arc rejects any repeat of an invoice hash.</p>
          </Card>
        </div>
      </section>

      {/* Logo cloud */}
      <section className="card flex flex-wrap items-center gap-x-10 gap-y-3 px-6 py-5">
        <span className="eyebrow">Built on</span>
        {stack.map((s) => (
          <span key={s} className="font-display text-[18px] font-bold tracking-h3 text-ink/55">{s}</span>
        ))}
      </section>

      {/* Traction bento */}
      <section className="grid gap-4 md:grid-cols-2 lg:grid-cols-12">
        <Card className="lg:col-span-3"><Stat label="Businesses onboarded" value={String(traction.businesses)} sub="Mock number: no real users yet" /></Card>
        <Card className="lg:col-span-3"><Stat label="Invoices processed" value={String(invoices.length)} sub="Live: read and signed by the real agents" /></Card>
        <Card className="lg:col-span-3"><Stat label="USDC recorded as paid" value={usd(paidVolume)} sub="Simulated: demo ledger, no chain yet" accent /></Card>
        <Card className="lg:col-span-3"><Stat label="Attack cases stopped" value={`${stopped}/${attacks.length}`} sub="Live: near-duplicate, wallet swap, injection, over-limit" /></Card>

        <Card className="md:col-span-2 lg:col-span-7">
          <div className="mb-6 flex items-center justify-between">
            <h2 className="h2">Days payable outstanding, before vs after</h2>
            <span className="eyebrow">Mock figures</span>
          </div>
          <div className="space-y-4">
            {traction.dpo.map((d) => (
              <div key={d.name} className="grid grid-cols-[84px_1fr_64px] items-center gap-3">
                <span className="text-[13px]">{d.name}</span>
                <div className="space-y-1.5">
                  <div className="h-2.5 bg-lilac/60" style={{ width: `${(d.before / maxDpo) * 100}%` }} />
                  <div className="h-2.5 bg-violet" style={{ width: `${(d.after / maxDpo) * 100}%` }} />
                </div>
                <span className="text-right font-mono text-[12px]">{d.before}d → {d.after}d</span>
              </div>
            ))}
          </div>
          <div className="mt-6 flex gap-5 font-mono text-[11px] uppercase tracking-[0.08em] text-cement">
            <span className="flex items-center gap-2"><span className="h-2.5 w-2.5 bg-lilac/60" />Before</span>
            <span className="flex items-center gap-2"><span className="h-2.5 w-2.5 bg-violet" />With Cosign</span>
          </div>
        </Card>

        <Card className="md:col-span-2 lg:col-span-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="h2">Bounded autonomy</h2>
            <span className="eyebrow">Mock figures</span>
          </div>
          <dl className="divide-y divide-ink/10">
            {[
              ['Escalated to a human', `${traction.escalatedShare}%`],
              ['Human agreed with the agents', `${traction.humanAgreed}%`],
              ['Receipts fully replayable', `${traction.receiptsReplayable}%`],
              ['Duplicates caught (live)', String(duplicatesCaught)],
              ['Released payments (simulated)', String(released.length)],
            ].map(([k, v]) => (
              <div key={k} className="flex items-baseline justify-between py-3">
                <dt className="text-ink/70">{k}</dt>
                <dd className="font-display text-[20px] font-extrabold tracking-h3">{v}</dd>
              </div>
            ))}
          </dl>
        </Card>
      </section>

      {/* Pipeline */}
      <Card>
        <div className="mb-6 flex flex-wrap items-end justify-between gap-2">
          <h2 className="h3">Agents sign, the Arc contract decides, only the Executor pays</h2>
          <span className="eyebrow">Payables path</span>
        </div>
        <ol className="grid gap-2 sm:grid-cols-2 lg:grid-cols-8">
          {pipeline.map((p, i) => (
            <li
              key={p.n}
              className={`relative border p-3 ${p.k === 'gate' ? 'border-violet bg-violet/10' : 'border-ink/15 bg-opal'}`}
            >
              <span className="font-mono text-[11px] text-cement">{String(i + 1).padStart(2, '0')}</span>
              <p className="mt-1 font-semibold leading-tight">{p.n}</p>
              <p className="mt-0.5 text-[13px] text-ink/60">{p.d}</p>
            </li>
          ))}
        </ol>
      </Card>

      {/* Feature trio */}
      <section className="grid gap-4 md:grid-cols-3">
        {[
          ['Agents sign', 'Every verdict is an EIP-712 attestation bound to the invoice hash, payee and amount. Models give opinions; they never hold the keys.'],
          ['Contracts decide', 'Eight release rules live on Arc. A missing, expired or conflicting attestation holds the payment. The system never pays on timeout.'],
          ['Reputation from outcomes', 'Scores move only when the Auditor proves an agent right or wrong, and a USDC bond is slashed for a bad approval.'],
        ].map(([t, d], i) => (
          <Card key={t}>
            <p className="eyebrow">0{i + 1}</p>
            <h3 className="h3 mt-3">{t}</h3>
            <p className="mt-3 text-ink/70">{d}</p>
          </Card>
        ))}
      </section>

      {/* Recent catches */}
      <Card>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="h2">Recent Auditor outcomes (mock: the Auditor is not built yet)</h2>
          <Link href="/agents" className="border-b border-ink/40 pb-0.5 text-[13px]">All reputation events →</Link>
        </div>
        <ul className="divide-y divide-ink/10">
          {auditEvents.slice(0, 4).map((e) => (
            <li key={e.id} className="grid gap-1 py-3 sm:grid-cols-[130px_100px_90px_1fr] sm:items-baseline sm:gap-4">
              <span className="font-mono text-[12px] text-cement">{e.when}</span>
              <span className="font-semibold">{e.agent}</span>
              <span className="flex items-center gap-2">
                <VerdictPill v={e.delta >= 0 ? 'PASS' : 'FAIL'} />
                <span className="font-mono text-[12px]">{e.delta > 0 ? '+' : ''}{e.delta}</span>
              </span>
              <span className="text-ink/75">{e.text}</span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
