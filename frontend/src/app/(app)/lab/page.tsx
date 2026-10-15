'use client';

import { useMemo, useState } from 'react';
import { Card, PageHeader, VerdictPill } from '@/components/ui';
import { REQUIRED_ROLES, type AgentCheck, type Role, type Verdict } from '@/lib/data';
import { useStore } from '@/lib/store';

/** Same rule the agents use (agents/src/agents.ts): any fail is FAIL, any warning is ESCALATE, otherwise PASS. */
const fromChecks = (checks: AgentCheck[]): Verdict => (checks.some((c) => c.status === 'fail') ? 'FAIL' : checks.some((c) => c.status === 'warn') ? 'ESCALATE' : 'PASS');
const RANK: Record<Verdict, number> = { PASS: 0, ESCALATE: 1, FAIL: 2 };
/** Doubt wins: the more severe of two verdicts. */
const worst = (a: Verdict, b: Verdict): Verdict => (RANK[a] >= RANK[b] ? a : b);
const isModel = (c: AgentCheck) => c.name.startsWith('llm');

const tone = (s: AgentCheck['status']) => (s === 'fail' ? 'text-[#8e2e2a]' : s === 'warn' ? 'text-[#7a5a14]' : s === 'pass' ? 'text-[#2c6b57]' : 'text-cement');

