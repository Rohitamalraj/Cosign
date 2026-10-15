import Link from 'next/link';
import { AgentsCard, AttestationsWindow, ContractWindow, ReceiptWindow, RulesCard, ScoreCard } from '@/components/landing/Mockups';
import { HandleButton, Sparkle } from '@/components/landing/Chrome';
import { HeroCards } from '@/components/landing/HeroCards';
import { HeroLine, Parallax, Reveal, Stagger, StaggerItem } from '@/components/landing/Motion';

const stack = ['Arc', 'USDC', 'Circle Wallets', 'EIP-712'];

const stats = [
  ['76%', 'of US organizations faced attempted or actual payments fraud in 2025', 'AFP 2026 survey'],
  ['17%', 'use AI against payments fraud, so most small teams have neither speed nor strong controls', 'AFP 2026 survey'],
  ['$10.89', 'average fully loaded cost to process one invoice by hand, vs $2.78 best-in-class', 'Ardent Partners / APQC (secondary)'],
];

const personas = [
  ['Freelancer or solo founder', 'Sends 3 to 10 invoices a month and customers pay late.', 'Get paid on time without awkward chasing.'],
  ['Small agency owner', 'Pays 5 to 20 contractors and SaaS vendors, often cross-border.', 'Pay the right party the right amount once.'],
  ['Operations lead', 'Handles approvals in email and chat with no AP software.', 'A record of why every payment was made.'],
  ['Vendor or contractor', 'Wants prompt, predictable payment.', 'Be paid fast and build a track record.'],
];

const integrations = [
  ['Arc and USDC', 'Settlement and gas are both USDC. The policy contract and registry are deployed and verifiable.', 'live'],
  ['Circle Wallets', 'Custody for every agent signing key and for the Executor. No raw private key in our process.', 'live'],
  ['Policy contract', 'Eight release rules, enforced on-chain. Re-check every result from the chain itself.', 'live'],
  ['CCTP', 'Pay a vendor on another chain: all five agents sign the destination, the policy burns USDC on Arc, Circle attests, and the mint lands on Base Sepolia. Checked from chain state.', 'live'],
  ['USYC', 'A treasury contract parks idle cash in USYC on a Treasurer order and redeems it back to the policy. Tested against a mock Teller; live use waits for Circle’s entitlement.', 'built'],
  ['ERC-8004', 'All five agents are registered in Arc’s ERC-8004 Identity Registry with an on-chain agent card that names the signing key. Our reputation still lives in our own registry.', 'live'],
];

const faqs = [
  ['What is Cosign?', 'A multi-agent accounts payable and receivable system. Eight single-purpose agents each sign a verdict about an invoice, and an on-chain policy contract on Arc verifies the quorum before any USDC moves.'],
  ['Why not one AI agent?', 'One agent making every call is a faster single point of failure. It can be talked into paying a convincing fake. In Cosign, models give verdicts and the contract decides.'],
  ['Can an agent be tricked by text in an invoice?', 'Invoice text is treated as untrusted data. The Reader extracts fields and never follows instructions found in documents, and only contract-released payments are executed.'],
  ['Do signatures prove an agent was right?', 'No. They prove who concluded what. Correctness comes from independence between agents, the Auditor’s later ground truth and bonded reputation. The contract guarantees the required checks happened and agreed.'],
  ['What happens when agents disagree?', 'Any FAIL or ESCALATE holds the payment and routes it to a human. The system never averages a doubt away and never pays on timeout.'],
  ['Is this using real money?', 'No. It runs on Arc testnet with test USDC. The On-chain page lets you re-verify the real run from the chain. The invoice inbox uses a demo ledger, so payments there are simulated, and the traction counts only real design partners (none yet).'],
];

function Section({ id, children, className = '' }: { id?: string; children: React.ReactNode; className?: string }) {
  return <section id={id} className={`mx-auto max-w-[1384px] px-5 ${className}`}>{children}</section>;
}

