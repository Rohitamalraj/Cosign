// Mock data for the Cosign frontend. Replace with API calls later; shapes follow the PRD.

export type Role = 'READER' | 'VERIFIER' | 'MATCHER' | 'SENTINEL' | 'TREASURER';
export type Verdict = 'PASS' | 'FAIL' | 'ESCALATE';
/** ready = all agents PASS and the contract would release; released = paid on-chain. */
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
  caseId?: 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G';
  /** Chain the payment settles on ("Arc", or e.g. "Base Sepolia" via CCTP). */
  chain?: string;
  payeeFull?: string;
  hashFull?: string;
  /** Per-agent deterministic checks and model traces, straight from the agents. */
  checks?: Partial<Record<Role, AgentCheck[]>>;
  llm?: Partial<Record<Role, { model: string; used: boolean; error?: string }>>;
  decision?: 'READY' | 'NEEDS_HUMAN' | 'HOLD';
  flags?: string[];
  /** The wallet that submitted this invoice. */
  createdBy?: string;
  /** Explorer link for the payment transaction, once paid. */
  txUrl?: string;
  /** Cross-chain payments: the mint on the destination chain. */
  settlement?: { state: string; chain: string; mintTx: string | null; error: string | null };
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


// ---- The roles (static descriptions only; scores and bonds are read live from the registry on Arc) ----

export interface Agent {
  id: number;
  name: string;
  role: string;
  job: string;
  canSpend: boolean;
}

export const agents: Agent[] = [
  { id: 1, name: 'Reader', role: 'READER', job: 'Turn an invoice into structured data', canSpend: false },
  { id: 2, name: 'Verifier', role: 'VERIFIER', job: 'Confirm counterparty, destination wallet and settlement chain', canSpend: false },
  { id: 3, name: 'Matcher', role: 'MATCHER', job: 'Check the invoice against the contract or PO', canSpend: false },
  { id: 4, name: 'Sentinel', role: 'SENTINEL', job: 'Catch duplicates, near-duplicates and anomalies', canSpend: false },
  { id: 5, name: 'Treasurer', role: 'TREASURER', job: 'Choose when to pay', canSpend: false },
  { id: 6, name: 'Executor', role: 'EXECUTOR', job: 'Send the payment the contract releases', canSpend: true },
  { id: 7, name: 'Auditor', role: 'AUDITOR', job: 'Turn what really happened into reputation changes on-chain', canSpend: false },
];
