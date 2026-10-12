import { Nav } from '@/components/Nav';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Nav />
      <main className="mx-auto w-full max-w-page px-4 pb-24 pt-10 sm:px-8">{children}</main>
      <footer className="mx-auto max-w-page border-t border-ink/15 px-4 py-8 sm:px-8">
        <p className="eyebrow">Cosign · Tameion Agents Hackathon · Verdicts are from the real agents. Payments are simulated. Traction and reputation figures are mock</p>
      </footer>
    </>
  );
}
