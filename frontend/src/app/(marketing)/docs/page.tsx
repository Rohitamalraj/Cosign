import Link from 'next/link';
import type { Metadata } from 'next';
import { RULES, agents } from '@/lib/data';

export const metadata: Metadata = { title: 'Docs · Cosign' };

const toc = [
  ['overview', 'Overview'],
  ['lifecycle', 'Payables lifecycle'],
  ['agents', 'Agents'],
  ['schema', 'Attestation schema'],
  ['rules', 'Release rules'],
  ['receipt', 'Receipts'],
  ['reputation', 'Reputation and bonds'],
  ['security', 'Security model'],
  ['limits', 'Honest limits'],
];

const lifecycle = [
  ['Reader', 'Extracts structured data from the invoice and hashes the source file.'],
  ['Verifier', 'Checks vendor identity and destination wallet: screening, history, change-of-address rules.'],
  ['Matcher', 'Compares the invoice to the contract, purchase order and delivery proof.'],
  ['Sentinel', 'Checks for duplicates, near-duplicates, amount drift and look-alike vendors.'],
  ['Treasurer', 'Chooses the payment day: early-pay discount against cash on hand, USYC redemption if needed.'],
  ['Policy contract', 'Verifies all signed attestations, the quorum and the limits.'],
  ['Executor', 'Sends USDC on Arc from the policy wallet. A receipt bundles attestations, evidence and the transaction hash.'],
  ['Auditor', 'Reconciles the payment to the invoice and ledger, then writes outcomes that update reputation.'],
];

const schema = `{
  "invoiceHash": "0x...",   // canonical invoice + source file
  "payee": "0x...",         // destination wallet
  "amount": "1250.00",      // USDC
  "role": "MATCHER",        // READER | VERIFIER | MATCHER | SENTINEL | TREASURER
  "verdict": "PASS",        // PASS | FAIL | ESCALATE
  "confidence": 0.93,
  "evidenceCID": "bafy...", // stored evidence bundle
  "agentId": 17,            // on-chain agent identity
  "expiry": 1760745600,
  "nonce": 42
}`;

function H2({ id, children }: { id: string; children: React.ReactNode }) {
  return <h2 id={id} className="scroll-mt-24 border-t border-ink/15 pt-10 font-display text-[28px] font-extrabold tracking-h3">{children}</h2>;
}

