'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { useStore } from '@/lib/store';

const links = [
  { href: '/dashboard', label: 'Overview' },
  { href: '/invoices', label: 'Invoices' },
  { href: '/escalations', label: 'Escalations' },
  { href: '/receipts', label: 'Receipts' },
  { href: '/vendors', label: 'Vendors' },
  { href: '/agents', label: 'Agents' },
  { href: '/onchain', label: 'On-chain' },
  { href: '/lab', label: 'Decision Lab' },
  { href: '/demo', label: 'Demo' },
];

export function Nav() {
  const path = usePathname() ?? '/';
  const { invoices, session, status, signIn, signOut } = useStore();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const open = invoices.filter((i) => i.status === 'escalated' || i.status === 'held').length;

  return (
    <header className="sticky top-0 z-30 border-b border-ink/15 bg-opal/90 backdrop-blur">
      <div className="mx-auto flex max-w-page items-center justify-between gap-6 px-4 py-3 sm:px-8">
        <Link href="/" className="flex items-center gap-2.5">
          <span className="grid h-7 w-7 place-items-center bg-ink text-[13px] font-bold text-opal">
            <span className="font-display">C</span>
          </span>
          <span className="font-display text-[18px] font-extrabold tracking-h3">Cosign</span>
        </Link>

        <nav className="hidden items-center gap-1 md:flex" aria-label="Main">
          {links.map((l) => {
            const active = path.startsWith(l.href);
            return (
              <Link
                key={l.href}
                href={l.href}
                className={`px-3 py-1.5 transition-colors hover:text-violet ${active ? 'bg-ink text-opal hover:text-opal' : ''}`}
              >
                {l.label}
                {l.href === '/escalations' && open > 0 && (
                  <span className={`ml-1.5 font-mono text-[11px] ${active ? 'text-sand' : 'text-gold'}`}>{open}</span>
                )}
              </Link>
            );
          })}
        </nav>

        <div className="flex items-center gap-3">
          {status && (
            <span title={status.note ?? `${status.network}. Payments are real transactions of test USDC.`} className={`hidden items-center gap-1.5 border px-2 py-1 font-mono text-[11px] uppercase tracking-[0.08em] sm:inline-flex ${status.mode === 'live' ? 'border-jade/70 bg-jade/15 text-[#2c6b57]' : 'border-citrine/60 bg-sand/30'}`}>
              <span className={`h-1.5 w-1.5 rounded-full ${status.mode === 'live' ? 'bg-jade' : 'bg-gold'}`} /> {status.mode === 'live' ? 'Live · Arc testnet' : 'Preview · no chain'}
            </span>
          )}
          {session ? (
            <button type="button" className="btn-ghost !px-3 !py-2 text-[13px]" onClick={() => void signOut()} title="Sign out">
              <span className="font-mono">{session.address.slice(0, 6)}…{session.address.slice(-4)}</span> · {session.role}
            </button>
          ) : (
            <button
              type="button"
              className="btn-solid"
              disabled={busy}
              title={err ?? 'Sign in with your wallet. It signs a message only; nothing is sent.'}
              onClick={async () => { setBusy(true); setErr(null); try { await signIn(); } catch (e) { setErr(e instanceof Error ? e.message : 'sign-in failed'); } finally { setBusy(false); } }}
            >
              {busy ? 'Waiting for wallet…' : 'Sign in with wallet'}
            </button>
          )}
          {err && <span role="alert" className="hidden max-w-[220px] truncate text-[12px] text-[#8e2e2a] lg:inline" title={err}>{err}</span>}
        </div>
      </div>

      <nav className="flex gap-1 overflow-x-auto border-t border-ink/10 px-4 py-2 md:hidden" aria-label="Main mobile">
        {links.map((l) => {
          const active = path.startsWith(l.href);
          return (
            <Link key={l.href} href={l.href} className={`shrink-0 px-3 py-1.5 ${active ? 'bg-ink text-opal' : ''}`}>
              {l.label}
            </Link>
          );
        })}
      </nav>
    </header>
  );
}

