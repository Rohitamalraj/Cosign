// Mock data for the Cosign frontend. Replace with API calls later; shapes follow the PRD.

export type Role = 'READER' | 'VERIFIER' | 'MATCHER' | 'SENTINEL' | 'TREASURER';
export type Verdict = 'PASS' | 'FAIL' | 'ESCALATE';
/** ready = all agents PASS and the contract would release; released = paid (simulated until the Executor is on Arc). */
export type Status = 'released' | 'ready' | 'held' | 'escalated' | 'pending';
export type RuleState = 'pass' | 'fail' | 'wait';

export const REQUIRED_ROLES: Role[] = ['READER', 'VERIFIER', 'MATCHER', 'SENTINEL', 'TREASURER'];
export const PER_TX_LIMIT = 5000;
export const POLICY_VERSION = 'policy-v0.2.0';

export const RULES = [
  { n: 1, label: 'All five roles attested', why: 'Independent agreement, not one opinion' },
  { n: 2, label: 'Signers registered, reputation and bond above threshold', why: 'Only accountable agents count' },
  { n: 3, label: 'invoiceHash, payee and amount match across attestations', why: 'Stops mix-and-match and tampering' },
  { n: 4, label: 'Every verdict is PASS', why: 'Doubt is never averaged away' },
  { n: 5, label: 'Payee allowlisted, or cooling-off and challenge complete', why: 'Targets wallet-swap fraud' },
  { n: 6, label: 'Within per-transaction limit, or human signature', why: 'Bounded authority' },
  { n: 7, label: 'invoiceHash never paid before', why: 'Duplicate and retry protection' },
  { n: 8, label: 'Attestations are fresh', why: 'Stops stale approvals' },
] as const;

export interface Attestation {
  role: Role;
  verdict: Verdict;
  confidence: number;
  agentId: number;
  note: string;
  cid: string;
}

export interface AgentCheck {
  name: string;
  status: 'pass' | 'fail' | 'warn' | 'info';
  detail: string;
}

/** Live invoice as returned by the API: the real agents' output, mapped for the UI. */
export interface Invoice {
  /** Unique key: the full invoice hash. `id` is the human-facing invoice number and is not unique. */
  uid: string;
  id: string;
  caseId?: 'A' | 'B' | 'C' | 'D' | 'E';
  payeeFull?: string;
  hashFull?: string;
  /** Per-agent deterministic checks and model traces, straight from the agents. */
  checks?: Partial<Record<Role, AgentCheck[]>>;
  llm?: Partial<Record<Role, { model: string; used: boolean; error?: string }>>;
  decision?: 'READY' | 'NEEDS_HUMAN' | 'HOLD';
  flags?: string[];
  /** True while payment is recorded in the demo ledger only; no chain transaction exists. */
  simulated?: boolean;
  source?: string;
  processedAt?: string;
  vendor: string;
  amount: number;
  category: string;
  received: string;
  due: string;
  payee: string;
  hash: string;
  status: Status;
  headline: string;
  attestations: Attestation[];
  ruleOverrides: Partial<Record<number, RuleState>>;
  tx?: string;
  humanSig?: string;
  injectedText?: string;
}


export function evalRules(inv: Invoice): RuleState[] {
  return RULES.map((r) => inv.ruleOverrides[r.n] ?? 'pass');
}


// ---- Agents and reputation ----

/** Static roster used by the docs page for job descriptions. Scores, bonds and reputation are NOT here: they are read live from the registry on Arc. */
export interface Agent {
  id: number;
  name: string;
  role: string;
  job: string;
  model: string;
  wallet: string;
  score: number;
  bond: number;
  slashed: number;
  verdicts: number;
  correct: number;
  trend: number[];
  canSpend: boolean;
}

export const agents: Agent[] = [
  { id: 11, name: 'Reader', role: 'READER', job: 'Turn an invoice into structured data', model: 'Model A', wallet: '0x11aa…01', score: 91, bond: 250, slashed: 0, verdicts: 34, correct: 33, trend: [84, 86, 87, 89, 90, 91, 91], canSpend: false },
  { id: 12, name: 'Verifier', role: 'VERIFIER', job: 'Confirm counterparty and destination wallet', model: 'Model A', wallet: '0x12bb…02', score: 88, bond: 500, slashed: 0, verdicts: 34, correct: 32, trend: [70, 74, 78, 82, 84, 86, 88], canSpend: false },
  { id: 17, name: 'Matcher', role: 'MATCHER', job: 'Check invoice against contract and PO', model: 'Model B', wallet: '0x17cc…03', score: 84, bond: 500, slashed: 0, verdicts: 34, correct: 31, trend: [80, 81, 82, 83, 83, 84, 84], canSpend: false },
  { id: 21, name: 'Sentinel', role: 'SENTINEL', job: 'Catch duplicates and anomalies', model: 'Model C', wallet: '0x21dd…04', score: 79, bond: 400, slashed: 100, verdicts: 34, correct: 30, trend: [82, 83, 85, 60, 66, 73, 79], canSpend: false },
  { id: 26, name: 'Treasurer', role: 'TREASURER', job: 'Choose when to pay', model: 'Model B', wallet: '0x26ee…05', score: 76, bond: 300, slashed: 0, verdicts: 34, correct: 29, trend: [60, 64, 67, 70, 72, 74, 76], canSpend: false },
  { id: 31, name: 'Executor', role: 'EXECUTOR', job: 'Send the payment the contract releases', model: 'No model', wallet: '0x31ff…06', score: 100, bond: 1000, slashed: 0, verdicts: 0, correct: 0, trend: [100, 100, 100, 100, 100, 100, 100], canSpend: true },
  { id: 34, name: 'Collector', role: 'COLLECTOR', job: 'Chase receivables', model: 'Model A', wallet: '0x3400…07', score: 72, bond: 200, slashed: 0, verdicts: 0, correct: 0, trend: [55, 60, 63, 66, 69, 71, 72], canSpend: false },
  { id: 38, name: 'Auditor', role: 'AUDITOR', job: 'Reconcile payments and score agents', model: 'Reads chain, not summaries', wallet: '0x3811…08', score: 95, bond: 500, slashed: 0, verdicts: 0, correct: 0, trend: [92, 93, 93, 94, 95, 95, 95], canSpend: false },
];
