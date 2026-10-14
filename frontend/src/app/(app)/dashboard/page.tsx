'use client';

import Link from 'next/link';
import { Card, Stat, usd } from '@/components/ui';
import { useStore } from '@/lib/store';
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

const stack = ['Arc', 'USDC', 'Circle Wallets', 'EIP-712'];

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
  const { view } = useArc();

  const inbox = invoices.filter((i) => i.status === 'escalated' || i.status === 'held').length;
  const escalatedShare = invoices.length ? Math.round((inbox / invoices.length) * 100) : 0;
  const duplicatesCaught = invoices.filter((i) => i.attestations.some((a) => a.role === 'SENTINEL' && a.verdict === 'FAIL' && /duplicate/i.test(a.note))).length;

  // Real, from the chain record: payments the contract released, and attack cases it held.
  const paid = (view?.cases ?? []).filter((c) => c.executor === 'RELEASED' || c.executor === 'ALREADY_RELEASED');
  const heldOnChain = (view?.cases ?? []).filter((c) => c.executor === 'HELD' || (c.case !== 'A' && !!c.reason));
  const paidUsdc = paid.reduce((s, c) => s + c.amountUsdc, 0);
  const attacks = (view?.cases ?? []).filter((c) => c.case !== 'A');
  const verified = view?.verifiedOk === true;

  const withBaseline = partners.filter((p) => p.dpoBeforeDays !== undefined && p.dpoAfterDays !== undefined);
  const maxDpo = Math.max(1, ...withBaseline.map((p) => p.dpoBeforeDays ?? 0));

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
            <Link href="/onchain" className="btn-solid">Verify the Arc run yourself</Link>
            <Link href="/invoices" className="btn-ghost">Open invoice inbox</Link>
          </div>
        </div>

        <div className="grid gap-4 lg:col-span-4">
          <Card className="bg-ink text-opal">
            <p className="eyebrow !text-lilac">Waiting on a human</p>
            <p className="mt-3 font-display text-[64px] font-extrabold leading-none tracking-h1">{inbox}</p>
            <p className="mt-3 text-[14px] text-opal/70">Invoices held or escalated (this app's demo ledger).</p>
            <Link href="/escalations" className="mt-5 inline-block border-b border-sand pb-0.5 text-sand">Open escalation queue →</Link>
          </Card>
          <Card>
            <p className="eyebrow">Duplicate payments executed on Arc</p>
            <p className="mt-3 font-display text-[64px] font-extrabold leading-none tracking-h1 text-violet">0</p>
            <p className="mt-3 text-[14px] text-ink/60">
              {view?.available ? `Checked against the chain: ${paid.length} payments, each in the paid set once.` : 'The contract\'s paid set rejects any repeat of an invoice hash.'}
            </p>
          </Card>
        </div>
      </section>

      {/* What it is built on: only what is actually used */}
      <section className="card flex flex-wrap items-center gap-x-10 gap-y-3 px-6 py-5">
        <span className="eyebrow">Built on</span>
        {stack.map((s) => (
          <span key={s} className="font-display text-[18px] font-bold tracking-h3 text-ink/55">{s}</span>
        ))}
      </section>

      {/* Real numbers only */}
      <section className="grid gap-4 md:grid-cols-2 lg:grid-cols-12">
        <Card className="lg:col-span-3"><Stat label="Real design partners" value={String(partners.filter((p) => p.consent).length)} sub={partners.length ? 'With consent, from traction.json' : 'None yet. This is the number to move.'} /></Card>
        <Card className="lg:col-span-3"><Stat label="USDC paid on Arc testnet" value={usd(paidUsdc)} sub={view?.available ? (verified ? 'Verified from chain state. Test money, demo scale' : 'Recorded run; re-check on the On-chain page') : 'No on-chain record loaded'} accent /></Card>
        <Card className="lg:col-span-3"><Stat label="Attack cases held on-chain" value={view?.available ? `${heldOnChain.length}/${attacks.length}` : '—'} sub="Near-duplicate, wallet change, injection, over-limit" /></Card>
        <Card className="lg:col-span-3"><Stat label="Invoices through the agents" value={String(invoices.length)} sub="Live agents on this app's demo ledger" /></Card>

        <Card className="md:col-span-2 lg:col-span-7">
          <div className="mb-6 flex items-center justify-between">
            <h2 className="h2">Days payable outstanding, before vs after</h2>
            <span className="eyebrow">{withBaseline.length ? 'Real partners' : 'No data yet'}</span>
          </div>
          {withBaseline.length === 0 ? (
            <p className="max-w-lg text-ink/70">
              No design partner has a baseline yet, so there is nothing honest to chart. Once a partner shares their last few invoice and payment dates and
              runs real invoices, their before and after appear here. The collection steps are in <code className="font-mono text-[12px]">docs/TRACTION.md</code>.
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
            <span className="eyebrow">Live, this app</span>
          </div>
          <dl className="divide-y divide-ink/10">
            {[
              ['Held or escalated to a human', `${escalatedShare}%`],
              ['Duplicates caught by the Sentinel', String(duplicatesCaught)],
              ['Receipts replayed OK on-chain', view?.receipts ? `${view.receipts.filter((r) => r.ok).length}/${view.receipts.length}` : '—'],
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
          ['Agents sign', 'Every verdict is an EIP-712 attestation bound to the invoice hash, payee and amount, signed by a key Circle holds. Models give opinions; they never hold the keys.'],
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

      {/* Real Auditor events from the chain record */}
      <Card>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="h2">Recent Auditor outcomes (on-chain)</h2>
          <Link href="/onchain" className="border-b border-ink/40 pb-0.5 text-[13px]">All events and checks →</Link>
        </div>
        {view?.auditorEvents?.length ? (
          <ul className="divide-y divide-ink/10">
            {view.auditorEvents.slice().reverse().slice(0, 4).map((e) => (
              <li key={e.tx} className="grid gap-1 py-3 sm:grid-cols-[110px_90px_1fr_120px] sm:items-baseline sm:gap-4">
                <span className="font-semibold">{e.agent[0] + e.agent.slice(1).toLowerCase()}</span>
                <span className={`font-mono text-[12px] ${e.scoreDelta >= 0 ? 'text-[#2c6b57]' : 'text-[#8e2e2a]'}`}>{e.scoreDelta > 0 ? '+' : ''}{e.scoreDelta} ({e.scoreBefore}→{e.scoreAfter})</span>
                <span className="text-ink/75">{e.reason}{e.seeded && <span className="ml-1.5 border border-citrine/60 bg-sand/30 px-1 font-mono text-[10px] uppercase text-[#7a5a14]">seeded</span>}</span>
                <a className="font-mono text-[12px] text-violet underline sm:text-right" href={e.explorer ?? `${EXPLORER}/tx/${e.tx}`} target="_blank" rel="noreferrer">{e.tx.slice(0, 8)}…{e.tx.slice(-4)}</a>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-ink/60">{view ? 'No Auditor events recorded yet.' : 'Loading the on-chain record…'}</p>
        )}
      </Card>
    </div>
  );
}
