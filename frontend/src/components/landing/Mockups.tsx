import { RULES } from '@/lib/data';

/* Static, decorative product windows. Content is mock and mirrors the app. */

function Bar({ title, actions }: { title: string; actions?: string[] }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-ink/10 px-3 py-2.5">
      <div className="flex min-w-0 items-center gap-2.5">
        <span className="grid h-5 w-5 shrink-0 place-items-center bg-ink font-display text-[10px] font-black text-opal">C</span>
        <span className="truncate text-[12px]">{title}</span>
      </div>
      <div className="flex shrink-0 gap-1.5">
        {actions?.map((a) => <span key={a} className="border border-ink/15 px-2 py-0.5 text-[11px]">{a}</span>)}
      </div>
    </div>
  );
}

const Tag = ({ children }: { children: React.ReactNode }) => (
  <span className="absolute -top-6 left-6 border border-b-0 border-ink/15 bg-white px-3 py-1 font-mono text-[11px] tracking-[0.12em] text-ink/80">{children}</span>
);

const pill = {
  PASS: 'border-jade/70 bg-jade/15 text-[#2c6b57]',
  FAIL: 'border-[#b4443f]/60 bg-[#b4443f]/10 text-[#8e2e2a]',
  ESCALATE: 'border-citrine/70 bg-sand/40 text-[#7a5a14]',
} as const;

export function AttestationsWindow({ className = '' }: { className?: string }) {
  const rows: [string, keyof typeof pill, string][] = [
    ['READER', 'PASS', 'Fields extracted, source hashed'],
    ['VERIFIER', 'PASS', 'Wallet unchanged for 142 days'],
    ['MATCHER', 'PASS', 'Within 1% of contract rate'],
    ['SENTINEL', 'FAIL', 'Near-duplicate of INV-1041'],
    ['TREASURER', 'PASS', 'Pay on due date'],
  ];
  return (
    <div className={`relative ${className}`}>
      <Tag>AGENTS THAT SIGN</Tag>
      <div className="border border-ink/15 bg-white shadow-[0_20px_60px_-30px_rgba(8,7,32,0.35)]">
        <Bar title="INV-1042 · Northwind Design Co." actions={['Evidence']} />
        <div className="p-5">
          <p className="font-display text-[26px] font-extrabold leading-tight tracking-h3">Signed attestations</p>
          <p className="mt-1 text-ink/50">One EIP-712 verdict per role, bound to the invoice hash.</p>
          <ul className="mt-4 divide-y divide-ink/10">
            {rows.map(([r, v, n]) => (
              <li key={r} className="flex items-center gap-3 py-2">
                <span className="w-[84px] font-mono text-[11px]">{r}</span>
                <span className={`border px-1.5 font-mono text-[10px] ${pill[v]}`}>{v}</span>
                <span className="truncate text-[12px] text-ink/65">{n}</span>
              </li>
            ))}
          </ul>
          <div className="mt-4 border border-ink/10 bg-opal p-3 font-mono text-[11px] leading-relaxed">
            <span className="text-cement">attestation.json</span>
            <br />{'{ "role": "SENTINEL", "verdict": "FAIL",'}
            <br />{'  "invoiceHash": "0x8d27…41fa",'}
            <br />{'  "evidenceCID": "bafyB42s", "nonce": 42 }'}
          </div>
        </div>
      </div>
    </div>
  );
}