function Title({ serif, bold }: { serif: string; bold: string }) {
  return (
    <h2 className="text-center">
      <span className="block font-serif text-[44px] italic leading-[1.05] tracking-[-0.02em] sm:text-[64px]">{serif}</span>
      <span className="block font-display text-[38px] font-bold leading-[1.05] tracking-[-0.04em] sm:text-[58px]">{bold}</span>
    </h2>
  );
}

function Feature({
  eyebrow, title, body, cta, stat, visual, flip = false,
}: { eyebrow: string; title: string; body: string; cta: string; stat: [string, string]; visual: React.ReactNode; flip?: boolean }) {
  return (
    <div className="grid items-center gap-8 border-t border-ink/15 py-14 lg:grid-cols-12 lg:gap-14">
      <Reveal className={`lg:col-span-5 ${flip ? 'lg:order-2' : ''}`}>
        <p className="eyebrow">{eyebrow}</p>
        <h3 className="mt-3 font-display text-[28px] font-extrabold leading-[1.15] tracking-h3 sm:text-[34px]">{title}</h3>
        <p className="mt-4 text-[16px] text-ink/70">{body}</p>
        <Link href="/demo" className="mt-5 inline-block border border-ink px-4 py-2.5 transition-colors hover:bg-ink hover:text-opal">{cta}</Link>
        <div className="mt-8 border-l-2 border-violet pl-4">
          <p className="font-serif text-[30px] italic leading-none">{stat[0]}</p>
          <p className="mt-2 max-w-sm text-[13px] text-ink/60">{stat[1]}</p>
        </div>
      </Reveal>
      <Reveal className={`lg:col-span-7 ${flip ? 'lg:order-1' : ''}`} delay={0.12} y={44}>
        <div className="relative border border-ink/10 bg-gradient-to-br from-rose/25 via-opal to-lilac/30 p-6 sm:p-10">{visual}</div>
      </Reveal>
    </div>
  );
}

