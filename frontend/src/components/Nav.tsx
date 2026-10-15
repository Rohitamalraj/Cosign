'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useStore } from '@/lib/store';

const links = [
  { href: '/dashboard', label: 'Overview' },
  { href: '/invoices', label: 'Invoices' },
  { href: '/escalations', label: 'Escalations' },
  { href: '/receipts', label: 'Receipts' },
  { href: '/agents', label: 'Agents' },
  { href: '/onchain', label: 'On-chain' },
  { href: '/lab', label: 'Decision Lab' },
  { href: '/demo', label: 'Demo' },
];

export function Nav() {
  const path = usePathname() ?? '/';
  const { invoices } = useStore();
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
          <span className="hidden items-center gap-1.5 border border-citrine/60 bg-sand/30 px-2 py-1 font-mono text-[11px] uppercase tracking-[0.08em] sm:inline-flex">
            <span className="h-1.5 w-1.5 rounded-full bg-gold" /> Live agents, demo ledger
          </span>
          <Link href="/demo" className="btn-solid">Run the demo</Link>
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

