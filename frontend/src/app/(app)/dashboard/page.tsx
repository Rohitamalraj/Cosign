'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Card, Stat, usd } from '@/components/ui';
import { api, useStore } from '@/lib/store';
import { EXPLORER, useArc } from '@/lib/useArc';
import tractionFile from '../../../../data/traction.json';

/** One real design partner. Kept in frontend/data/traction.json; see docs/TRACTION.md. */
interface Partner {
  name: string;
  consent: boolean;
  realInvoices: number;
  usdcVolume: number;
  testnet: boolean;
  dpoBeforeDays?: number;
  dpoAfterDays?: number;
  notes?: string;
}
const partners = (tractionFile as { partners: Partner[] }).partners;

interface Stats {
  invoices: number; paid: number; paidUsdc: number; crossChainPaid: number; crossChainMinted: number; waitingOnHuman: number; heldOrEscalated: number;
  duplicatesCaught: number; vendors: number; outcomesReported: number;
  recentPayments: { tx: string; amountUsdc: number; chain: string; at: string }[];
  recentOutcomes: { kind: string; at: string; effects: { role: string; scoreDelta: number; slashMicro: string; tx?: string }[] }[];
}

const stack = ['Arc', 'USDC', 'Circle Wallets', 'CCTP', 'ERC-8004', 'EIP-712'];

const pipeline = [
  { n: 'Reader', d: 'parses invoice', k: 'sign' },
  { n: 'Verifier', d: 'vendor, wallet, chain', k: 'sign' },
  { n: 'Matcher', d: 'invoice vs contract', k: 'sign' },
  { n: 'Sentinel', d: 'duplicates, drift', k: 'sign' },
  { n: 'Treasurer', d: 'payment timing', k: 'sign' },
  { n: 'Policy contract', d: 'quorum, limits, paid set', k: 'gate' },
  { n: 'Executor', d: 'USDC on Arc or CCTP', k: 'pay' },
  { n: 'Auditor', d: 'scores real outcomes', k: 'audit' },
];

const KIND_LABEL: Record<string, string> = {
  confirmed_correct: 'payment confirmed correct', duplicate: 'duplicate reported', wrong_wallet: 'wrong wallet reported', wrong_amount: 'wrong amount reported',
  other_problem: 'problem reported', rejected_bad: 'hold confirmed right', blocked_wrongly: 'hold overturned',
};

