import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { JsonRpcProvider } from 'ethers';
import { readAgentState, verifyRun, type Deployment, type RecordedCase } from '../src/verify';
import type { Receipt } from '../src/receipt';

/** Re-check deployments/onchain-demo.json against the Arc testnet RPC. Needs no keys. Exit code 1 on any mismatch. */
async function main() {
  const dir = resolve(process.cwd(), '..', 'deployments');
  const dep = JSON.parse(readFileSync(join(dir, 'arc-testnet.json'), 'utf8'));
  const demo = JSON.parse(readFileSync(join(dir, 'onchain-demo.json'), 'utf8')) as { cases: RecordedCase[] };
  const receipts = readdirSync(join(dir, 'receipts')).map((f) => JSON.parse(readFileSync(join(dir, 'receipts', f), 'utf8')) as Receipt);
  const provider = new JsonRpcProvider('https://rpc.testnet.arc.io');
  const d: Deployment = { chainId: dep.chainId, usdc: dep.usdc, registry: dep.registry, policy: dep.policy, approver: dep.approver };

  const res = await verifyRun(provider, d, demo.cases, receipts);
  for (const c of res.cases) {
    console.log(`Case ${c.case}: ${c.summary}`);
    for (const k of c.checks) console.log(`    ${k.ok ? 'ok  ' : 'FAIL'} ${k.name}: ${k.detail}`);
  }
  for (const r of res.receipts) console.log(`Receipt ${r.invoiceHash.slice(0, 12)}…: replay ${r.ok ? 'OK' : 'FAILED'} (${r.checks.length} checks)`);

  const state = await readAgentState(provider, d, [1, 2, 3, 4, 5]);
  console.log(`\nReputation now (min score ${state.minScore}, min bond ${state.minBondUsdc} USDC, auditor ${state.auditor}):`);
  for (const a of state.agents) console.log(`    agent ${a.agentId}: score ${a.scoreNow}, bond ${a.bondUsdc} USDC, eligible ${a.eligible}`);

  console.log(res.ok ? '\nALL VERIFIED from chain state' : '\nSOME CHECKS FAILED');
  process.exit(res.ok ? 0 : 1);
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
