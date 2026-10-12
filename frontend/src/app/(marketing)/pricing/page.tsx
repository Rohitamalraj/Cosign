import Link from 'next/link';
import type { Metadata } from 'next';
import { HandleButton } from '@/components/landing/Chrome';
import { Stagger, StaggerItem } from '@/components/landing/Motion';

export const metadata: Metadata = { title: 'Pricing · Cosign' };

const tiers = [
  {
    name: 'Design partner',
    price: 'Free',
    note: 'Arc testnet · test USDC',
    pitch: 'For the first real users running real invoices through the full quorum path.',
    items: ['Up to 10 vendors', 'All eight agents', 'Receipts and replay', 'Escalation inbox', 'Traction dashboard export'],
    cta: 'Start as a design partner',
    href: '/dashboard',
    featured: true,
  },
  {
    name: 'Pay per invoice',
    price: 'To be set',
    note: 'Target: well below $10.89',
    pitch: 'For small teams on mainnet. Billed per processed invoice, priced under the manual cost it replaces.',
    items: ['Everything in design partner', 'Treasurer with USYC', 'Collector for receivables', 'Agent bonds and loss-recovery pool', 'Email and API ingestion'],
    cta: 'Talk to us',
    href: '/pricing#contact',
  },
  {
    name: 'Custom policy',
    price: 'Custom',
    note: 'Limits, budgets, signers',
    pitch: 'For teams that need their own limits, category budgets, human approvers and cross-chain vendors.',
    items: ['Custom per-transaction limits', 'Category budgets', 'Multi-approver human sign-off', 'CCTP cross-chain payments', 'Private evidence storage'],
    cta: 'Talk to us',
    href: '/pricing#contact',
  },
];

const costs = [
  ['Manual AP, fully loaded', '$10.89 per invoice', 'Ardent Partners and APQC, secondary source'],
  ['Best-in-class automated AP', '$2.78 per invoice', 'Ardent Partners and APQC, secondary source'],
  ['Arc settlement gas', 'About $0.01 per transaction', 'PRD estimate; gas is paid in USDC'],
  ['Extra model calls', 'Per invoice, varies by model', 'Five verdicts instead of one; to be measured'],
];

export default function Pricing() {
  return (
    <div className="hero-grid relative px-5 pb-24 pt-16 sm:pt-24">
      <div className="relative mx-auto max-w-[1240px]">
        <div className="text-center">
          <p className="eyebrow">Pricing</p>
          <h1 className="mt-4">
            <span className="block font-serif text-[48px] italic leading-none sm:text-[80px]">Priced under what</span>
            <span className="block font-display text-[40px] font-extrabold leading-[1.05] tracking-[-0.045em] sm:text-[80px]">a manual invoice costs</span>
          </h1>
          <p className="mx-auto mt-6 max-w-xl text-[18px] font-light text-ink/75">
            Pricing is a placeholder for the hackathon: only the free design-partner tier is real today. Paid tiers are not final.
          </p>
        </div>

        <Stagger className="mt-14 grid gap-4 lg:grid-cols-3">
          {tiers.map((t) => (
            <StaggerItem key={t.name} className={`flex flex-col justify-between border bg-white p-7 ${t.featured ? 'border-ink shadow-[0_24px_60px_-34px_rgba(8,7,32,0.5)]' : 'border-ink/15'}`}>
              <div>
                <p className="eyebrow">{t.name}</p>
                <p className="mt-3 font-display text-[44px] font-extrabold leading-none tracking-h1">{t.price}</p>
                <p className="mt-2 font-mono text-[12px] text-cement">{t.note}</p>
                <p className="mt-5 text-ink/70">{t.pitch}</p>
                <ul className="mt-6 space-y-2 border-t border-ink/10 pt-5">
                  {t.items.map((i) => (
                    <li key={i} className="flex gap-2.5"><span className="mt-2 h-1.5 w-1.5 shrink-0 bg-violet" />{i}</li>
                  ))}
                </ul>
              </div>
              <div className="mt-8">
                {t.featured ? <HandleButton href={t.href} solid>{t.cta}</HandleButton> : <Link href={t.href} className="btn-ghost">{t.cta}</Link>}
              </div>
            </StaggerItem>
          ))}
        </Stagger>

        <section className="mt-20">
          <h2 className="font-display text-[28px] font-extrabold tracking-h3">What an invoice costs today</h2>
          <div className="mt-6 overflow-x-auto border border-ink/15 bg-white">
            <table className="w-full min-w-[560px] text-left">
              <thead>
                <tr className="border-b border-ink/15">
                  {['Line item', 'Cost', 'Source'].map((h) => <th key={h} className="eyebrow px-5 py-3 font-medium">{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {costs.map(([a, b, c]) => (
                  <tr key={a} className="border-b border-ink/10 last:border-0">
                    <td className="px-5 py-3.5 font-semibold">{a}</td>
                    <td className="px-5 py-3.5 font-mono text-[13px]">{b}</td>
                    <td className="px-5 py-3.5 text-ink/60">{c}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section id="contact" className="mt-20 border border-ink/15 bg-white p-8 text-center sm:p-12">
          <h2 className="font-serif text-[40px] italic leading-none sm:text-[56px]">Have real invoices?</h2>
          <p className="mx-auto mt-4 max-w-md text-ink/70">Design partners get hands-on setup and shape the policy limits. Contact form is a placeholder until the backend ships.</p>
          <div className="mt-6 flex justify-center"><HandleButton href="/dashboard" solid>Open the app</HandleButton></div>
        </section>
      </div>
    </div>
  );
}