export default function Landing() {
  return (
    <>
      <div>
        {/* Hero */}
        <div className="hero-grid relative overflow-hidden">
          {/* Centered on small screens; text left and cards right from 1200px up. */}
          <div className="relative mx-auto max-w-[1384px] px-5 pb-0 pt-6 text-center sm:pt-10 min-[1200px]:grid min-[1200px]:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] min-[1200px]:items-start min-[1200px]:gap-8 min-[1200px]:px-14 min-[1200px]:pt-4 min-[1200px]:text-left">
            <div className="min-[1200px]:pt-10">
              <h1>
                <HeroLine className="relative inline-block font-serif text-[52px] italic leading-[1] tracking-[-0.03em] sm:text-[96px] min-[1200px]:text-[88px]">
                  No single agent
                  <Sparkle className="absolute -right-5 -top-5 h-8 w-8 text-rose sm:-right-10 sm:-top-4 sm:h-12 sm:w-12" />
                </HeroLine>
                <HeroLine delay={0.15} className="block font-display text-[46px] font-extrabold leading-[1.02] tracking-[-0.045em] sm:text-[96px] min-[1200px]:text-[80px]">can move your money</HeroLine>
              </h1>
              <Reveal delay={0.4} y={16}>
                <p className="mx-auto mt-8 max-w-2xl text-[20px] font-light leading-[1.5] text-ink/80 sm:text-[26px] min-[1200px]:mx-0 min-[1200px]:max-w-xl min-[1200px]:text-[24px]">
                  Finally, accounts payable you can trust on irreversible rails: independent agents sign, an Arc contract decides, and USDC settles with a replayable receipt.
                </p>
              </Reveal>
              <Reveal delay={0.55} y={16}>
                <div className="mt-10 flex flex-wrap items-center justify-center gap-4 min-[1200px]:justify-start">
                  <HandleButton href="/dashboard">Open the app</HandleButton>
                  <Link href="/demo" className="border border-ink/25 bg-white/70 px-5 py-3 text-[15px] leading-none transition-colors hover:border-ink">Watch the seven cases</Link>
                </div>
              </Reveal>
            </div>
            <HeroCards />
          </div>

          {/* Product windows, fading off the fold */}
          <div className="relative mx-auto mt-14 h-[400px] max-w-[1384px] overflow-hidden px-5 sm:mt-20 sm:h-[560px]">
            <Parallax speed={40} className="absolute left-[4%] top-8 hidden w-[44%] lg:block">
              <AttestationsWindow />
            </Parallax>
            <Parallax speed={90} className="absolute right-[4%] top-14 hidden w-[36%] lg:block">
              <ReceiptWindow />
            </Parallax>
            <Parallax speed={65} className="absolute left-5 right-5 top-0 lg:left-[28%] lg:right-auto lg:w-[44%]">
              <ContractWindow />
            </Parallax>
            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-opal to-transparent" />
          </div>
        </div>

        {/* Logo cloud */}
        <div className="border-y border-ink/15 bg-white/50">
          <p className="pt-5 text-center font-mono text-[11px] uppercase tracking-[0.14em] text-cement">Built on the stack the hackathon is about</p>
          <div className="flex flex-wrap items-center justify-center gap-x-12 gap-y-4 px-5 py-6">
            {stack.map((s) => <span key={s} className="font-display text-[22px] font-extrabold tracking-h3 text-ink/55">{s}</span>)}
          </div>
        </div>

        {/* Product */}
        <Section id="product" className="pt-24">
          <Reveal>
            <Title serif="Connected agent workflows" bold="for every invoice question" />
            <p className="mx-auto mt-5 max-w-2xl text-center text-[16px] text-ink/70">
              Cosign splits the AP job into specialists that cross-check one another, then lets a contract, not a model, decide whether money moves.
            </p>
          </Reveal>

          <div className="mt-14">
            <Feature
              eyebrow="Agents that sign"
              title="Eight specialists, each allowed to do exactly one thing."
              body="Reader, Verifier, Matcher, Sentinel and Treasurer sign verdicts. The Executor alone can spend, and only what the contract releases. Matcher and Sentinel run on different models so their errors differ."
              cta="Meet the agents"
              stat={['Cannot pay alone', 'No agent holds spending authority except the Executor, and only through the policy contract.']}
              visual={<AgentsCard />}
            />
            <Feature
              flip
              eyebrow="Contract that decides"
              title="Governed releases, enforced on Arc, not in a prompt."
              body="Eight rules cover quorum, signer reputation, matching hashes, unanimous PASS, screened payees, limits, the paid set and freshness. Any gap holds the payment and escalates to a human."
              cta="Replay a blocked payment"
              stat={['Zero duplicates', 'The on-chain paid set rejects any second payment of the same invoice hash.']}
              visual={<RulesCard />}
            />
            <Feature
              eyebrow="Reputation from outcomes"
              title="Scores that move only when the Auditor proves who was right."
              body="Every agent posts a USDC bond. A confirmed catch raises its score. A PASS that contributed to a bad payment lowers it and slashes the bond into a loss-recovery pool."
              cta="See the reputation log"
              stat={['No self-rating', 'No agent-to-agent ratings. Only Auditor events change a score.']}
              visual={<ScoreCard />}
            />
          </div>
        </Section>

        {/* Proof stats */}
        <Section id="proof" className="pb-10 pt-12">
          <Stagger className="grid gap-px border border-ink/15 bg-ink/15 md:grid-cols-3" gap={0.12}>
            {stats.map(([n, t, s]) => (
              <StaggerItem key={n} className="bg-white p-8">
                <p className="font-serif text-[64px] italic leading-none">{n}</p>
                <p className="mt-4 text-[15px] text-ink/75">{t}</p>
                <p className="mt-3 font-mono text-[11px] text-cement">{s}</p>
              </StaggerItem>
            ))}
          </Stagger>
        </Section>

        {/* Personas */}
        <Section id="teams" className="pt-20">
          <Reveal><Title serif="Loved by" bold="the people who pay and get paid" /></Reveal>
          <Stagger className="mt-12 grid gap-px border border-ink/15 bg-ink/15 sm:grid-cols-2 lg:grid-cols-4">
            {personas.map(([n, s, j]) => (
              <StaggerItem key={n} className="flex flex-col justify-between bg-white p-7">
                <div>
                  <h3 className="font-display text-[22px] font-extrabold leading-tight tracking-h3">{n}</h3>
                  <p className="mt-3 text-ink/65">{s}</p>
                </div>
                <p className="mt-8 border-t border-ink/10 pt-4 text-[13px]"><span className="eyebrow mr-1">Job</span>{j}</p>
              </StaggerItem>
            ))}
          </Stagger>
        </Section>

        {/* Integration */}
        <Section id="stack" className="pt-28">
          <Reveal>
            <Title serif="Built on Circle" bold="where it earns its place" />
            <p className="mx-auto mt-5 max-w-xl text-center text-ink/70">Five pieces are live on Arc testnet today. One more is built and waiting on Circle access. The rest is on the roadmap, and we don’t claim it.</p>
          </Reveal>
          <Stagger className="mt-12 grid gap-px border border-ink/15 bg-ink/15 md:grid-cols-3" gap={0.07}>
            {integrations.map(([n, d, status], i) => (
              <StaggerItem key={n} className="bg-white p-7">
                <div className={`mb-6 grid h-28 place-items-center border border-ink/10 ${status === 'live' ? 'bg-gradient-to-br from-rose/20 to-lilac/30' : 'bg-opal'}`}>
                  <span className={`font-display text-[30px] font-black tracking-h1 ${status === 'live' ? 'text-ink/70' : 'text-ink/35'}`}>{n}</span>
                </div>
                <div className="flex items-center justify-between">
                  <p className="font-mono text-[11px] text-cement">0{i + 1}</p>
                  <span className={`border px-1.5 font-mono text-[10px] uppercase tracking-[0.08em] ${status === 'live' ? 'border-jade/70 bg-jade/15 text-[#2c6b57]' : status === 'built' ? 'border-violet/50 bg-lilac/30 text-violet' : 'border-ink/20 text-cement'}`}>{status === 'live' ? 'Live on testnet' : status === 'built' ? 'Built, not live' : 'Roadmap'}</span>
                </div>
                <p className="mt-2 text-ink/70">{d}</p>
              </StaggerItem>
            ))}
          </Stagger>
        </Section>

        {/* FAQ */}
        <Section id="faq" className="pt-28">
          <Reveal><h2 className="text-center font-display text-[40px] font-extrabold tracking-h1">FAQ</h2></Reveal>
          <Reveal className="mx-auto mt-10 max-w-3xl border-t border-ink/15">
            {faqs.map(([q, a]) => (
              <details key={q} className="group border-b border-ink/15 py-5">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-6 text-[16px] font-semibold">
                  {q}
                  <span className="font-mono text-[18px] transition-transform group-open:rotate-45">+</span>
                </summary>
                <p className="mt-3 max-w-2xl text-ink/70">{a}</p>
              </details>
            ))}
          </Reveal>
        </Section>

        {/* Final CTA */}
        <Section className="py-28 text-center">
          <Reveal>
            <h2 className="font-serif text-[48px] italic leading-none sm:text-[72px]">Getting started is easy.</h2>
            <p className="mx-auto mt-5 max-w-lg text-[16px] text-ink/70">Re-verify the real Arc run from the chain, or open the app and run your own invoice through the agents.</p>
            <div className="mt-8 flex flex-wrap justify-center gap-4">
              <HandleButton href="/dashboard" solid>Open the app</HandleButton>
              <Link href="/onchain" className="border border-ink/25 bg-white/70 px-5 py-3 text-[15px] leading-none hover:border-ink">Verify on-chain</Link>
            </div>
          </Reveal>
        </Section>

      </div>
    </>
  );
}