export default function Overview() {
  const { status, session } = useStore();
  const { view } = useArc();
  const [stats, setStats] = useState<Stats | null>(null);
  useEffect(() => { api<Stats>('/api/stats').then(setStats).catch(() => undefined); }, []);

  const withBaseline = partners.filter((p) => p.dpoBeforeDays !== undefined && p.dpoAfterDays !== undefined);
  const maxDpo = Math.max(1, ...withBaseline.map((p) => p.dpoBeforeDays ?? 0));
  const heldShare = stats && stats.invoices ? Math.round((stats.heldOrEscalated / stats.invoices) * 100) : 0;

  return (
    <div className="space-y-4">
      <section className="grid gap-4 lg:grid-cols-12">
        <div className="card flex flex-col justify-between p-6 sm:p-10 lg:col-span-8">
          <div>
            <p className="eyebrow mb-5">Multi-agent AP on Arc{status ? ` · ${status.mode === 'live' ? 'live' : 'preview'}` : ''}</p>
            <h1 className="h1 max-w-3xl">No single agent can move your money.</h1>
            <p className="mt-6 max-w-2xl text-[16px] text-ink/70">
              Five agents each sign what they concluded. An on-chain policy contract checks the quorum. Only then does USDC move, on Arc or on another chain through CCTP, with a replayable receipt for every payment.
            </p>
          </div>
          <div className="mt-10 flex flex-wrap gap-3">
            <Link href="/invoices" className="btn-solid">{session ? 'Open the invoice inbox' : 'Sign in and run an invoice'}</Link>
            <Link href="/onchain" className="btn-ghost">Verify it from the chain</Link>
          </div>
        </div>

        <div className="grid gap-4 lg:col-span-4">
          <Card className="bg-ink text-opal">
            <p className="eyebrow !text-lilac">Waiting on a human</p>
            <p className="mt-3 font-display text-[64px] font-extrabold leading-none tracking-h1">{stats?.waitingOnHuman ?? '—'}</p>
            <p className="mt-3 text-[14px] text-opal/70">Invoices above the limit, waiting for the approver’s wallet.</p>
            <Link href="/escalations" className="mt-5 inline-block border-b border-sand pb-0.5 text-sand">Open escalation queue →</Link>
          </Card>
          <Card>
            <p className="eyebrow">Policy wallet balance</p>
            <p className="mt-3 font-display text-[44px] font-extrabold leading-none tracking-h1 text-violet">{status?.policyUsdc !== null && status?.policyUsdc !== undefined ? usd(status.policyUsdc) : '—'}</p>
            <p className="mt-3 text-[14px] text-ink/60">USDC the contract can pay out, read from Arc now. Limit per payment: {status?.perTxLimitUsdc ?? '—'} USDC.</p>
          </Card>
        </div>
      </section>

      <section className="card flex flex-wrap items-center gap-x-10 gap-y-3 px-6 py-5">
        <span className="eyebrow">Built on</span>
        {stack.map((s) => <span key={s} className="font-display text-[18px] font-bold tracking-h3 text-ink/55">{s}</span>)}
      </section>

      <section className="grid gap-4 md:grid-cols-2 lg:grid-cols-12">
        <Card className="lg:col-span-3"><Stat label="Real design partners" value={String(partners.filter((p) => p.consent).length)} sub={partners.length ? 'With consent, from traction.json' : 'None yet. This is the number to move.'} /></Card>
        <Card className="lg:col-span-3"><Stat label="USDC paid through the app" value={stats ? usd(stats.paidUsdc) : '—'} sub={stats ? `${stats.paid} on-chain payments. Test USDC on Arc testnet.` : 'Loading…'} accent /></Card>
        <Card className="lg:col-span-3"><Stat label="Invoices through the agents" value={stats ? String(stats.invoices) : '—'} sub={stats ? `${stats.vendors} vendors in the ledger` : ''} /></Card>
        <Card className="lg:col-span-3"><Stat label="Cross-chain payments" value={stats ? `${stats.crossChainMinted}/${stats.crossChainPaid}` : '—'} sub="Minted on the destination / sent through CCTP" /></Card>

        <Card className="md:col-span-2 lg:col-span-7">
          <div className="mb-6 flex items-center justify-between">
            <h2 className="h2">Days payable outstanding, before vs after</h2>
            <span className="eyebrow">{withBaseline.length ? 'Real partners' : 'No data yet'}</span>
          </div>
          {withBaseline.length === 0 ? (
            <p className="max-w-lg text-ink/70">
              No design partner has shared a baseline yet, so there is nothing honest to chart. Once a partner shares their last few invoice and payment dates and runs real invoices, their before and after appear here.
              The steps are in <code className="font-mono text-[12px]">docs/TRACTION.md</code>.
            </p>
          ) : (
            <>
              <div className="space-y-4">
                {withBaseline.map((p) => (
                  <div key={p.name} className="grid grid-cols-[84px_1fr_64px] items-center gap-3">
                    <span className="text-[13px]">{p.name}</span>
                    <div className="space-y-1.5">
                      <div className="h-2.5 bg-lilac/60" style={{ width: `${((p.dpoBeforeDays ?? 0) / maxDpo) * 100}%` }} />
                      <div className="h-2.5 bg-violet" style={{ width: `${((p.dpoAfterDays ?? 0) / maxDpo) * 100}%` }} />
                    </div>
                    <span className="text-right font-mono text-[12px]">{p.dpoBeforeDays}d → {p.dpoAfterDays}d</span>
                  </div>
                ))}
              </div>
              <div className="mt-6 flex gap-5 font-mono text-[11px] uppercase tracking-[0.08em] text-cement">
                <span className="flex items-center gap-2"><span className="h-2.5 w-2.5 bg-lilac/60" />Before</span>
                <span className="flex items-center gap-2"><span className="h-2.5 w-2.5 bg-violet" />With Cosign</span>
              </div>
            </>
          )}
        </Card>

        <Card className="md:col-span-2 lg:col-span-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="h2">Bounded autonomy</h2>
            <span className="eyebrow">Live</span>
          </div>
          <dl className="divide-y divide-ink/10">
            {[
              ['Held or escalated to a human', stats ? `${heldShare}%` : '—'],
              ['Duplicates caught by the Sentinel', stats ? String(stats.duplicatesCaught) : '—'],
              ['Outcomes reported to the Auditor', stats ? String(stats.outcomesReported) : '—'],
              ['Agents eligible for quorum', view?.agents ? `${view.agents.filter((a) => a.eligible).length}/${view.agents.length}` : '—'],
            ].map(([k, v]) => (
              <div key={k} className="flex items-baseline justify-between py-3">
                <dt className="text-ink/70">{k}</dt>
                <dd className="font-display text-[20px] font-extrabold tracking-h3">{v}</dd>
              </div>
            ))}
          </dl>
        </Card>
      </section>

      <Card>
        <div className="mb-6 flex flex-wrap items-end justify-between gap-2">
          <h2 className="h3">Agents sign, the Arc contract decides, only the Executor pays</h2>
          <span className="eyebrow">Payables path</span>
        </div>
        <ol className="grid gap-2 sm:grid-cols-2 lg:grid-cols-8">
          {pipeline.map((p, i) => (
            <li key={p.n} className={`relative border p-3 ${p.k === 'gate' ? 'border-violet bg-violet/10' : 'border-ink/15 bg-opal'}`}>
              <span className="font-mono text-[11px] text-cement">{String(i + 1).padStart(2, '0')}</span>
              <p className="mt-1 font-semibold leading-tight">{p.n}</p>
              <p className="mt-0.5 text-[13px] text-ink/60">{p.d}</p>
            </li>
          ))}
        </ol>
      </Card>

      <section className="grid gap-4 lg:grid-cols-2">
        <Card>
          <div className="mb-4 flex items-center justify-between"><h2 className="h2">Latest payments</h2><span className="eyebrow">On-chain</span></div>
          {stats?.recentPayments.length ? (
            <ul className="divide-y divide-ink/10">
              {stats.recentPayments.map((p) => (
                <li key={p.tx} className="flex items-baseline justify-between gap-3 py-3">
                  <span>{usd(p.amountUsdc)} USDC <span className="text-ink/55">to {p.chain}</span></span>
                  <a className="font-mono text-[12px] text-violet underline" href={`${EXPLORER}/tx/${p.tx}`} target="_blank" rel="noreferrer">{p.tx.slice(0, 10)}…{p.tx.slice(-4)}</a>
                </li>
              ))}
            </ul>
          ) : <p className="text-ink/60">{stats ? 'No payments made through the app yet.' : 'Loading…'}</p>}
        </Card>
        <Card>
          <div className="mb-4 flex items-center justify-between"><h2 className="h2">Recent Auditor outcomes</h2><Link href="/agents" className="border-b border-ink/40 pb-0.5 text-[13px]">Scores →</Link></div>
          {stats?.recentOutcomes.length ? (
            <ul className="divide-y divide-ink/10">
              {stats.recentOutcomes.map((o) => (
                <li key={o.at} className="py-3">
                  <p className="font-semibold">{KIND_LABEL[o.kind] ?? o.kind}</p>
                  <p className="mt-0.5 font-mono text-[12px] text-ink/65">{o.effects.map((e) => `${e.role[0]}${e.role.slice(1, 3).toLowerCase()} ${e.scoreDelta > 0 ? '+' : ''}${e.scoreDelta}${BigInt(e.slashMicro) > 0n ? ` (slash ${Number(e.slashMicro) / 1e6})` : ''}`).join(' · ')}</p>
                </li>
              ))}
            </ul>
          ) : <p className="text-ink/60">{stats ? 'No outcomes reported yet. When an operator tells the Auditor what really happened, agent scores move on-chain and appear here.' : 'Loading…'}</p>}
        </Card>
      </section>
    </div>
  );
}