export function ContractWindow({ className = '' }: { className?: string }) {
  return (
    <div className={`relative ${className}`}>
      <Tag>CONTRACT THAT DECIDES</Tag>
      <div className="border border-ink/15 bg-white shadow-[0_30px_80px_-30px_rgba(8,7,32,0.45)]">
        <Bar title="Policy contract on Arc · INV-1042" actions={['Replay', 'Open in app']} />
        <div className="space-y-4 p-5">
          <div className="ml-auto max-w-[85%] border border-ink/10 bg-opal px-3 py-2 text-[12px]">Why was INV-1042 held when 4 of 5 agents passed it?</div>
          <p className="text-[13px]">The contract requires every verdict to be PASS. The Sentinel signed FAIL, so rule 4 failed and the payment is routed to a human. Nothing moved.</p>
          <div className="flex items-center gap-2 bg-opal px-3 py-2 text-[12px] text-ink/55">› Checked 8 release rules in 0.4 seconds</div>
          <ul className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
            {RULES.map((r) => (
              <li key={r.n} className="flex items-start gap-2 text-[12px] leading-snug">
                <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${r.n === 4 ? 'bg-[#b4443f]' : 'bg-jade'}`} />
                <span><span className="mr-1 font-mono text-[10px] text-cement">{r.n}</span>{r.label}</span>
              </li>
            ))}
          </ul>
          <p className="text-[13px]">A direct second payment of INV-1041’s hash would also be rejected by rule 7: the paid set already contains it.</p>
        </div>
      </div>
    </div>
  );
}

export function ReceiptWindow({ className = '' }: { className?: string }) {
  const bars = [38, 62, 45, 80, 55, 92, 70];
  return (
    <div className={`relative ${className}`}>
      <Tag>RECEIPTS YOU CAN REPLAY</Tag>
      <div className="border border-ink/15 bg-white shadow-[0_20px_60px_-30px_rgba(8,7,32,0.35)]">
        <Bar title="Receipt R-0004" actions={['Edit', 'Share']} />
        <div className="p-5">
          <p className="font-display text-[26px] font-extrabold leading-tight tracking-h3">Payment overview</p>
          <p className="mt-1 text-ink/50">Attestations, evidence, policy version and transaction hash.</p>
          <div className="mt-4 grid grid-cols-3 gap-2">
            {[['1,250.00', 'USDC paid'], ['8 / 8', 'Rules passed'], ['0.4 s', 'To settle']].map(([v, l]) => (
              <div key={l} className="border border-ink/10 p-2.5">
                <p className="font-display text-[18px] font-extrabold tracking-h3">{v}</p>
                <p className="text-[11px] text-ink/55">{l}</p>
              </div>
            ))}
          </div>
          <div className="mt-4 flex h-24 items-end gap-2 border-b border-ink/15 pb-px">
            {bars.map((b, i) => <div key={i} className={`flex-1 ${i === 5 ? 'bg-violet' : 'bg-lilac/70'}`} style={{ height: `${b}%` }} />)}
          </div>
          <p className="mt-2 font-mono text-[11px] text-cement">tx 0x9f3a1c…c21e · policy-v0.3.1</p>
        </div>
      </div>
    </div>
  );
}

export function RulesCard() {
  return (
    <div className="border border-ink/15 bg-white p-5 shadow-[0_20px_60px_-35px_rgba(8,7,32,0.35)]">
      <p className="eyebrow mb-3">Release rules · Arc</p>
      <ul className="space-y-2.5">
        {RULES.map((r) => (
          <li key={r.n} className="grid grid-cols-[22px_1fr] gap-2 text-[13px]">
            <span className="font-mono text-[11px] text-cement">{r.n}</span>
            <span>{r.label}<span className="block text-[12px] text-ink/50">{r.why}</span></span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ScoreCard() {
  const rows: [string, number, string][] = [['Verifier', 88, '+6 confirmed catch'], ['Sentinel', 79, '−23 earlier miss, bond slashed'], ['Matcher', 84, 'steady'], ['Treasurer', 76, 'earning standing']];
  return (
    <div className="border border-ink/15 bg-white p-5 shadow-[0_20px_60px_-35px_rgba(8,7,32,0.35)]">
      <p className="eyebrow mb-3">Reputation · per role</p>
      <ul className="space-y-4">
        {rows.map(([n, s, t]) => (
          <li key={n}>
            <div className="flex items-baseline justify-between"><span className="font-semibold">{n}</span><span className="font-display text-[22px] font-extrabold tracking-h3">{s}</span></div>
            <div className="mt-1.5 h-1.5 bg-lilac/40"><div className="h-full bg-violet" style={{ width: `${s}%` }} /></div>
            <p className="mt-1 text-[12px] text-ink/55">{t}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function AgentsCard() {
  const names = ['Reader', 'Verifier', 'Matcher', 'Sentinel', 'Treasurer', 'Executor', 'Collector', 'Auditor'];
  return (
    <div className="border border-ink/15 bg-white p-5 shadow-[0_20px_60px_-35px_rgba(8,7,32,0.35)]">
      <p className="eyebrow mb-3">Eight agents · one job each</p>
      <div className="grid grid-cols-2 gap-2">
        {names.map((n, i) => (
          <div key={n} className={`border p-3 ${n === 'Executor' ? 'border-violet bg-violet/10' : 'border-ink/10'}`}>
            <span className="font-mono text-[10px] text-cement">0{i + 1}</span>
            <p className="font-semibold leading-tight">{n}</p>
            <p className="text-[11px] text-ink/50">{n === 'Executor' ? 'only one that spends' : 'cannot spend'}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
