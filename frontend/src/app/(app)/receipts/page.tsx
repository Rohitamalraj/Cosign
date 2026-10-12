'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Quorum } from '@/components/Quorum';
import { Card, PageHeader, SimTag, usd } from '@/components/ui';
import { POLICY_VERSION } from '@/lib/data';
import { useStore } from '@/lib/store';

export default function Receipts() {
  const { invoices } = useStore();
  const rows = invoices.filter((i) => i.status === 'released');
  const [sel, setSel] = useState<string | null>(null);
  const cur = rows.find((r) => r.uid === sel) ?? rows[0];

  return (
    <>
      <PageHeader
        eyebrow="Receipts and replay"
        title="Replay any payment without trusting us."
        sub="A real receipt bundles the signed attestations, evidence, policy version and the transaction hash, and can be re-verified offline. Until the Executor is connected to Arc, payments here are recorded in a demo ledger and have no transaction."
      />

      <p className="mb-4 border border-citrine/60 bg-sand/30 p-3 text-[13px] text-[#7a5a14]">
        Simulated: nothing below was sent to a chain. The attestations and verdicts are the agents' real output.
        The Executor and the receipt replay already exist and are tested against the contract; they are not wired in here yet.
      </p>

      {rows.length === 0 ? (
        <Card><p className="text-ink/60">No payments yet. Release a <Link href="/invoices" className="underline">ready invoice</Link> to see its receipt.</p></Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-12">
          <div className="card overflow-hidden lg:col-span-4">
            <p className="eyebrow border-b border-ink/15 px-5 py-3">{rows.length} simulated receipts</p>
            <ul>
              {rows.map((r) => (
                <li key={r.uid}>
                  <button
                    type="button"
                    onClick={() => setSel(r.uid)}
                    className={`w-full border-b border-ink/10 px-5 py-4 text-left transition-colors last:border-0 hover:bg-lilac/20 ${cur?.uid === r.uid ? 'bg-lilac/25' : ''}`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-[12px]">{r.id}</span>
                      <SimTag />
                    </div>
                    <p className="mt-1 font-semibold">{r.vendor}</p>
                    <p className="text-[13px] text-ink/60">{usd(r.amount)} USDC</p>
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
                <dl className="mt-5 grid gap-x-8 gap-y-3 font-mono text-[12px] sm:grid-cols-2">
                  <div><dt className="text-cement">Transaction hash</dt><dd className="mt-0.5">none (simulated)</dd></div>
                  <div><dt className="text-cement">Policy version</dt><dd className="mt-0.5">{POLICY_VERSION}</dd></div>
                  <div><dt className="text-cement">invoiceHash</dt><dd className="mt-0.5 break-all">{cur.hashFull ?? cur.hash}</dd></div>
                  <div><dt className="text-cement">Payee</dt><dd className="mt-0.5 break-all">{cur.payeeFull ?? cur.payee}</dd></div>
                  <div><dt className="text-cement">Human signature</dt><dd className="mt-0.5">{cur.humanSig ?? 'Not required'}</dd></div>
                </dl>
              </Card>
              <Quorum inv={cur} />
            </div>
          )}
        </div>
      )}
    </>
  );
}
