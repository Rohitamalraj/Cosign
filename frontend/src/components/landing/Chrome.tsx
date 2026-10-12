'use client';

import Link from 'next/link';
import { useState } from 'react';

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

const leftLinks = [
  { href: '/#product', label: 'Product' },
  { href: '/docs', label: 'Docs' },
  { href: '/pricing', label: 'Pricing' },
];
const rightLinks = [
  { href: '/#teams', label: 'Who it’s for' },
  { href: '/#stack', label: 'Stack' },
  { href: '/#faq', label: 'FAQ' },
];

export function LandingHeader() {
  const [open, setOpen] = useState(false);
  const all = [...leftLinks, ...rightLinks, { href: '/demo', label: 'Demo' }];
  return (
    <header className="relative z-20">
      <div className="mx-auto flex max-w-[1384px] items-center justify-between px-5 py-5 lg:justify-center lg:gap-10 lg:py-6">
        <nav className="hidden items-center gap-8 lg:flex" aria-label="Primary">
          {leftLinks.map((l) => <Link key={l.href} href={l.href} className="hover:text-violet">{l.label}</Link>)}
        </nav>
        <Link href="/" className="lg:mx-6" onClick={() => setOpen(false)}><Wordmark className="!text-[26px] lg:!text-[30px]" /></Link>
        <nav className="hidden items-center gap-8 lg:flex" aria-label="Secondary">
          {rightLinks.map((l) => <Link key={l.href} href={l.href} className="hover:text-violet">{l.label}</Link>)}
          <Link href="/dashboard" className="text-ink/70 hover:text-violet">Log in</Link>
          <HandleButton href="/dashboard">Get started</HandleButton>
        </nav>
        <button
          type="button"
          className="grid h-10 w-10 place-items-center border border-ink/25 bg-white/70 lg:hidden"
          aria-expanded={open}
          aria-controls="mobile-menu"
          aria-label={open ? 'Close menu' : 'Open menu'}
          onClick={() => setOpen((o) => !o)}
        >
          <span className="relative block h-3 w-5">
            <i className={`absolute left-0 top-0 h-px w-5 bg-ink transition-transform ${open ? 'translate-y-1.5 rotate-45' : ''}`} />
            <i className={`absolute left-0 top-1.5 h-px w-5 bg-ink transition-opacity ${open ? 'opacity-0' : ''}`} />
            <i className={`absolute left-0 top-3 h-px w-5 bg-ink transition-transform ${open ? '-translate-y-1.5 -rotate-45' : ''}`} />
          </span>
        </button>
      </div>

      {open && (
        <nav id="mobile-menu" className="border-y border-ink/15 bg-opal px-5 pb-6 pt-2 lg:hidden" aria-label="Mobile">
          <ul className="divide-y divide-ink/10">
            {all.map((l) => (
              <li key={l.href}>
                <Link href={l.href} onClick={() => setOpen(false)} className="block py-3.5 text-[17px]">{l.label}</Link>
              </li>
            ))}
          </ul>
          <div className="mt-4 grid grid-cols-2 gap-3">
            <Link href="/dashboard" onClick={() => setOpen(false)} className="btn-ghost">Log in</Link>
            <Link href="/dashboard" onClick={() => setOpen(false)} className="btn-solid">Get started</Link>
          </div>
        </nav>
      )}
    </header>
  );
}

/** Four-spoke burst beside the hero headline; spokes flicker in turn. */
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
        <p className="font-mono text-[11px] text-cement">Built for the Tameion Agents Hackathon. Product screens on this page use mock data. Test USDC on Arc testnet.</p>
      </div>
    </footer>
  );
}
