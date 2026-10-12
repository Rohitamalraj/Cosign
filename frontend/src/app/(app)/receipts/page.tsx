'use client';

import { useState } from 'react';
import { Quorum } from '@/components/Quorum';
import { Card, PageHeader, usd } from '@/components/ui';
import { POLICY_VERSION, receipts } from '@/lib/data';
import { useStore } from '@/lib/store';

const outcomeStyle = {
  reconciled: 'border-jade/70 bg-jade/15 text-[#2c6b57]',
  disputed: 'border-[#b4443f]/60 bg-[#b4443f]/10 text-[#8e2e2a]',
  pending: 'border-lilac bg-lilac/25 text-minsk',
} as const;

export default function Receipts() {
  const { invoices } = useStore();

  // Static receipts plus any invoice a human just released in this session.
  const rows = invoices
    .filter((i) => i.status === 'released')
    .map((i) => {
      const r = receipts.find((x) => x.invoiceId === i.id);
      return {
        id: r?.id ?? `R-${String(receipts.length + 1).padStart(4, '0')}`,
        inv: i,
        paidAt: r?.paidAt ?? 'Just now',
        tx: i.tx ?? r?.tx ?? '—',
        outcome: r?.outcome ?? ('pending' as const),
      };
    })
    .sort((a, b) => b.id.localeCompare(a.id));

  const [sel, setSel] = useState(rows[0]?.id);
  const cur = rows.find((r) => r.id === sel) ?? rows[0];

  return (
    <>
      <PageHeader
        eyebrow="Receipts and replay"
        title="Replay any payment without trusting us."
        sub="Each receipt bundles the signed attestations, evidence CIDs, policy version and transaction hash. The Auditor’s reconciliation outcome is appended later."
      />

      <div className="grid gap-4 lg:grid-cols-12">
        <div className="card overflow-hidden lg:col-span-4">
          <p className="eyebrow border-b border-ink/15 px-5 py-3">{rows.length} receipts</p>
          <ul>
            {rows.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  onClick={() => setSel(r.id)}
                  className={`w-full border-b border-ink/10 px-5 py-4 text-left transition-colors last:border-0 hover:bg-lilac/20 ${cur?.id === r.id ? 'bg-lilac/25' : ''}`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-[12px]">{r.id}</span>
                    <span className={`border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.06em] ${outcomeStyle[r.outcome]}`}>{r.outcome}</span>
                  </div>
                  <p className="mt-1 font-semibold">{r.inv.vendor}</p>
                  <p className="text-[13px] text-ink/60">{usd(r.inv.amount)} USDC · {r.paidAt}</p>
                </button>
              </li>
            ))}
          </ul>
        </div>

        {cur && (
          <div className="space-y-4 lg:col-span-8">
            <Card>
              <p className="eyebrow">{cur.id} · {cur.inv.id}</p>
              <h2 className="h3 mt-2">{cur.inv.vendor} · {usd(cur.inv.amount)} USDC</h2>
              <dl className="mt-5 grid gap-x-8 gap-y-3 font-mono text-[12px] sm:grid-cols-2">
                <div><dt className="text-cement">Transaction hash</dt><dd className="mt-0.5 break-all">{cur.tx}</dd></div>
                <div><dt className="text-cement">Policy version</dt><dd className="mt-0.5">{POLICY_VERSION}</dd></div>
                <div><dt className="text-cement">invoiceHash</dt><dd className="mt-0.5">{cur.inv.hash}</dd></div>
                <div><dt className="text-cement">Payee</dt><dd className="mt-0.5">{cur.inv.payee}</dd></div>
                <div><dt className="text-cement">Settled</dt><dd className="mt-0.5">{cur.paidAt} · Arc testnet</dd></div>
                <div><dt className="text-cement">Human signature</dt><dd className="mt-0.5">{cur.inv.humanSig ?? 'Not required'}</dd></div>
              </dl>
              <div className="mt-5 flex flex-wrap gap-2">
                <button type="button" className="btn-ghost">Re-run decision locally (mock)</button>
                <button type="button" className="btn-ghost">Export receipt JSON (mock)</button>
              </div>
            </Card>
            <Quorum inv={cur.inv} />
          </div>
        )}
      </div>
    </>
  );
}
