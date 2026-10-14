'use client';

import { Card, PageHeader, VerdictPill } from '@/components/ui';
import type { Verdict } from '@/lib/data';
import { EXPLORER, ROLE_NAMES, useArc } from '@/lib/useArc';

const short = (s: string, a = 8, b = 6) => `${s.slice(0, a)}…${s.slice(-b)}`;
const ROLES = ['READER', 'VERIFIER', 'MATCHER', 'SENTINEL', 'TREASURER'];

export default function OnChain() {
  const { view, loading, error, reload } = useArc();
  const dep = view?.deployment;

  return (
    <>
      <PageHeader
        eyebrow="Live on Arc testnet"
        title="Don’t trust this page. Verify it."
        sub="Everything below was recorded from a real run on Arc testnet and is re-checked against the chain's own RPC when you open it. No keys are involved: it only reads."
        right={<button type="button" className="btn-solid" onClick={() => void reload(true)} disabled={loading}>{loading ? 'Checking the chain…' : 'Re-verify now'}</button>}
      />

      {error && <p role="alert" className="mb-4 border border-[#b4443f]/60 bg-[#b4443f]/10 p-3 text-[#8e2e2a]">{error}</p>}
      {view && !view.available && (
        <Card><p className="text-ink/70">No on-chain record found. Run the deploy and demo scripts (see the README), then reload.</p></Card>
      )}
      {view?.error && <p role="alert" className="mb-4 border border-citrine/60 bg-sand/30 p-3 text-[#7a5a14]">{view.error} The recorded run is shown below but could not be re-checked just now.</p>}

      {view?.available && dep && (
        <>
          <div className={`mb-4 border p-4 ${view.verifiedOk ? 'border-jade/70 bg-jade/10' : 'border-ink/20 bg-white'}`}>
            <p className="font-display text-[22px] font-extrabold tracking-h3">
              {view.verifiedOk ? 'Verified from chain state' : view.checkedAt ? 'Some checks did not pass' : 'Not re-verified'}
            </p>
            {view.checkedAt && <p className="mt-1 font-mono text-[12px] text-ink/60">checked {new Date(view.checkedAt).toLocaleString()} against rpc.testnet.arc.io · chain {dep.chainId}</p>}
          </div>

          <Card className="mb-4">
            <h2 className="h2 mb-4">Contracts</h2>
            <dl className="grid gap-x-8 gap-y-3 font-mono text-[12px] sm:grid-cols-2">
              <div><dt className="text-cement">CosignPolicy (the gate)</dt><dd className="mt-0.5 break-all"><a className="text-violet underline" href={`${EXPLORER}/address/${dep.policy}`} target="_blank" rel="noreferrer">{dep.policy}</a></dd></div>
              <div><dt className="text-cement">AgentRegistry (reputation and bonds)</dt><dd className="mt-0.5 break-all"><a className="text-violet underline" href={`${EXPLORER}/address/${dep.registry}`} target="_blank" rel="noreferrer">{dep.registry}</a></dd></div>
              <div><dt className="text-cement">USDC (real Arc token, 6 decimals)</dt><dd className="mt-0.5 break-all">{dep.usdc}</dd></div>
              <div><dt className="text-cement">Policy version</dt><dd className="mt-0.5">{String(dep.policyVersion ?? '')}</dd></div>
            </dl>
            <p className="mt-4 text-[13px] text-ink/60">Test money only. Amounts are the full-scale demo divided by 1,000 because the faucet gives about 20 USDC.</p>
          </Card>

          <Card className="mb-4">
            <h2 className="h2 mb-1">The five cases, as run on-chain</h2>
            <p className="mb-4 text-[13px] text-ink/60">The agents signed through Circle wallets; the Executor sent through a Circle wallet. Held cases sent no transaction.</p>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[820px] text-left">
                <thead>
                  <tr className="border-b border-ink/15">
                    {['Case', 'Amount', ...ROLES.map((r) => r.slice(0, 3)), 'Outcome', 'Chain check'].map((h) => <th key={h} className="eyebrow px-3 py-3 font-medium">{h}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {view.cases?.map((c) => (
                    <tr key={c.case} className="border-b border-ink/10 align-top last:border-0">
                      <td className="px-3 py-3 font-mono text-[12px]"><b>{c.case}</b><div className="max-w-[160px] text-[11px] text-ink/55">{c.title}</div></td>
                      <td className="px-3 py-3 font-mono text-[12px]">{c.amountUsdc}</td>
                      {ROLES.map((r) => <td key={r} className="px-3 py-3">{c.verdicts?.[r] ? <VerdictPill v={c.verdicts[r] as Verdict} /> : '—'}</td>)}
                      <td className="px-3 py-3 text-[13px]">
                        {c.executor === 'HELD'
                          ? <span className="text-[#8e2e2a]">Held{c.reason ? `: ${c.reason.split(':')[0]}` : ''}</span>
                          : <a className="text-violet underline" href={`${EXPLORER}/tx/${c.txHash}`} target="_blank" rel="noreferrer">Paid · {short(c.txHash ?? '')}</a>}
                      </td>
                      <td className="px-3 py-3 text-[12px]">
                        {c.verification ? <span className={c.verification.ok ? 'text-[#2c6b57]' : 'text-[#8e2e2a]'}>{c.verification.ok ? '✓ ' : '✗ '}{c.verification.summary}</span> : <span className="text-ink/40">not checked</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {view.cases?.some((c) => c.verification) && (
              <details className="mt-4">
                <summary className="cursor-pointer font-mono text-[12px] text-violet">Show every check the chain just answered</summary>
                <ul className="mt-3 space-y-3">
                  {view.cases.map((c) => c.verification && (
                    <li key={c.case} className="text-[12px]">
                      <b className="font-mono">Case {c.case}</b>
                      <ul className="mt-1 space-y-0.5 border-l border-ink/15 pl-3">
                        {c.verification.checks.map((k) => <li key={k.name}><span className={`mr-1.5 font-mono text-[10px] uppercase ${k.ok ? 'text-[#2c6b57]' : 'text-[#8e2e2a]'}`}>{k.ok ? 'ok' : 'fail'}</span>{k.detail}</li>)}
                      </ul>
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </Card>

          {view.receipts && view.receipts.length > 0 && (
            <Card className="mb-4">
              <h2 className="h2 mb-1">Receipts, replayed from scratch</h2>
              <p className="mb-3 text-[13px] text-ink/60">Each receipt is re-verified without trusting Cosign: signatures recovered, signers matched to the registry, the receipt hash recomputed, the human approval checked.</p>
              <ul className="divide-y divide-ink/10">
                {view.receipts.map((r) => (
                  <li key={r.invoiceHash} className="py-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-mono text-[12px]">invoice {short(r.invoiceHash, 10, 6)}</span>
                      <span className={`font-mono text-[12px] ${r.ok ? 'text-[#2c6b57]' : 'text-[#8e2e2a]'}`}>{r.ok ? `replay OK · ${r.checks.length} checks` : 'REPLAY FAILED'}</span>
                    </div>
                    <details className="mt-1">
                      <summary className="cursor-pointer font-mono text-[11px] text-violet">checks</summary>
                      <ul className="mt-1 space-y-0.5 border-l border-ink/15 pl-3 text-[12px]">
                        {r.checks.map((k) => <li key={k.name}><span className={`mr-1.5 font-mono text-[10px] uppercase ${k.ok ? 'text-[#2c6b57]' : 'text-[#8e2e2a]'}`}>{k.ok ? 'ok' : 'fail'}</span>{k.name}: {k.detail}</li>)}
                      </ul>
                    </details>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {view.agents && (
            <Card className="mb-4">
              <h2 className="h2 mb-1">Reputation and bonds, read live from the registry</h2>
              <p className="mb-4 text-[13px] text-ink/60">An agent below {view.reputation?.minScore} points or {view.reputation?.minBondUsdc} USDC of bond stops counting toward quorum. Only the Auditor address can change a score.</p>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                {view.agents.map((a) => (
                  <div key={a.agentId} className="border border-ink/15 p-4">
                    <p className="eyebrow">Agent #{a.agentId}</p>
                    <p className="mt-1 font-display text-[20px] font-extrabold tracking-h3">{ROLE_NAMES[a.role]}</p>
                    <p className="mt-2 font-display text-[34px] font-extrabold leading-none tracking-h3">{a.scoreNow}</p>
                    <p className="mt-2 font-mono text-[11px] text-cement">bond {a.bondUsdc} USDC</p>
                    <p className={`font-mono text-[11px] ${a.eligible ? 'text-[#2c6b57]' : 'text-[#8e2e2a]'}`}>{a.eligible ? 'eligible for quorum' : 'not eligible'}</p>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {view.auditorEvents && view.auditorEvents.length > 0 && (
            <Card>
              <h2 className="h2 mb-1">Auditor events</h2>
              <p className="mb-4 text-[13px] text-ink/60">{view.auditorNote}</p>
              <ul className="divide-y divide-ink/10">
                {view.auditorEvents.map((e) => (
                  <li key={e.tx} className="grid gap-1 py-3 sm:grid-cols-[110px_1fr_150px] sm:gap-4">
                    <span className="font-semibold">{e.agent[0] + e.agent.slice(1).toLowerCase()}<span className="block font-mono text-[11px] font-normal text-cement">case {e.case}</span></span>
                    <span className="text-ink/75">{e.reason}{e.seeded && <span className="ml-1.5 border border-citrine/60 bg-sand/30 px-1 font-mono text-[10px] uppercase text-[#7a5a14]">seeded</span>}</span>
                    <span className="font-mono text-[12px] sm:text-right">
                      <span className={e.scoreDelta >= 0 ? 'text-[#2c6b57]' : 'text-[#8e2e2a]'}>{e.scoreDelta > 0 ? '+' : ''}{e.scoreDelta}</span> ({e.scoreBefore}→{e.scoreAfter}){e.slashUsdc ? ` · −${e.slashUsdc} USDC` : ''}
                      <a className="block text-violet underline" href={e.explorer} target="_blank" rel="noreferrer">{short(e.tx, 8, 4)}</a>
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </>
      )}
    </>
  );
}
