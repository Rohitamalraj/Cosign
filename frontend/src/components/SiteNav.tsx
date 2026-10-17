'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { useStore } from '@/lib/store';

/**
 * The one navbar, on the landing page and inside the app: a logo, the pages people use every day, a "More" menu for the
 * rest, and the wallet. No separate marketing links and no sales buttons.
 */
const main = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/invoices', label: 'Invoices' },
  { href: '/vendors', label: 'Vendors' },
  { href: '/receipts', label: 'Receipts' },
  { href: '/onchain', label: 'On-chain' },
  { href: '/docs', label: 'Docs' },
];

const more = [
  { href: '/escalations', label: 'Escalations' },
  { href: '/agents', label: 'Agents' },
  { href: '/lab', label: 'Decision Lab' },
  { href: '/demo', label: 'Examples' },
  { href: '/pricing', label: 'Pricing' },
];

export function SiteNav() {
  const path = usePathname() ?? '/';
  const { invoices, session, status, signIn, signOut } = useStore();
  const [menu, setMenu] = useState(false);
  const [mobile, setMobile] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const moreRef = useRef<HTMLDivElement>(null);
  const waiting = invoices.filter((i) => i.status === 'escalated' || i.status === 'held').length;
  const active = (href: string) => path === href || path.startsWith(`${href}/`);
  const moreActive = more.some((l) => active(l.href));

  // Close the menus on navigation and when clicking elsewhere.
  useEffect(() => { setMenu(false); setMobile(false); }, [path]);
  useEffect(() => {
    const close = (e: MouseEvent) => { if (moreRef.current && !moreRef.current.contains(e.target as Node)) setMenu(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  const linkCls = (on: boolean) => `whitespace-nowrap px-2.5 py-1.5 transition-colors hover:text-violet ${on ? 'bg-ink text-opal hover:text-opal' : ''}`;

  async function connect() {
    setBusy(true);
    setErr(null);
    try { await signIn(); } catch (e) { setErr(e instanceof Error ? e.message : 'sign-in failed'); } finally { setBusy(false); }
  }

  const wallet = session ? (
    <button type="button" className="btn-ghost !px-3 !py-2 text-[13px]" onClick={() => void signOut()} title="Sign out">
      <span className="font-mono">{session.address.slice(0, 6)}…{session.address.slice(-4)}</span> · {session.role}
    </button>
  ) : (
    <button type="button" className="btn-solid !px-4 !py-2 text-[14px]" disabled={busy} title={err ?? 'Sign in with your wallet. It signs a message only; nothing is sent.'} onClick={() => void connect()}>
      {busy ? 'Waiting for wallet…' : 'Sign in'}
    </button>
  );

  return (
    <header className="sticky top-0 z-30 border-b border-ink/15 bg-opal/95 backdrop-blur">
      <div className="mx-auto flex max-w-page items-center justify-between gap-4 px-4 py-3 sm:px-8">
        <Link href="/" className="flex shrink-0 items-center gap-2.5" aria-label="Cosign home">
          <span className="grid h-7 w-7 place-items-center bg-ink text-[13px] font-bold text-opal"><span className="font-display">C</span></span>
          <span className="font-display text-[18px] font-extrabold tracking-h3">Cosign</span>
        </Link>

        <nav className="hidden items-center gap-0.5 lg:flex" aria-label="Main">
          {main.map((l) => <Link key={l.href} href={l.href} className={linkCls(active(l.href))}>{l.label}</Link>)}
          <div className="relative" ref={moreRef}>
            <button type="button" className={`${linkCls(moreActive)} inline-flex items-center gap-1`} aria-expanded={menu} aria-haspopup="menu" onClick={() => setMenu((m) => !m)}>
              More
              {waiting > 0 && <span className={`font-mono text-[11px] ${moreActive ? 'text-sand' : 'text-gold'}`}>{waiting}</span>}
              <span aria-hidden className="text-[10px]">▾</span>
            </button>
            {menu && (
              <ul role="menu" className="absolute right-0 top-full z-40 mt-1 min-w-[190px] border border-ink/20 bg-opal py-1 shadow-lg">
                {more.map((l) => (
                  <li key={l.href} role="none">
                    <Link role="menuitem" href={l.href} className={`flex items-center justify-between px-4 py-2 hover:bg-lilac/25 ${active(l.href) ? 'font-semibold' : ''}`}>
                      {l.label}
                      {l.href === '/escalations' && waiting > 0 && <span className="font-mono text-[11px] text-gold">{waiting}</span>}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </nav>

        <div className="flex shrink-0 items-center gap-3">
          {status && (
            <span
              className={`h-2 w-2 rounded-full ${status.mode === 'live' ? (status.note ? 'bg-gold' : 'bg-jade') : 'bg-gold'}`}
              title={status.note ?? (status.mode === 'live' ? `Live on ${status.network}. Payments are real transactions of test USDC.` : 'Preview: no chain connected')}
              aria-label={status.mode === 'live' ? 'Live on Arc testnet' : 'Preview mode'}
            />
          )}
          {wallet}
          <button
            type="button"
            className="grid h-9 w-9 place-items-center border border-ink/25 lg:hidden"
            aria-expanded={mobile}
            aria-label={mobile ? 'Close menu' : 'Open menu'}
            onClick={() => setMobile((o) => !o)}
          >
            <span className="relative block h-3 w-5">
              <i className={`absolute left-0 top-0 h-px w-5 bg-ink transition-transform ${mobile ? 'translate-y-1.5 rotate-45' : ''}`} />
              <i className={`absolute left-0 top-1.5 h-px w-5 bg-ink transition-opacity ${mobile ? 'opacity-0' : ''}`} />
              <i className={`absolute left-0 top-3 h-px w-5 bg-ink transition-transform ${mobile ? '-translate-y-1.5 -rotate-45' : ''}`} />
            </span>
          </button>
        </div>
      </div>

      {err && <p role="alert" className="mx-auto max-w-page px-4 pb-2 text-[12px] text-[#8e2e2a] sm:px-8">{err}</p>}

      {mobile && (
        <nav className="border-t border-ink/10 bg-opal px-4 pb-4 pt-1 lg:hidden" aria-label="Mobile">
          <ul className="divide-y divide-ink/10">
            {[...main, ...more].map((l) => (
              <li key={l.href}>
                <Link href={l.href} className={`flex items-center justify-between py-3 text-[16px] ${active(l.href) ? 'font-semibold' : ''}`}>
                  {l.label}
                  {l.href === '/escalations' && waiting > 0 && <span className="font-mono text-[12px] text-gold">{waiting}</span>}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      )}
    </header>
  );
}
