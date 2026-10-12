export type RoleName = 'READER' | 'VERIFIER' | 'MATCHER' | 'SENTINEL' | 'TREASURER';

/** Order matches the contract's `Role` enum. */
export const ROLE_ORDER: RoleName[] = ['READER', 'VERIFIER', 'MATCHER', 'SENTINEL', 'TREASURER'];
export const ROLE_INDEX: Record<RoleName, number> = { READER: 0, VERIFIER: 1, MATCHER: 2, SENTINEL: 3, TREASURER: 4 };

export type VerdictName = 'PASS' | 'FAIL' | 'ESCALATE';
/** Matches the contract's `Verdict` enum. NONE (0) is never signed. */
export const VERDICT_CODE: Record<VerdictName, number> = { PASS: 1, FAIL: 2, ESCALATE: 3 };

export interface LineItem {
  description: string;
  qty: number;
  rateMicro: bigint;
  amountMicro: bigint;
}

/** What the Reader extracts. Everything here is derived from untrusted text. */
export interface ParsedInvoice {
  invoiceNumber: string | null;
  vendorName: string | null;
  senderEmail: string | null;
  issued: string | null; // YYYY-MM-DD
  due: string | null;
  agreementRef: string | null;
  currency: string | null;
  payee: string | null; // lowercase 0x address
  totalMicro: bigint | null;
  lineItems: LineItem[];
  terms: string | null;
  discount: { percent: number; withinDays: number } | null;
  /** Every 0x address found anywhere in the document, lowercase and de-duplicated. */
  bodyAddresses: string[];
  /** A wallet-change notice found in a forwarded message, if any. */
  changeRequest: { fromEmail: string; newWallet: string } | null;
  /** Instruction-like text aimed at an AI agent. Recorded, never followed. */
  injectionFlags: string[];
  sourceSha256: string;
}

export interface Check {
  name: string;
  status: 'pass' | 'fail' | 'warn' | 'info';
  detail: string;
}

export interface LlmTrace {
  model: string;
  used: boolean;
  error?: string;
  opinion?: string;
}

/** One agent's conclusion, before it is bound to an invoice hash and signed. */
export interface AgentResult {
  role: RoleName;
  verdict: VerdictName;
  confidence: number; // 0..1
  note: string;
  checks: Check[];
  /** Role-specific structured output, e.g. the Treasurer's payment plan. */
  extra?: Record<string, unknown>;
  llm?: LlmTrace;
}

export const VERDICT_RANK: Record<VerdictName, number> = { PASS: 0, ESCALATE: 1, FAIL: 2 };

/** Doubt wins: the more severe verdict is always kept. */
export function worstOf(a: VerdictName, b: VerdictName): VerdictName {
  return VERDICT_RANK[a] >= VERDICT_RANK[b] ? a : b;
}