export default function Docs() {
  return (
    <div className="px-5 pb-24 pt-12 sm:pt-16">
      <div className="mx-auto grid max-w-[1240px] gap-10 lg:grid-cols-[220px_1fr] lg:gap-16">
        <aside className="lg:sticky lg:top-6 lg:self-start">
          <p className="eyebrow mb-3">Documentation</p>
          <ul className="flex gap-1 overflow-x-auto pb-2 lg:block lg:space-y-1 lg:overflow-visible lg:pb-0">
            {toc.map(([id, label]) => (
              <li key={id} className="shrink-0">
                <a href={`#${id}`} className="block border border-transparent px-3 py-1.5 hover:border-ink/20 hover:text-violet lg:-ml-3">{label}</a>
              </li>
            ))}
          </ul>
        </aside>

        <article className="min-w-0 max-w-3xl space-y-8">
          <header>
            <p className="eyebrow" id="overview">Overview</p>
            <h1 className="mt-3 font-display text-[36px] font-extrabold leading-[1.08] tracking-[-0.04em] sm:text-[52px]">
              How Cosign decides whether money moves
            </h1>
            <p className="mt-5 text-[17px] text-ink/75">
              Cosign is a multi-agent accounts payable and receivable system in which no single AI agent can move money. A payment settles in USDC on Arc only after independent,
              single-purpose agents have each signed a verdict and an on-chain policy contract has verified the quorum. Models give verdicts. The contract decides.
            </p>
            <ul className="mt-5 grid gap-2 sm:grid-cols-2">
              {['Agents sign, contracts decide', 'Evidence over assertion', 'Reputation from outcomes', 'Disagreement escalates to a human'].map((p) => (
                <li key={p} className="flex gap-2.5 border border-ink/15 bg-white px-4 py-3"><span className="mt-2 h-1.5 w-1.5 shrink-0 bg-violet" />{p}</li>
              ))}
            </ul>
          </header>

          <H2 id="lifecycle">Payables lifecycle</H2>
          <ol className="divide-y divide-ink/10 border border-ink/15 bg-white">
            {lifecycle.map(([n, d], i) => (
              <li key={n} className="grid grid-cols-[32px_120px_1fr] items-baseline gap-3 px-4 py-3">
                <span className="font-mono text-[11px] text-cement">{String(i + 1).padStart(2, '0')}</span>
                <span className="font-semibold">{n}</span>
                <span className="text-ink/70">{d}</span>
              </li>
            ))}
          </ol>
          <p className="text-ink/70">Receivables run separately: the Collector tracks open invoices, sends timed follow-ups and matches incoming USDC using unique per-invoice payment addresses.</p>

          <H2 id="agents">Agents</H2>
          <div className="overflow-x-auto border border-ink/15 bg-white">
            <table className="w-full min-w-[520px] text-left">
              <thead><tr className="border-b border-ink/15">{['Agent', 'Single job', 'Can spend'].map((h) => <th key={h} className="eyebrow px-4 py-3 font-medium">{h}</th>)}</tr></thead>
              <tbody>
                {agents.map((a) => (
                  <tr key={a.id} className="border-b border-ink/10 last:border-0">
                    <td className="px-4 py-3 font-semibold">{a.name}</td>
                    <td className="px-4 py-3 text-ink/70">{a.job}</td>
                    <td className="px-4 py-3 font-mono text-[12px]">{a.canSpend ? 'Yes, via contract only' : 'No'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-ink/70">Independence rules: Matcher and Sentinel run on different models. The Verifier never sees the Matcher’s verdict and vice versa. The Auditor reads the ledger and chain, not agent summaries.</p>

          <H2 id="schema">Attestation schema</H2>
          <p className="text-ink/70">Each agent signs one attestation per invoice using EIP-712 typed data.</p>
          <pre className="overflow-x-auto border border-ink bg-ink p-5 font-mono text-[12.5px] leading-relaxed text-opal">{schema}</pre>

          <H2 id="rules">Release rules</H2>
          <p className="text-ink/70">Enforced by the policy contract on Arc. Any failing rule holds the payment.</p>
          <div className="overflow-x-auto border border-ink/15 bg-white">
            <table className="w-full min-w-[560px] text-left">
              <thead><tr className="border-b border-ink/15">{['#', 'Rule', 'Why'].map((h) => <th key={h} className="eyebrow px-4 py-3 font-medium">{h}</th>)}</tr></thead>
              <tbody>
                {RULES.map((r) => (
                  <tr key={r.n} className="border-b border-ink/10 last:border-0">
                    <td className="px-4 py-3 font-mono text-[12px]">{r.n}</td>
                    <td className="px-4 py-3">{r.label}</td>
                    <td className="px-4 py-3 text-ink/60">{r.why}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <H2 id="receipt">Receipts</H2>
          <p className="text-ink/70">
            After release, one receipt is stored per payment: the attestations, evidence bundle CIDs, policy version, transaction hash and later the Auditor’s reconciliation outcome.
            Anyone can replay the decision from the receipt without trusting the system. <Link href="/receipts" className="border-b border-ink/40">Open the receipt view →</Link>
          </p>

          <H2 id="reputation">Reputation and bonds</H2>
          <ul className="space-y-2 text-ink/75">
            <li className="flex gap-2.5"><span className="mt-2 h-1.5 w-1.5 shrink-0 bg-violet" />Scores are per role, use a rolling window and come only from Auditor outcomes.</li>
            <li className="flex gap-2.5"><span className="mt-2 h-1.5 w-1.5 shrink-0 bg-violet" />A PASS that contributed to a payment later proven bad lowers the score and slashes part of the USDC bond into a loss-recovery pool.</li>
            <li className="flex gap-2.5"><span className="mt-2 h-1.5 w-1.5 shrink-0 bg-violet" />No agent-to-agent ratings. Only operator-registered agents with a posted bond count toward quorum.</li>
            <li className="flex gap-2.5"><span className="mt-2 h-1.5 w-1.5 shrink-0 bg-violet" />Slash sizes, thresholds and window length are configuration values and demo assumptions.</li>
          </ul>

          <H2 id="security">Security model</H2>
          <ul className="space-y-2 text-ink/75">
            <li className="flex gap-2.5"><span className="mt-2 h-1.5 w-1.5 shrink-0 bg-violet" /><span><b>Fail-safe default.</b> Any missing, expired or conflicting attestation holds the payment. The system never pays on timeout.</span></li>
            <li className="flex gap-2.5"><span className="mt-2 h-1.5 w-1.5 shrink-0 bg-violet" /><span><b>Prompt-injection resistance.</b> Invoice text and email bodies are untrusted data. Agents extract fields and never follow instructions found in documents.</span></li>
            <li className="flex gap-2.5"><span className="mt-2 h-1.5 w-1.5 shrink-0 bg-violet" /><span><b>Key separation.</b> Agent keys and the Executor wallet are separate. The policy contract is the spending authority.</span></li>
            <li className="flex gap-2.5"><span className="mt-2 h-1.5 w-1.5 shrink-0 bg-violet" /><span><b>Privacy.</b> Invoice contents stay off-chain. Only hashes, verdicts and evidence CIDs go on-chain.</span></li>
          </ul>

          <H2 id="limits">Honest limits</H2>
          <p className="text-ink/75">
            Signatures prove who concluded what, not that the conclusion is correct. Correctness comes from independence between agents, the Auditor’s later ground truth and bonded reputation.
            The contract only guarantees that the required checks happened and agreed. Cosign does not claim regulatory certification.
          </p>
          <div className="flex flex-wrap gap-3 pt-2">
            <Link href="/demo" className="btn-solid">Replay the five cases</Link>
            <Link href="/dashboard" className="btn-ghost">Open the app</Link>
          </div>
        </article>
      </div>
    </div>
  );
}
