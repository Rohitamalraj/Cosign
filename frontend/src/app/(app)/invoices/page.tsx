'use client';

import { useEffect, useState } from 'react';
import { Quorum } from '@/components/Quorum';
import { Card, PageHeader, SimTag, StatusPill, usd } from '@/components/ui';
import type { Status } from '@/lib/data';
import { useStore } from '@/lib/store';

const filters: { key: Status | 'all'; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'released', label: 'Released' },
  { key: 'ready', label: 'Ready' },
  { key: 'held', label: 'Held' },
  { key: 'escalated', label: 'Needs human' },
];

interface Sample { id: string; title: string; text: string }

export default function Invoices() {
  const { invoices, loading, error, submit, submitPdf, reset, humanDecide } = useStore();
  const [filter, setFilter] = useState<Status | 'all'>('all');
  const [selected, setSelected] = useState<string | null>(null);
  const [samples, setSamples] = useState<Sample[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/samples').then((r) => r.json()).then((b) => setSamples(b.samples ?? [])).catch(() => undefined);
  }, []);

  const list = invoices.filter((i) => filter === 'all' || i.status === filter);
  const inv = invoices.find((i) => i.uid === selected) ?? invoices[0];

  async function upload(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setFormError(null);
    try {
      const out = await submitPdf(file);
      setSelected(out.uid);
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'could not read that PDF');
    } finally {
      setBusy(false);
    }
  }

  async function release(uid: string) {
    setBusy(true);
    setFormError(null);
    try { await humanDecide(uid, true); }
    catch (e) { setFormError(e instanceof Error ? e.message : 'could not record the release'); }
    finally { setBusy(false); }
  }

  async function run() {
    setBusy(true);
    setFormError(null);
    try {
      const out = await submit(text);
      setSelected(out.uid);
      setText('');
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'something went wrong');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="Invoice inbox"
        title="Every invoice, and why it moved or didn’t."
        sub="Paste an invoice and the five agents read, check and sign it for real. Select a row to see each agent’s verdict, the checks behind it, and what the contract would do."
      />

      <Card className="mb-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="h2">Run an invoice through the agents</h2>
          <button type="button" className="btn-ghost !px-3 !py-2 text-[13px]" onClick={() => void reset()} disabled={busy}>Reset demo</button>
        </div>
        <p className="mt-1 text-[13px] text-ink/60">
          Paste invoice text or upload a text-based PDF (up to 5 MB, 10 pages). Scanned images are rejected because OCR is not built.
          Layouts the parser does not know are held for a human unless a model is configured to read them. Payments here are recorded in a demo ledger; no money moves.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {samples.map((s) => (
            <button key={s.id} type="button" onClick={() => setText(s.text)} className="border border-ink/20 px-3 py-1.5 text-[13px] hover:border-ink">
              Load case {s.id}: {s.title}
            </button>
          ))}
        </div>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={8}
          spellCheck={false}
          placeholder={'INVOICE INV-1050\nFrom: Vendor Name <billing@vendor.example>\nIssued: 2026-10-15\nDue: 2026-10-22\n...'}
          className="mt-3 w-full border border-ink/20 bg-opal p-3 font-mono text-[12px] leading-relaxed outline-none focus:border-violet"
          aria-label="Invoice text"
        />
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button type="button" className="btn-solid" onClick={() => void run()} disabled={busy || text.trim().length < 20}>
            {busy ? 'Agents are working…' : 'Run the five agents'}
          </button>
          <label className={`btn-ghost cursor-pointer ${busy ? 'pointer-events-none opacity-40' : ''}`}>
            Upload a PDF
            <input
              type="file"
              accept="application/pdf,.pdf"
              className="sr-only"
              onChange={(e) => { void upload(e.target.files?.[0]); e.target.value = ''; }}
            />
          </label>
          {formError && <p role="alert" className="text-[13px] text-[#8e2e2a]">{formError}</p>}
        </div>
      </Card>

      {error && <p role="alert" className="mb-4 border border-[#b4443f]/60 bg-[#b4443f]/10 p-3 text-[#8e2e2a]">Could not load invoices: {error}</p>}

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
                key={i.uid}
                onClick={() => setSelected(i.uid)}
                className={`cursor-pointer border-b border-ink/10 transition-colors last:border-0 hover:bg-lilac/20 ${i.uid === inv?.uid ? 'bg-lilac/25' : ''}`}
              >
                <td className="px-4 py-3 font-mono text-[12px]">
                  <button type="button" className="text-left" onClick={() => setSelected(i.uid)}>{i.id}</button>
                  {i.caseId && <span className="ml-2 border border-violet/40 px-1 text-[10px] text-violet">CASE {i.caseId}</span>}
                </td>
                <td className="px-4 py-3">{i.vendor}</td>
                <td className="px-4 py-3 font-mono text-[13px]">{usd(i.amount)}</td>
                <td className="px-4 py-3 text-ink/70">{i.category}</td>
                <td className="px-4 py-3 text-ink/70">{i.received}</td>
                <td className="px-4 py-3 text-ink/70">{i.due}</td>
                <td className="px-4 py-3"><StatusPill s={i.status} />{i.simulated && <SimTag />}</td>
              </tr>
            ))}
            {!loading && list.length === 0 && (
              <tr><td colSpan={7} className="px-4 py-10 text-center text-ink/50">Nothing in this view.</td></tr>
            )}
            {loading && (
              <tr><td colSpan={7} className="px-4 py-10 text-center text-ink/50">The agents are reading the demo invoices…</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {inv && (
        <>
          <Card className="mb-4">
            <div className="flex flex-col justify-between gap-4 md:flex-row md:items-start">
              <div className="min-w-0">
                <p className="eyebrow">{inv.id} · {inv.vendor}</p>
                <h2 className="h3 mt-2">{inv.headline}</h2>
                {inv.flags && inv.flags.length > 0 && (
                  <p className="mt-4 max-w-2xl border-l-2 border-[#b4443f] bg-[#b4443f]/5 p-3 font-mono text-[12px] text-ink/80">
                    Untrusted invoice text contained instructions aimed at an AI. Recorded as data, never followed: {inv.flags.join('; ')}.
                    {inv.injectedText && <span className="mt-1 block text-ink/60">“{inv.injectedText}”</span>}
                  </p>
                )}
              </div>
              <dl className="grid shrink-0 grid-cols-2 gap-x-8 gap-y-2 font-mono text-[12px]">
                <dt className="text-cement">Amount</dt><dd>{usd(inv.amount)} USDC</dd>
                <dt className="text-cement">Payee</dt><dd title={inv.payeeFull}>{inv.payee}</dd>
                <dt className="text-cement">invoiceHash</dt><dd title={inv.hashFull}>{inv.hash}</dd>
                <dt className="text-cement">Status</dt><dd><StatusPill s={inv.status} />{inv.simulated && <SimTag />}</dd>
              </dl>
            </div>
            {inv.status === 'ready' && (
              <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-ink/10 pt-4">
                <button type="button" className="btn-solid" disabled={busy} onClick={() => void release(inv.uid)}>Release (simulated)</button>
                <p className="text-[13px] text-ink/60">Records the payment in the demo ledger. The Executor is not connected to a chain, so no money moves.</p>
              </div>
            )}
          </Card>
          <Quorum inv={inv} />
          {inv.source && (
            <details className="card mt-4 p-5">
              <summary className="cursor-pointer font-mono text-[12px] text-violet">Show the invoice text the agents read</summary>
              <pre className="mt-3 max-h-80 overflow-auto whitespace-pre-wrap bg-opal p-3 font-mono text-[12px] leading-relaxed">{inv.source}</pre>
            </details>
          )}
        </>
      )}
    </>
  );
}
