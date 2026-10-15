'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Card, PageHeader, StatusPill, VerdictPill, usd } from '@/components/ui';
import { useStore } from '@/lib/store';

export default function Escalations() {
  const { invoices, session, status, canRelease, release, signIn } = useStore();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const queue = invoices.filter((i) => i.status === 'escalated' || i.status === 'held');
  const cleared = invoices.filter((i) => i.humanSig && i.status === 'released');
  const live = status?.mode === 'live';

  async function approve(uid: string) {
    setBusy(uid);
    setErr(null);
    try { await release(uid, true); }
    catch (e) { setErr(e instanceof Error ? e.message : 'could not release'); }
    finally { setBusy(null); }
  }

  return (
    <>
      <PageHeader
        eyebrow="Escalation queue"
        title="Doubt goes to a person, never to an average."
        sub="Any FAIL or ESCALATE verdict holds the payment. The approver’s wallet can sign off on one thing only, the limit rule: every other rule must still pass before the contract releases funds."
      />

      {!session && <Card><p className="text-ink/70">Sign in with your wallet to see the queue.</p><button type="button" className="btn-solid mt-3" onClick={() => void signIn().catch((e) => setErr(e.message))}>Sign in with wallet</button></Card>}
      {err && <p role="alert" className="mb-4 border border-[#b4443f]/60 bg-[#b4443f]/10 p-3 text-[#8e2e2a]">{err}</p>}

      <div className="space-y-4">
        {session && queue.length === 0 && (
          <Card><p className="text-ink/60">Queue is empty. Run an invoice in the <Link href="/invoices" className="underline">inbox</Link> to see the agents hold one.</p></Card>
        )}

        {queue.map((inv) => {
          const flagged = inv.attestations.filter((a) => a.verdict !== 'PASS');
          const limitOnly = inv.status === 'escalated' && inv.ruleOverrides[6] === 'wait';
          return (
            <Card key={inv.uid}>
              <div className="grid gap-6 lg:grid-cols-12">
                <div className="lg:col-span-8">
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="font-mono text-[12px]">{inv.id}</span>
                    <StatusPill s={inv.status} />
                    {inv.caseId && <span className="border border-violet/40 px-1 font-mono text-[10px] text-violet">EXAMPLE {inv.caseId}</span>}
                  </div>
                  <h2 className="h3 mt-3">{inv.vendor} · {usd(inv.amount)} USDC</h2>
                  <p className="mt-2 text-ink/70">{inv.headline}</p>

                  {flagged.length > 0 ? (
                    <ul className="mt-5 space-y-3">
                      {flagged.map((a) => (
                        <li key={a.role} className="border border-ink/15 bg-opal p-3">
                          <div className="flex flex-wrap items-center gap-3">
                            <span className="font-mono text-[12px] font-medium">{a.role}</span>
                            <VerdictPill v={a.verdict} />
                            <span className="font-mono text-[11px] text-cement">evidence {a.cid}</span>
                          </div>
                          <p className="mt-2">{a.note}</p>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-5 border border-ink/15 bg-opal p-3">All five agents signed PASS. The contract holds this payment only because it is above the per-transaction limit.</p>
                  )}
                  <Link href="/invoices" className="mt-4 inline-block border-b border-ink/40 pb-0.5 text-[13px]">Open the full quorum in the inbox →</Link>
                </div>

                <div className="flex flex-col justify-between gap-4 border-ink/15 lg:col-span-4 lg:border-l lg:pl-6">
                  <div>
                    <p className="eyebrow">Your decision</p>
                    <p className="mt-2 text-ink/70">
                      {limitOnly
                        ? 'Approving opens your wallet to sign an EIP-712 approval. It must be the approver wallet. The Executor then pays through the contract, which re-checks everything.'
                        : 'Other rules are failing, so an approval cannot release funds. Fix the cause (for example add the vendor, or wait out the cooling-off) and run the agents again from the inbox. Then tell the Auditor whether holding it was right.'}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {limitOnly && canRelease && live && (
                      <button type="button" className="btn-solid" disabled={busy === inv.uid} onClick={() => void approve(inv.uid)}>{busy === inv.uid ? 'Waiting for wallet…' : 'Approve in wallet and pay'}</button>
                    )}
                    <Link href="/invoices" className="btn-ghost">Open in inbox</Link>
                  </div>
                </div>
              </div>
            </Card>
          );
        })}
      </div>

      {cleared.length > 0 && (
        <Card className="mt-6">
          <h2 className="h2 mb-3">Paid with the approver’s signature</h2>
          <ul className="divide-y divide-ink/10">
            {cleared.map((i) => (
              <li key={i.uid} className="flex flex-wrap items-baseline justify-between gap-2 py-3">
                <span>{i.id} · {i.vendor} · {usd(i.amount)} USDC</span>
                {i.txUrl && <a className="font-mono text-[12px] text-violet underline" href={i.txUrl} target="_blank" rel="noreferrer">{i.tx?.slice(0, 12)}…</a>}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}
