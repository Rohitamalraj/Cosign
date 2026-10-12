'use client';

import { useState } from 'react';
import { Quorum } from '@/components/Quorum';
import { Card, PageHeader, StatusPill, usd } from '@/components/ui';
import type { Status } from '@/lib/data';
import { useStore } from '@/lib/store';

const filters: { key: Status | 'all'; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'released', label: 'Released' },
  { key: 'held', label: 'Held' },
  { key: 'escalated', label: 'Needs human' },
  { key: 'pending', label: 'In review' },
];

export default function Invoices() {
  const { invoices } = useStore();
  const [filter, setFilter] = useState<Status | 'all'>('all');
  const [selected, setSelected] = useState(invoices[0].id);

  const list = invoices.filter((i) => filter === 'all' || i.status === filter);
  const inv = invoices.find((i) => i.id === selected) ?? invoices[0];

  return (
    <>
      <PageHeader
        eyebrow="Invoice inbox"
        title="Every invoice, and why it moved or didn’t."
        sub="Invoices arrive by email forward, PDF upload or API. Select one to see each agent’s signed verdict and the contract’s rule-by-rule result."
        right={<button className="btn-ghost" type="button">Upload invoice (mock)</button>}
      />

      <div className="mb-4 flex flex-wrap gap-2">
        {filters.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setFilter(f.key)}
            className={`border px-3 py-1.5 text-[13px] transition-colors ${filter === f.key ? 'border-ink bg-ink text-opal' : 'border-ink/20 hover:border-ink'}`}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="card mb-6 overflow-x-auto">
        <table className="w-full min-w-[720px] text-left">
          <thead>
            <tr className="border-b border-ink/15">
              {['Invoice', 'Vendor', 'Amount (USDC)', 'Category', 'Received', 'Due', 'Status'].map((h) => (
                <th key={h} className="eyebrow px-4 py-3 font-medium">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {list.map((i) => (
              <tr
                key={i.id}
                onClick={() => setSelected(i.id)}
                className={`cursor-pointer border-b border-ink/10 transition-colors last:border-0 hover:bg-lilac/20 ${i.id === inv.id ? 'bg-lilac/25' : ''}`}
              >
                <td className="px-4 py-3 font-mono text-[12px]">
                  <button type="button" className="text-left" onClick={() => setSelected(i.id)}>{i.id}</button>
                  {i.caseId && <span className="ml-2 border border-violet/40 px-1 text-[10px] text-violet">CASE {i.caseId}</span>}
                </td>
                <td className="px-4 py-3">{i.vendor}</td>
                <td className="px-4 py-3 font-mono text-[13px]">{usd(i.amount)}</td>
                <td className="px-4 py-3 text-ink/70">{i.category}</td>
                <td className="px-4 py-3 text-ink/70">{i.received}</td>
                <td className="px-4 py-3 text-ink/70">{i.due}</td>
                <td className="px-4 py-3"><StatusPill s={i.status} /></td>
              </tr>
            ))}
            {list.length === 0 && (
              <tr><td colSpan={7} className="px-4 py-10 text-center text-ink/50">Nothing in this view.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <Card className="mb-4">
        <div className="flex flex-col justify-between gap-4 md:flex-row md:items-start">
          <div>
            <p className="eyebrow">{inv.id} · {inv.vendor}</p>
            <h2 className="h3 mt-2">{inv.headline}</h2>
            {inv.injectedText && (
              <p className="mt-4 max-w-2xl border-l-2 border-[#b4443f] bg-[#b4443f]/5 p-3 font-mono text-[12px] text-ink/80">
                Untrusted invoice text, treated as data: “{inv.injectedText}”
              </p>
            )}
          </div>
          <dl className="grid shrink-0 grid-cols-2 gap-x-8 gap-y-2 font-mono text-[12px]">
            <dt className="text-cement">Amount</dt><dd>{usd(inv.amount)} USDC</dd>
            <dt className="text-cement">Payee</dt><dd>{inv.payee}</dd>
            <dt className="text-cement">invoiceHash</dt><dd>{inv.hash}</dd>
            <dt className="text-cement">Status</dt><dd><StatusPill s={inv.status} /></dd>
          </dl>
        </div>
      </Card>
      <Quorum inv={inv} />
    </>
  );
}
