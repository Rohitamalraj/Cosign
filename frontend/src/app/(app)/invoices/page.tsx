'use client';

import { useEffect, useState } from 'react';
import { IntakePanel } from '@/components/IntakePanel';
import { OutcomePanel } from '@/components/OutcomePanel';
import { Quorum } from '@/components/Quorum';
import { Card, PageHeader, StatusPill, usd } from '@/components/ui';
import type { Status } from '@/lib/data';
import { api, useStore } from '@/lib/store';

const filters: { key: Status | 'all'; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'released', label: 'Paid' },
  { key: 'ready', label: 'Ready' },
  { key: 'held', label: 'Held' },
  { key: 'escalated', label: 'Needs human' },
];

interface Sample { id: string; title: string; text: string }

export default function Invoices() {
  const { invoices, loading, error, session, status, canRelease, submit, submitPdf, readScan, rerun, release, signIn } = useStore();
  const [filter, setFilter] = useState<Status | 'all'>('all');
  const [selected, setSelected] = useState<string | null>(null);
  const [samples, setSamples] = useState<Sample[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/samples').then((r) => r.json()).then((b) => setSamples(b.samples ?? [])).catch(() => undefined);
  }, []);

  const list = invoices.filter((i) => filter === 'all' || i.status === filter);
  const inv = invoices.find((i) => i.uid === selected) ?? invoices[0];
  const live = status?.mode === 'live';

  async function guarded(fn: () => Promise<void>) {
    setBusy(true);
    setFormError(null);
    setNote(null);
    try { await fn(); }
    catch (e) { setFormError(e instanceof Error ? e.message : 'something went wrong'); }
    finally { setBusy(false); }
  }

  const [ocrNote, setOcrNote] = useState<string | null>(null);
  const [intakeId, setIntakeId] = useState<number | null>(null);
  const [inboxKey, setInboxKey] = useState(0);

  // A text PDF goes straight to the agents. A scan (an image, or a PDF with no text layer) is read by OCR first, and the text
  // is put in the box for you to check and correct, because OCR can misread a digit or a wallet character.
  const upload = (file: File | undefined) => file && guarded(async () => {
    setOcrNote(null);
    const isImage = file.type === 'image/png' || file.type === 'image/jpeg';
    if (!isImage) {
      try { setSelected((await submitPdf(file)).uid); return; }
      catch (e) { if (!(e as { needsOcr?: boolean }).needsOcr) throw e; }
    }
    setNote('Reading the scan with OCR…');
    const text = await readScan(file);
    setText(text);
    setOcrNote('Read by OCR. Check every amount, date and wallet character below, fix any mistakes, then press Run the five agents.');
    setNote(null);
  });
  const run = () => guarded(async () => {
    const inv = await submit(text);
    setSelected(inv.uid);
    setText('');
    setOcrNote(null);
    if (intakeId !== null) {
      // The text came from the email inbox: a person has now checked it and run it, so close the inbox item.
      await api(`/api/intake/${intakeId}`, { method: 'POST', body: JSON.stringify({ action: 'processed', invoiceUid: inv.uid }) }).catch(() => undefined);
      setIntakeId(null);
      setInboxKey((k) => k + 1);
    }
  });
  const pay = (uid: string, needsApproval: boolean) => guarded(async () => {
    const out = await release(uid, needsApproval);
    setNote(`Paid on-chain: ${out.txUrl ?? out.tx ?? ''}`);
  });

  const needsApproval = inv?.status === 'escalated' && inv.ruleOverrides[6] === 'wait';

  return (
    <>
      <PageHeader
        eyebrow="Invoice inbox"
        title="Every invoice, and why it moved or didn’t."
        sub="Paste an invoice. Five agents read, check and sign it through Circle-held keys, and the real contract says what it would do. Pay it from here and the Executor sends real test USDC on Arc."
      />

      {!loading && !session && (
        <Card className="mb-6">
          <h2 className="h2">Sign in to run invoices</h2>
          <p className="mt-1 text-[13px] text-ink/65">Sign in with your wallet. It signs a message only: no transaction, no cost. Your invoices are private to you and to this workspace’s operators.</p>
          <button type="button" className="btn-solid mt-3" onClick={() => void guarded(signIn)} disabled={busy}>Sign in with wallet</button>
          {formError && <p role="alert" className="mt-2 text-[13px] text-[#8e2e2a]">{formError}</p>}
        </Card>
      )}

      {session && (
        <Card className="mb-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="h2">Run an invoice through the agents</h2>
            <span className="font-mono text-[12px] text-ink/55">{session.role === 'guest' ? 'guest: you can check invoices, but only operators can pay' : `${session.role}: you can pay invoices`}</span>
          </div>
          <p className="mt-1 text-[13px] text-ink/60">
            Paste invoice text, upload a PDF, or upload a photo or scan (PNG, JPEG). Text PDFs go straight to the agents; scans are read by OCR and shown to you to check first.
            {live ? ' The vendor must already be in the Vendors ledger, or the Verifier will hold it.' : ' Preview mode: no chain is connected, so nothing can be paid.'}
          </p>
          {samples.length > 0 && (
            <details className="mt-3">
              <summary className="cursor-pointer font-mono text-[12px] text-violet">Example invoices we wrote (inputs only; nothing runs until you press the button)</summary>
              <div className="mt-2 flex flex-wrap gap-2">
                {samples.map((s) => (
                  <button key={s.id} type="button" onClick={() => setText(s.text)} className="border border-ink/20 px-3 py-1.5 text-[13px] hover:border-ink">
                    Example {s.id}: {s.title}
                  </button>
                ))}
              </div>
            </details>
          )}
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
              {busy ? 'Working…' : 'Run the five agents'}
            </button>
            <label className={`btn-ghost cursor-pointer ${busy ? 'pointer-events-none opacity-40' : ''}`}>
              Upload a PDF or scan
              <input type="file" accept="application/pdf,.pdf,image/png,image/jpeg" className="sr-only" onChange={(e) => { void upload(e.target.files?.[0]); e.target.value = ''; }} />
            </label>
            {formError && <p role="alert" className="text-[13px] text-[#8e2e2a]">{formError}</p>}
            {note && <p className="text-[13px] text-[#2c6b57]">{note}</p>}
            {ocrNote && <p className="basis-full border-l-2 border-citrine bg-sand/30 p-3 text-[13px] text-ink/80">{ocrNote}</p>}
          </div>
        </Card>
      )}

      {session && canRelease && (
        <IntakePanel
          refreshKey={inboxKey}
          onLoad={(t, id) => { setText(t); setIntakeId(id); setOcrNote('From the email inbox. Check every amount, date and wallet character, fix any mistakes, then press Run the five agents.'); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
          onOpen={(uid) => setSelected(uid)}
        />
      )}

      {error && <p role="alert" className="mb-4 border border-[#b4443f]/60 bg-[#b4443f]/10 p-3 text-[#8e2e2a]">Could not load invoices: {error}</p>}

      {session && (
        <>
          <div className="mb-4 flex flex-wrap gap-2">
            {filters.map((f) => (
              <button key={f.key} type="button" onClick={() => setFilter(f.key)}
                className={`border px-3 py-1.5 text-[13px] transition-colors ${filter === f.key ? 'border-ink bg-ink text-opal' : 'border-ink/20 hover:border-ink'}`}>
                {f.label}
              </button>
            ))}
          </div>

          <div className="card mb-6 overflow-x-auto">
            <table className="w-full min-w-[720px] text-left">
              <thead>
                <tr className="border-b border-ink/15">
                  {['Invoice', 'Vendor', 'Amount (USDC)', 'Settles on', 'Received', 'Due', 'Status'].map((h) => <th key={h} className="eyebrow px-4 py-3 font-medium">{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {list.map((i) => (
                  <tr key={i.uid} onClick={() => setSelected(i.uid)} className={`cursor-pointer border-b border-ink/10 transition-colors last:border-0 hover:bg-lilac/20 ${i.uid === inv?.uid ? 'bg-lilac/25' : ''}`}>
                    <td className="px-4 py-3 font-mono text-[12px]">
                      <button type="button" className="text-left" onClick={() => setSelected(i.uid)}>{i.id}</button>
                      {i.caseId && <span className="ml-2 border border-violet/40 px-1 text-[10px] text-violet">EXAMPLE {i.caseId}</span>}
                    </td>
                    <td className="px-4 py-3">{i.vendor}</td>
                    <td className="px-4 py-3 font-mono text-[13px]">{usd(i.amount)}</td>
                    <td className="px-4 py-3 text-ink/70">{i.chain ?? 'Arc'}</td>
                    <td className="px-4 py-3 text-ink/70">{i.received}</td>
                    <td className="px-4 py-3 text-ink/70">{i.due}</td>
                    <td className="px-4 py-3"><StatusPill s={i.status} /></td>
                  </tr>
                ))}
                {!loading && list.length === 0 && <tr><td colSpan={7} className="px-4 py-10 text-center text-ink/50">Nothing in this view yet. Run an invoice above.</td></tr>}
                {loading && <tr><td colSpan={7} className="px-4 py-10 text-center text-ink/50">Loading…</td></tr>}
              </tbody>
            </table>
          </div>
        </>
      )}

      {session && inv && (
        <>
          <Card className="mb-4">
            <div className="flex flex-col justify-between gap-4 md:flex-row md:items-start">
              <div className="min-w-0">
                <p className="eyebrow">{inv.id} · {inv.vendor}{inv.intake ? ` · by email from ${inv.intake.from}` : ''}</p>
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
                <dt className="text-cement">Settles on</dt><dd>{inv.chain ?? 'Arc'}{inv.chain && inv.chain !== 'Arc' ? ' via CCTP' : ''}</dd>
                <dt className="text-cement">invoiceHash</dt><dd title={inv.hashFull}>{inv.hash}</dd>
                <dt className="text-cement">Status</dt><dd><StatusPill s={inv.status} /></dd>
              </dl>
            </div>

            {inv.status === 'released' && (
              <div className="mt-5 border-t border-ink/10 pt-4 text-[13px]">
                {inv.txUrl && <p>Paid on Arc: <a className="font-mono text-violet underline" href={inv.txUrl} target="_blank" rel="noreferrer">{inv.tx?.slice(0, 12)}…{inv.tx?.slice(-8)}</a>{inv.humanSig && <span className="text-ink/60"> · approved by the approver wallet</span>}</p>}
                {inv.settlement && (
                  <p className="mt-1">
                    {inv.settlement.state === 'MINTED' && inv.settlement.mintTx
                      ? <>Minted on {inv.settlement.chain}: <a className="font-mono text-violet underline" href={`https://sepolia.basescan.org/tx/${inv.settlement.mintTx}`} target="_blank" rel="noreferrer">{inv.settlement.mintTx.slice(0, 12)}…</a></>
                      : <span className="text-ink/70">Burned on Arc; waiting for Circle’s attestation and the mint on {inv.settlement.chain}{inv.settlement.error ? ` (${inv.settlement.error})` : ''}. This page resumes it automatically.</span>}
                  </p>
                )}
              </div>
            )}

            {inv.status !== 'released' && (
              <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-ink/10 pt-4">
                {(inv.status === 'ready' || needsApproval) && canRelease && live && (
                  <button type="button" className="btn-solid" disabled={busy} onClick={() => void pay(inv.uid, !!needsApproval)}>
                    {busy ? 'Working…' : needsApproval ? 'Approve in wallet and pay' : 'Pay now (on-chain)'}
                  </button>
                )}
                <button type="button" className="btn-ghost" disabled={busy} onClick={() => void guarded(async () => { setSelected((await rerun(inv.uid)).uid); })}>Run the agents again</button>
                <p className="text-[13px] text-ink/60">
                  {!canRelease ? 'Only operators and admins can pay.' : !status ? 'Checking the server…' : !live ? 'No chain connected: this server cannot pay.' : needsApproval ? 'Over the limit: the approver’s wallet must sign. MetaMask will ask.' : inv.status === 'ready' ? 'Sends real test USDC through the Executor. The contract re-checks all eight rules first.' : 'Held. Fix the cause (for example add the vendor, or wait out the cooling-off) and run the agents again.'}
                </p>
              </div>
            )}
          </Card>
          <Quorum inv={inv} />
          <OutcomePanel uid={inv.uid} paid={inv.status === 'released'} canReport={canRelease && live} />
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
