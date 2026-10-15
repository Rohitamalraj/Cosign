'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Quorum } from '@/components/Quorum';
import { Card, PageHeader, usd } from '@/components/ui';
import { api, useStore } from '@/lib/store';

interface ReceiptView {
  receipt: { policyVersion: string; txHash: string; policyAddress: string; releasedAt: string; humanSigned: boolean; onChainReceiptHash: string; destinationDomain: number };
  replay: { ok: boolean; checks: { name: string; ok: boolean; detail: string }[] };
  settlement: { state: string; mintTx?: string; destinationChain: string } | null;
}

export default function Receipts() {
  const { invoices, session } = useStore();
  const rows = invoices.filter((i) => i.status === 'released');
  const [sel, setSel] = useState<string | null>(null);
  const cur = rows.find((r) => r.uid === sel) ?? rows[0];
  const [view, setView] = useState<ReceiptView | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setView(null);
    setErr(null);
    if (!cur) return;
    api<ReceiptView>(`/api/invoices/${encodeURIComponent(cur.uid)}/receipt`).then(setView).catch((e) => setErr(e instanceof Error ? e.message : 'could not load the receipt'));
  }, [cur?.uid]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <PageHeader
        eyebrow="Receipts and replay"
        title="Replay any payment without trusting us."
        sub="Each receipt bundles the five signed attestations, the policy version and the transaction. The check below re-runs from scratch just now: signatures recovered, signers matched to the registry, the receipt hash recomputed, the human approval verified."
      />

      {!session ? (
        <Card><p className="text-ink/60">Sign in with your wallet to see your receipts.</p></Card>
      ) : rows.length === 0 ? (
        <Card><p className="text-ink/60">No payments yet. Pay a <Link href="/invoices" className="underline">ready invoice</Link> to get its receipt.</p></Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-12">
          <div className="card overflow-hidden lg:col-span-4">
            <p className="eyebrow border-b border-ink/15 px-5 py-3">{rows.length} receipts</p>
            <ul>
              {rows.map((r) => (
                <li key={r.uid}>
                  <button type="button" onClick={() => setSel(r.uid)} className={`w-full border-b border-ink/10 px-5 py-4 text-left transition-colors last:border-0 hover:bg-lilac/20 ${cur?.uid === r.uid ? 'bg-lilac/25' : ''}`}>
                    <span className="font-mono text-[12px]">{r.id}</span>
                    <p className="mt-1 font-semibold">{r.vendor}</p>
                    <p className="text-[13px] text-ink/60">{usd(r.amount)} USDC · {r.chain ?? 'Arc'}</p>
                  </button>
                </li>
              ))}
            </ul>
          </div>

          {cur && (
            <div className="space-y-4 lg:col-span-8">
              <Card>
                <p className="eyebrow">{cur.id}</p>
                <h2 className="h3 mt-2">{cur.vendor} · {usd(cur.amount)} USDC</h2>
                {err && <p role="alert" className="mt-3 text-[13px] text-[#8e2e2a]">{err}</p>}
                <dl className="mt-5 grid gap-x-8 gap-y-3 font-mono text-[12px] sm:grid-cols-2">
                  <div><dt className="text-cement">Transaction</dt><dd className="mt-0.5 break-all">{cur.txUrl ? <a className="text-violet underline" href={cur.txUrl} target="_blank" rel="noreferrer">{cur.tx}</a> : '—'}</dd></div>
                  <div><dt className="text-cement">Policy version</dt><dd className="mt-0.5">{view?.receipt.policyVersion ?? '…'}</dd></div>
                  <div><dt className="text-cement">invoiceHash</dt><dd className="mt-0.5 break-all">{cur.hashFull ?? cur.hash}</dd></div>
                  <div><dt className="text-cement">Payee</dt><dd className="mt-0.5 break-all">{cur.payeeFull ?? cur.payee}</dd></div>
                  <div><dt className="text-cement">Human signature</dt><dd className="mt-0.5">{view ? (view.receipt.humanSigned ? 'Approver wallet signed' : 'Not required') : '…'}</dd></div>
                  {view?.settlement && <div><dt className="text-cement">Cross-chain</dt><dd className="mt-0.5">{view.settlement.state === 'MINTED' && view.settlement.mintTx ? <>minted on {view.settlement.destinationChain}: <a className="text-violet underline" href={`https://sepolia.basescan.org/tx/${view.settlement.mintTx}`} target="_blank" rel="noreferrer">{view.settlement.mintTx.slice(0, 12)}…</a></> : `burned on Arc; mint ${view.settlement.state.toLowerCase()}`}</dd></div>}
                </dl>
              </Card>

              {view && (
                <Card>
                  <h2 className="h2 mb-1">Replay {view.replay.ok ? 'passed' : 'FAILED'}</h2>
                  <ul className="mt-2 space-y-0.5 border-l border-ink/15 pl-3 text-[12px]">
                    {view.replay.checks.map((k) => <li key={k.name}><span className={`mr-1.5 font-mono text-[10px] uppercase ${k.ok ? 'text-[#2c6b57]' : 'text-[#8e2e2a]'}`}>{k.ok ? 'ok' : 'fail'}</span>{k.name}: {k.detail}</li>)}
                  </ul>
                </Card>
              )}
              <Quorum inv={cur} />
            </div>
          )}
        </div>
      )}
    </>
  );
}
