import { SiteNav } from '@/components/SiteNav';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SiteNav />
      <main className="mx-auto w-full max-w-page px-4 pb-24 pt-10 sm:px-8">{children}</main>
      <footer className="mx-auto max-w-page border-t border-ink/15 px-4 py-8 sm:px-8">
        <p className="eyebrow">Cosign · Tameion Agents Hackathon · Real agents sign through Circle wallets and the real contract decides. Payments are real transactions of test USDC on Arc testnet</p>
      </footer>
    </>
  );
}
