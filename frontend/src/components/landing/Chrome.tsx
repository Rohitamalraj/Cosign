'use client';

import Link from 'next/link';

const ticker = [
  ['📊', 'Case study: how a duplicate invoice was blocked by the contract, not a prompt'],
  ['🔐', 'Seeded wallet-swap held by a 48h cooling-off and challenge'],
  ['🧾', 'Every payment ships with a replayable receipt'],
  ['⚖️', 'Reputation moves only on Auditor outcomes'],
];

export function Ticker() {
  const items = [...ticker, ...ticker];
  return (
    <div className="border-b border-ink/15 bg-white/60">
      <div className="mx-auto flex max-w-[1384px] overflow-hidden border-x border-ink/10 py-2">
        <div className="flex shrink-0 animate-[ticker_40s_linear_infinite] gap-12 whitespace-nowrap pr-12 font-mono text-[12px]">
          {items.map(([e, t], i) => (
            <span key={i} className="flex items-center gap-2">
              <span>{e}</span>
              <span>{t} →</span>
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Button with the four corner handles seen on the reference's primary CTA. */
export function HandleButton({ href, children, solid = false }: { href: string; children: React.ReactNode; solid?: boolean }) {
  const corner = 'absolute h-2.5 w-2.5 rounded-full border border-ink/30 bg-opal';
  return (
    <span className="relative inline-block p-1.5">
      <i className={`${corner} left-0 top-0`} />
      <i className={`${corner} right-0 top-0`} />
      <i className={`${corner} bottom-0 left-0`} />
      <i className={`${corner} bottom-0 right-0`} />
      <Link
        href={href}
        className={`inline-flex items-center border border-ink px-5 py-3 text-[15px] leading-none transition-colors ${
          solid ? 'bg-ink text-opal hover:bg-violet' : 'bg-rose/30 hover:bg-rose/60'
        }`}
      >
        {children}
      </Link>
    </span>
  );
}

export function Wordmark({ className = '' }: { className?: string }) {
  return (
    <span className={`font-display text-[30px] font-black uppercase leading-none tracking-[-0.04em] ${className}`}>
      Cosign
    </span>
  );
}

export function Sparkle({ className = '' }: { className?: string }) {
  const spokes = ['M4 4l8 8', 'M24 2v12', 'M44 4l-8 8', 'M46 24H34'];
  return (
    <svg className={className} viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="square" aria-hidden>
      {spokes.map((d, i) => (
        <path key={d} d={d} className="sparkle-spoke" style={{ animationDelay: `${i * 0.35}s` }} />
      ))}
    </svg>
  );
}

const cols = [
  ['Product', [['Invoice inbox', '/invoices'], ['Escalation queue', '/escalations'], ['Receipts and replay', '/receipts'], ['Agents and bonds', '/agents']]],
  ['Docs', [['Overview', '/docs#overview'], ['Attestation schema', '/docs#schema'], ['Release rules', '/docs#rules'], ['Security model', '/docs#security']]],
  ['Company', [['Pricing', '/pricing'], ['Demo cases', '/demo'], ['Dashboard', '/dashboard'], ['FAQ', '/#faq']]],
];

export function LandingFooter() {
  return (
    <footer className="border-t border-ink/15">
      <div className="mx-auto grid max-w-[1384px] grid-cols-2 gap-10 px-5 py-14 md:grid-cols-5">
        <div className="col-span-2"><Wordmark /><p className="mt-4 max-w-xs text-ink/60">Agents sign. A contract decides. Only the Executor can pay.</p></div>
        {cols.map(([h, items]) => (
          <div key={h as string}>
            <p className="eyebrow mb-3">{h as string}</p>
            <ul className="space-y-2">
              {(items as string[][]).map(([label, href]) => (
                <li key={label}><Link href={href} className="text-ink/75 hover:text-violet">{label}</Link></li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="mx-auto max-w-[1384px] border-t border-ink/10 px-5 py-5">
        <p className="font-mono text-[11px] text-cement">Built for the Tameion Agents Hackathon. Product screens on this page are illustrative. The real run is on the On-chain page. Test USDC on Arc testnet.</p>
      </div>
    </footer>
  );
}
