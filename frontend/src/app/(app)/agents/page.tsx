import { Card, PageHeader, Sparkline } from '@/components/ui';
import { agents, auditEvents } from '@/lib/data';

const kindLabel = {
  catch: 'Confirmed catch',
  miss: 'Confirmed miss',
  'false-block': 'False block',
  'human-for': 'Human agreed',
  'human-against': 'Human disagreed',
} as const;

export default function Agents() {
  const slashed = agents.reduce((s, a) => s + a.slashed, 0);

  return (
    <>
      <PageHeader
        eyebrow="Agents, reputation and bonds"
        title="Eight agents, one job each. Only one can spend."
        sub="Scores come only from the Auditor’s outcomes, per role, on a rolling window, and each agent posts a USDC bond that is slashed for a proven bad approval. The scores and bonds below are mock: the Auditor is not built yet, so nothing moves them."
      />

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {agents.map((a) => (
          <Card key={a.id} className={a.canSpend ? '!border-violet' : ''}>
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="eyebrow">Agent #{a.id}</p>
                <h2 className="h3 mt-1.5">{a.name}</h2>
              </div>
              {a.canSpend && <span className="border border-violet bg-violet/10 px-1.5 py-0.5 font-mono text-[10px] uppercase text-violet">Can spend</span>}
            </div>
            <p className="mt-2 min-h-[42px] text-ink/70">{a.job}</p>

            <div className="mt-4 flex items-end justify-between">
              <div>
                <p className="eyebrow">Score</p>
                <p className="font-display text-[34px] font-extrabold leading-none tracking-h3">{a.score}</p>
              </div>
              <Sparkline data={a.trend} />
            </div>

            <dl className="mt-4 space-y-1.5 border-t border-ink/10 pt-3 font-mono text-[12px]">
              <div className="flex justify-between"><dt className="text-cement">Bond</dt><dd>{a.bond} USDC{a.slashed ? ` (−${a.slashed} slashed)` : ''}</dd></div>
              <div className="flex justify-between"><dt className="text-cement">Model</dt><dd>{a.model}</dd></div>
              <div className="flex justify-between"><dt className="text-cement">Wallet</dt><dd>{a.wallet}</dd></div>
              {a.verdicts > 0 && (
                <div className="flex justify-between"><dt className="text-cement">Matched outcome</dt><dd>{a.correct}/{a.verdicts}</dd></div>
              )}
            </dl>
          </Card>
        ))}
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-12">
        <Card className="lg:col-span-8">
          <h2 className="h2 mb-4">Auditor event log</h2>
          <ul className="divide-y divide-ink/10">
            {auditEvents.map((e) => (
              <li key={e.id} className="grid gap-1 py-3 sm:grid-cols-[110px_130px_1fr_90px] sm:gap-4">
                <span className="font-mono text-[12px] text-cement">{e.id} · {e.invoice}</span>
                <span>
                  <span className="font-semibold">{e.agent}</span>
                  <span className="block font-mono text-[11px] text-cement">{kindLabel[e.kind]}</span>
                </span>
                <span className="text-ink/75">{e.text}</span>
                <span className={`font-mono text-[13px] sm:text-right ${e.delta >= 0 ? 'text-[#2c6b57]' : 'text-[#8e2e2a]'}`}>
                  {e.delta > 0 ? '+' : ''}{e.delta} pts{e.bondDelta ? ` · ${e.bondDelta} USDC` : ''}
                </span>
              </li>
            ))}
          </ul>
        </Card>

        <div className="grid gap-4 lg:col-span-4">
          <Card className="bg-ink text-opal">
            <p className="eyebrow !text-lilac">Loss-recovery pool</p>
            <p className="mt-3 font-display text-[44px] font-extrabold leading-none tracking-h1">{slashed.toFixed(2)}</p>
            <p className="mt-2 text-opal/70">USDC slashed from agent bonds, held for the business.</p>
          </Card>
          <Card>
            <h2 className="h2">How scores move</h2>
            <ul className="mt-3 space-y-2 text-[13px] text-ink/75">
              <li>Confirmed FAIL catch: large increase</li>
              <li>PASS on a later-proven bad payment: large decrease and partial slash</li>
              <li>FAIL on a legitimate invoice: moderate decrease</li>
              <li>Human sides with or against an ESCALATE: small change</li>
              <li>No agent-to-agent ratings. Only Auditor events count.</li>
            </ul>
            <p className="mt-3 font-mono text-[11px] text-cement">Thresholds and slash sizes are demo assumptions.</p>
          </Card>
        </div>
      </div>
    </>
  );
}
