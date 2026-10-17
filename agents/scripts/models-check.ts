/**
 * Runs the agents with REAL language models on a few invoices and prints what each model said next to the rules.
 *   node --import tsx scripts/models-check.ts          (loads ../frontend/.env.local for the model settings and keys)
 * Keys are read from the environment and never printed.
 */
import { resolve } from 'node:path';

try { process.loadEnvFile(resolve(__dirname, '..', '..', 'frontend', '.env.local')); } catch { /* use the existing environment */ }
process.env.COSIGN_AGENTS_DATA = resolve(__dirname, '..', 'data-testnet');

import { DEMO_CASES, llmConfigFromEnv, loadAgentKeys, loadDemoLedger, processInvoice, readDemoInvoice, recordPaid, ROLE_ORDER } from '../src';

async function main() {
  const llm = llmConfigFromEnv();
  console.log('models configured:', { reader: llm.reader?.id ?? null, matcher: llm.matcher?.id ?? null, sentinel: llm.sentinel?.id ?? null });
  const ledger = loadDemoLedger();
  const cfg = { chainId: 5042002, policyAddress: '0x' + '33'.repeat(20), agentIds: { READER: 1, VERIFIER: 2, MATCHER: 3, SENTINEL: 4, TREASURER: 5 }, llm, now: () => new Date('2026-10-15T12:00:00Z') };

  const texts: { label: string; text: string }[] = [
    ...['A', 'B', 'D'].map((id) => ({ label: `example ${id}`, text: readDemoInvoice(DEMO_CASES.find((c) => c.id === id)!.file) })),
    // An invoice in a layout the parser does not know, so the Reader's model has to propose the fields.
    {
      label: 'off-template layout',
      text: readDemoInvoice(DEMO_CASES.find((c) => c.id === 'A')!.file)
        .replace('INVOICE INV-1041', 'Tax Invoice no. 7788 (copy)')
        .replace('Pay to wallet:', 'Remit USDC to:'),
    },
  ];

  for (const t of texts) {
    const r = await processInvoice(t.text, ledger, cfg, loadAgentKeys({}));
    console.log(`\n=== ${t.label}: ${r.decision}`);
    for (const role of ROLE_ORDER) {
      const res = r.results[role]!;
      const modelChecks = res.checks.filter((c) => c.name.startsWith('llm') || c.name === 'model_gap_fill');
      console.log(`  ${role.padEnd(9)} ${res.verdict.padEnd(8)} model=${res.llm ? `${res.llm.model} used=${res.llm.used}${res.llm.error ? ` ERROR=${res.llm.error.slice(0, 80)}` : ''}` : 'none'}`);
      for (const c of modelChecks) console.log(`      model> ${c.status}: ${c.detail.slice(0, 130)}`);
    }
    if (t.label === 'example A' && r.invoiceHash) recordPaid(ledger, r.parsed, r.invoiceHash, 'northwind');
  }
}
main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
