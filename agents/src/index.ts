import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ledgerFromJson, type Ledger } from './ledger';

export * from './types';
export * from './pipeline';
export * from './llm';
export * from './keys';
export * from './eip712';
export { ledgerFromJson, recordPaid, type Ledger } from './ledger';
export { fmtMicro, parseMicro } from './money';

/** Bundlers (Next.js) rewrite __dirname, so a host app can point at the data folder with COSIGN_AGENTS_DATA. */
export const dataDir = (): string => process.env.COSIGN_AGENTS_DATA ?? join(__dirname, '..', 'data');

export function loadDemoLedger(): Ledger {
  return ledgerFromJson(JSON.parse(readFileSync(join(dataDir(), 'ledger.json'), 'utf8')));
}

export const readDemoInvoice = (name: string): string => readFileSync(join(dataDir(), 'invoices', name), 'utf8');

export const DEMO_CASES = [
  { id: 'A', file: 'case-a-clean.txt', title: 'Clean invoice' },
  { id: 'B', file: 'case-b-near-duplicate.txt', title: 'Near-duplicate' },
  { id: 'C', file: 'case-c-wallet-change.txt', title: 'Wallet change email' },
  { id: 'D', file: 'case-d-injection.txt', title: 'Prompt injection' },
  { id: 'E', file: 'case-e-over-limit.txt', title: 'Over the limit' },
] as const;