export default function DecisionLab() {
  const { invoices, loading } = useStore();
  const [uid, setUid] = useState<string | null>(null);
  // What-if: pretend the model for a role said something else, and see that the signed verdict can only get worse.
  const [whatIf, setWhatIf] = useState<Partial<Record<Role, Verdict>>>({});

  const list = useMemo(() => invoices.filter((i) => i.checks), [invoices]);
  const inv = list.find((i) => i.uid === uid) ?? list.find((i) => i.caseId === 'D') ?? list[0];

  const rows = useMemo(() => {
    if (!inv) return [];
    return REQUIRED_ROLES.map((role) => {
      const all = inv.checks?.[role] ?? [];
      const rules = all.filter((c) => !isModel(c));
      const model = all.filter(isModel);
      const rulesVerdict = fromChecks(rules);
      const modelVerdict: Verdict | null = model.length ? fromChecks(model) : null;
      const signed = inv.attestations.find((a) => a.role === role)?.verdict ?? worst(rulesVerdict, modelVerdict ?? 'PASS');
      const hypo = whatIf[role];
      const hypoSigned = hypo ? worst(rulesVerdict, hypo) : null;
      const moved =
        modelVerdict && RANK[modelVerdict] > RANK[rulesVerdict] ? 'model added doubt'
        : modelVerdict && RANK[modelVerdict] < RANK[rulesVerdict] ? 'rules overruled a more optimistic model'
        : modelVerdict ? 'model agreed with the rules'
        : 'rules only (no model)';
      return { role, rules, model, rulesVerdict, modelVerdict, signed, hypo, hypoSigned, moved, trace: inv.llm?.[role] };
    });
  }, [inv, whatIf]);

  const quorum = rows.length > 0 && rows.every((r) => (r.hypoSigned ?? r.signed) === 'PASS');

  return (
    <>
      <PageHeader
        eyebrow="Decision Lab"
        title="Who decided: the rules, or the model?"
        sub="For each agent: what its deterministic rules concluded, what its language model proposed, and what it signed. A model can only add doubt. It can never turn a FAIL or an ESCALATE into a PASS."
      />

      <Card className="mb-4">
        <label className="eyebrow block" htmlFor="lab-invoice">Invoice</label>
        <select
          id="lab-invoice"
          className="mt-2 w-full border border-ink/20 bg-opal p-2 font-mono text-[13px] outline-none focus:border-violet md:w-auto md:min-w-[420px]"
          value={inv?.uid ?? ''}
          onChange={(e) => { setUid(e.target.value); setWhatIf({}); }}
        >
          {list.map((i) => <option key={i.uid} value={i.uid}>{i.caseId ? `Case ${i.caseId} · ` : ''}{i.id} · {i.vendor}</option>)}
        </select>
        {loading && <p className="mt-2 text-[13px] text-ink/60">The agents are reading the demo invoices…</p>}
        {inv && !Object.values(inv.llm ?? {}).some((m) => m?.used) && (
          <p className="mt-3 border-l-2 border-citrine bg-sand/30 p-3 text-[13px] text-ink/75">
            No language model is configured on this deployment, so every verdict below comes from the deterministic rules alone. Use the what-if boxes to see what a model could and could not change.
            Models are optional; when configured (<span className="font-mono">MATCHER_LLM</span>, <span className="font-mono">SENTINEL_LLM</span>), their opinion appears here next to the rules.
          </p>
        )}
      </Card>

      {inv && (
        <>
          <div className="card mb-4 overflow-x-auto">
            <table className="w-full min-w-[860px] text-left">
              <thead>
                <tr className="border-b border-ink/15">
                  {['Agent', 'Rules alone', 'Model proposed', 'What if the model said…', 'Signed', 'Who moved it'].map((h) => <th key={h} className="eyebrow px-4 py-3 font-medium">{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.role} className="border-b border-ink/10 align-top last:border-0">
                    <td className="px-4 py-3 font-mono text-[12px] font-medium uppercase tracking-[0.06em]">{r.role}</td>
                    <td className="px-4 py-3"><VerdictPill v={r.rulesVerdict} /></td>
                    <td className="px-4 py-3">
                      {r.modelVerdict ? <VerdictPill v={r.modelVerdict} /> : <span className="font-mono text-[11px] text-cement">{r.trace?.error ? `failed: ${r.trace.error.slice(0, 40)}` : 'none'}</span>}
                    </td>
                    <td className="px-4 py-3">
                      <select
                        aria-label={`What if the ${r.role} model said`}
                        className="border border-ink/20 bg-opal p-1 font-mono text-[12px]"
                        value={r.hypo ?? ''}
                        onChange={(e) => setWhatIf((w) => ({ ...w, [r.role]: (e.target.value || undefined) as Verdict | undefined }))}
                      >
                        <option value="">(as is)</option>
                        <option value="PASS">PASS</option>
                        <option value="ESCALATE">ESCALATE</option>
                        <option value="FAIL">FAIL</option>
                      </select>
                      {r.hypoSigned && <div className="mt-1.5 flex items-center gap-1.5 text-[12px]">would sign <VerdictPill v={r.hypoSigned} /></div>}
                    </td>
                    <td className="px-4 py-3"><VerdictPill v={r.signed} /></td>
                    <td className="px-4 py-3 text-[13px] text-ink/70">{r.moved}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mb-4 grid gap-4 lg:grid-cols-2">
            <Card>
              <h2 className="h2 mb-1">What the contract does with these</h2>
              <p className={`mt-2 font-display text-[22px] font-extrabold tracking-h3 ${quorum ? 'text-[#2c6b57]' : 'text-[#8e2e2a]'}`}>
                {quorum ? 'All five sign PASS: rule 4 is satisfied.' : 'Not all five sign PASS: rule 4 fails and nothing moves.'}
              </p>
              <p className="mt-2 text-[13px] text-ink/65">
                The model is never asked whether to pay. It is one input to one agent, and the contract reads only the signed verdicts. Set a what-if box to PASS and the signed verdict does not improve; set it to FAIL and it does get worse.
              </p>
            </Card>
            <Card>
              <h2 className="h2 mb-1">The three rules this page demonstrates</h2>
              <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-[13px] text-ink/75">
                <li>The signed verdict is the worse of the rules and the model. A model cannot lift a verdict.</li>
                <li>A model that errors or times out becomes ESCALATE, never PASS.</li>
                <li>Matcher and Sentinel must use different models, so one model’s blind spot is not shared.</li>
              </ol>
            </Card>
          </div>

          <Card>
            <h2 className="h2 mb-3">The evidence, split by source</h2>
            <div className="grid gap-4 lg:grid-cols-5">
              {rows.map((r) => (
                <div key={r.role}>
                  <p className="eyebrow">{r.role}</p>
                  <p className="mt-2 font-mono text-[10px] uppercase text-cement">Rules</p>
                  <ul className="mt-1 space-y-1">
                    {r.rules.length === 0 && <li className="text-[12px] text-ink/40">—</li>}
                    {r.rules.map((c, k) => <li key={k} className="text-[12px] leading-snug"><span className={`mr-1 font-mono text-[10px] uppercase ${tone(c.status)}`}>{c.status}</span>{c.detail}</li>)}
                  </ul>
                  {r.model.length > 0 && (
                    <>
                      <p className="mt-3 font-mono text-[10px] uppercase text-cement">Model{r.trace ? ` · ${r.trace.model}` : ''}</p>
                      <ul className="mt-1 space-y-1">
                        {r.model.map((c, k) => <li key={k} className="text-[12px] leading-snug"><span className={`mr-1 font-mono text-[10px] uppercase ${tone(c.status)}`}>{c.status}</span>{c.detail}</li>)}
                      </ul>
                    </>
                  )}
                </div>
              ))}
            </div>
          </Card>
        </>
      )}
    </>
  );
}
