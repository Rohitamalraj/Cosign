import { REQUIRED_ROLES, RULES, evalRules, PER_TX_LIMIT, type Invoice, type RuleState } from '@/lib/data';
import { Card, RuleDot, VerdictPill, usd } from './ui';

/** Attestations + the eight contract rules for one invoice. `reveal` limits how much is shown (used by the demo player). */
export function Quorum({ inv, reveal = 99, showRules = true }: { inv: Invoice; reveal?: number; showRules?: boolean }) {
  const rules = evalRules(inv);

  return (
    <div className="grid gap-4 lg:grid-cols-5">
      <Card className="lg:col-span-3">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="h2">Signed attestations</h2>
          <span className="eyebrow">EIP-712 · {inv.attestations.length}/5 roles</span>
        </div>
        <ul className="divide-y divide-ink/10">
          {REQUIRED_ROLES.map((role, i) => {
            const a = inv.attestations.find((x) => x.role === role);
            const visible = a && i < reveal;
            return (
              <li key={role} className="grid grid-cols-[96px_1fr] gap-x-4 gap-y-1 py-3 sm:grid-cols-[110px_90px_1fr]">
                <span className="font-mono text-[12px] font-medium uppercase tracking-[0.06em]">{role}</span>
                <span>{visible ? <VerdictPill v={a.verdict} /> : <span className="font-mono text-[11px] text-cement">{a ? 'working…' : 'not signed'}</span>}</span>
                <div className="col-span-2 sm:col-span-1">
                  {visible ? (
                    <>
                      <p className="text-[14px]">{a.note}</p>
                      <p className="mt-1 font-mono text-[11px] text-cement">
                        agent #{a.agentId} · conf {a.confidence.toFixed(2)} · evidence {a.cid}
                      </p>
                      {inv.checks?.[role] && (
                        <details className="group mt-1.5">
                          <summary className="cursor-pointer list-none font-mono text-[11px] text-violet hover:underline">
                            <span className="group-open:hidden">Show {inv.checks[role]!.length} checks</span>
                            <span className="hidden group-open:inline">Hide checks</span>
                          </summary>
                          <ul className="mt-2 space-y-1 border-l border-ink/15 pl-3">
                            {inv.checks[role]!.map((c, k) => (
                              <li key={k} className="text-[12px] leading-snug">
                                <span className={`mr-1.5 font-mono text-[10px] uppercase ${c.status === 'fail' ? 'text-[#8e2e2a]' : c.status === 'warn' ? 'text-[#7a5a14]' : c.status === 'pass' ? 'text-[#2c6b57]' : 'text-cement'}`}>{c.status}</span>
                                {c.detail}
                              </li>
                            ))}
                            <li className="font-mono text-[10px] text-cement">
                              {inv.llm?.[role]
                                ? `model: ${inv.llm[role]!.model}${inv.llm[role]!.error ? ` (failed: ${inv.llm[role]!.error})` : ''}`
                                : 'no model used: deterministic checks only'}
                            </li>
                          </ul>
                        </details>
                      )}
                    </>
                  ) : (
                    <p className="text-[14px] text-ink/40">{a ? '—' : 'Waiting for this agent to sign.'}</p>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </Card>

      {showRules && (
        <Card className="lg:col-span-2">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="h2">Policy contract</h2>
            <span className="eyebrow">Preview · 8 rules</span>
          </div>
          <p className="-mt-2 mb-4 text-[12px] text-ink/55">
            Predicted from the agents' output. The contract on Arc is the real gate and is not connected yet.
          </p>
          <ul className="space-y-3">
            {RULES.map((r, i) => {
              const state: RuleState = reveal >= 6 ? rules[i] : 'wait';
              return (
                <li key={r.n} className="flex gap-3">
                  <span className="mt-1.5"><RuleDot s={state} /></span>
                  <div>
                    <p className="text-[14px] leading-snug">
                      <span className="mr-1.5 font-mono text-[11px] text-cement">{r.n}</span>
                      {r.label}
                    </p>
                    {r.n === 6 && (
                      <p className="font-mono text-[11px] text-cement">
                        {usd(inv.amount)} vs limit {usd(PER_TX_LIMIT)} USDC{inv.humanSig ? ` · signed ${inv.humanSig}` : ''}
                      </p>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>
      )}
    </div>
  );
}
