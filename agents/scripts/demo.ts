import { DEMO_CASES, loadDemoLedger, readDemoInvoice, loadAgentKeys, llmConfigFromEnv, processInvoice, recordPaid, ROLE_ORDER } from '../src';

/** Runs the five demo cases through all five agents. Set MATCHER_LLM / SENTINEL_LLM to add models (see README). */
async function main() {
  const ledger = loadDemoLedger();
  const keys = loadAgentKeys();
  const llm = llmConfigFromEnv();
  const cfg = {
    chainId: 31337, policyAddress: '0x0000000000000000000000000000000000000001',
    agentIds: { READER: 1, VERIFIER: 2, MATCHER: 3, SENTINEL: 4, TREASURER: 5 },
    llm, now: () => new Date('2026-10-15T12:00:00Z'),
  };
  console.log(`models: matcher=${llm.matcher?.id ?? 'none (deterministic)'}  sentinel=${llm.sentinel?.id ?? 'none (deterministic)'}\n`);

  for (const c of DEMO_CASES) {
    const out = await processInvoice(readDemoInvoice(c.file), ledger, cfg, keys);
    console.log(`Case ${c.id}: ${c.title}  ->  ${out.decision}`);
    for (const role of ROLE_ORDER) {
      const r = out.results[role]!;
      console.log(`  ${role.padEnd(9)} ${r.verdict.padEnd(8)} ${r.confidence.toFixed(2)}  ${r.note}`);
    }
    out.reasons.forEach((x) => console.log(`  ! ${x}`));
    console.log('');
    // Pretend case A was paid, so case B sees it in history.
    if (c.id === 'A' && out.decision === 'READY' && out.invoiceHash) recordPaid(ledger, out.parsed, out.invoiceHash, 'northwind');
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
