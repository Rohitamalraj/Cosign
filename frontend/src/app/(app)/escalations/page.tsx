'use client';

import Link from 'next/link';
import { Card, PageHeader, StatusPill, VerdictPill, usd } from '@/components/ui';
import { evalRules } from '@/lib/data';
import { useStore } from '@/lib/store';

export default function Escalations() {
  const { invoices, humanDecide } = useStore();
  const queue = invoices.filter((i) => i.status === 'escalated' || i.status === 'held');
  const cleared = invoices.filter((i) => i.humanSig);

  return (
    <>
      <PageHeader
        eyebrow="Escalation queue"
        title="Doubt goes to a person, never to an average."
        sub="Any FAIL or ESCALATE verdict holds the payment. A human approval only counts for the limit rule: every other rule must still pass before the contract releases funds."
      />

      <div className="space-y-4">
        {queue.length === 0 && (
          <Card><p className="text-ink/60">Queue is empty. Every invoice is released or still being reviewed by the agents.</p></Card>
        )}

        {queue.map((inv) => {
          const flagged = inv.attestations.filter((a) => a.verdict !== 'PASS');
          const rules = evalRules(inv);
          const onlyLimit = rules.every((r, idx) => r === 'pass' || (idx === 5 && r === 'wait'));
          return (
            <Card key={inv.id}>
              <div className="grid gap-6 lg:grid-cols-12">
                <div className="lg:col-span-8">
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="font-mono text-[12px]">{inv.id}</span>
                    <StatusPill s={inv.status} />
                    {inv.caseId && <span className="border border-violet/40 px-1 font-mono text-[10px] text-violet">CASE {inv.caseId}</span>}
                  </div>
                  <h2 className="h3 mt-3">{inv.vendor} · {usd(inv.amount)} USDC</h2>
                  <p className="mt-2 text-ink/70">{inv.headline}</p>

                  {flagged.length > 0 ? (
                    <ul className="mt-5 space-y-3">
                      {flagged.map((a) => (
                        <li key={a.role} className="border border-ink/15 bg-opal p-3">
                          <div className="flex items-center gap-3">
                            <span className="font-mono text-[12px] font-medium">{a.role}</span>
                            <VerdictPill v={a.verdict} />
                            <span className="font-mono text-[11px] text-cement">evidence {a.cid}</span>
                          </div>
                          <p className="mt-2">{a.note}</p>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-5 border border-ink/15 bg-opal p-3">
                      All five agents signed PASS. The contract is holding this payment only because it is above the 5,000 USDC limit.
                    </p>
                  )}
                  <Link href="/invoices" className="mt-4 inline-block border-b border-ink/40 pb-0.5 text-[13px]">Open full quorum in inbox →</Link>
                </div>

                <div className="flex flex-col justify-between gap-4 border-ink/15 lg:col-span-4 lg:border-l lg:pl-6">
                  <div>
                    <p className="eyebrow">Your decision</p>
                    <p className="mt-2 text-ink/70">
                      {onlyLimit
                        ? 'Signing releases the payment and puts your signature on the receipt.'
                        : 'Other rules are failing, so approving cannot release funds. Reject to keep it held, or wait for the cooling-off and challenge to clear.'}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button type="button" className="btn-solid" disabled={!onlyLimit} onClick={() => humanDecide(inv.id, true)}>
                      Sign and approve
                    </button>
                    <button type="button" className="btn-ghost" onClick={() => humanDecide(inv.id, false)}>Reject</button>
                  </div>
                </div>
              </div>
            </Card>
          );
        })}
      </div>

      {cleared.length > 0 && (
        <Card className="mt-6">
          <h2 className="h2 mb-3">Released with a human signature</h2>
          <ul className="divide-y divide-ink/10">
            {cleared.map((i) => (
              <li key={i.id} className="flex flex-wrap items-baseline justify-between gap-2 py-3">
                <span>{i.id} · {i.vendor} · {usd(i.amount)} USDC</span>
                <span className="font-mono text-[12px] text-cement">signed {i.humanSig} · tx {i.tx}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}
