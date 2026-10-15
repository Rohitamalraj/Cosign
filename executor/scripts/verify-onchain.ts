import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { JsonRpcProvider } from 'ethers';
import { readAgentState, verifyRun, type Deployment, type RecordedCase } from '../src/verify';
import { CCTP_DESTINATIONS } from '../src/cctp';
import { existsSync } from 'node:fs';
import { Contract, getBytes, hexlify } from 'ethers';
import type { Receipt } from '../src/receipt';

/** Re-check every recorded run against the CURRENT policy (deployments/onchain-demo*.json) from chain state. Needs no keys. Exit code 1 on any mismatch. */
async function main() {
  const dir = resolve(process.cwd(), '..', 'deployments');
  const dep = JSON.parse(readFileSync(join(dir, 'arc-testnet.json'), 'utf8'));
  const cases: RecordedCase[] = [];
  for (const f of readdirSync(dir).filter((x) => /^onchain-demo.*\.json$/.test(x))) {
    const run = JSON.parse(readFileSync(join(dir, f), 'utf8')) as { policy: string; cases: RecordedCase[] };
    if (run.policy?.toLowerCase() === dep.policy.toLowerCase()) cases.push(...run.cases);
  }
  const demo = { cases };
  const receipts = readdirSync(join(dir, 'receipts')).filter((f) => existsSync(join(dir, 'receipts', f)) && f.endsWith('.json')).map((f) => JSON.parse(readFileSync(join(dir, 'receipts', f), 'utf8')) as Receipt);
  const provider = new JsonRpcProvider('https://rpc.testnet.arc.io');
  const d: Deployment = { chainId: dep.chainId, usdc: dep.usdc, registry: dep.registry, policy: dep.policy, approver: dep.approver };

  const base = CCTP_DESTINATIONS[6];
  const cross = { dest: new JsonRpcProvider(base.rpcUrl), destination: base, tokenMessenger: dep.tokenMessenger ?? '', destUsdc: '0x036CbD53842c5426634e7929541eC2318f3dCF7e' };
  const res = await verifyRun(provider, d, demo.cases, receipts, cross);
  for (const c of res.cases) {
    console.log(`Case ${c.case}: ${c.summary}`);
    for (const k of c.checks) console.log(`    ${k.ok ? 'ok  ' : 'FAIL'} ${k.name}: ${k.detail}`);
  }
  for (const r of res.receipts) console.log(`Receipt ${r.invoiceHash.slice(0, 12)}…: replay ${r.ok ? 'OK' : 'FAILED'} (${r.checks.length} checks)`);

  // ERC-8004 identities, if registered: each NFT is still owned by the operator and its metadata names the signer.
  let identityOk = true;
  if (existsSync(join(dir, 'erc8004.json'))) {
    const erc = JSON.parse(readFileSync(join(dir, 'erc8004.json'), 'utf8')) as { identityRegistry: string; agents: Record<string, { erc8004AgentId: number; owner: string; signer: string }> };
    const id = new Contract(erc.identityRegistry, ['function ownerOf(uint256) view returns (address)', 'function getMetadata(uint256, string) view returns (bytes)'], provider);
    console.log('\nERC-8004 identities (' + erc.identityRegistry + '):');
    for (const [role, a] of Object.entries(erc.agents)) {
      const owner = (await id.ownerOf(a.erc8004AgentId)) as string;
      const signer = hexlify(getBytes(await id.getMetadata(a.erc8004AgentId, 'cosign.signer')));
      const ok = owner.toLowerCase() === a.owner.toLowerCase() && signer.toLowerCase() === a.signer.toLowerCase();
      identityOk = identityOk && ok;
      console.log(`    ${ok ? 'ok  ' : 'FAIL'} ${role} #${a.erc8004AgentId}: owner ${owner}, card signer ${signer}`);
    }
  }

  const state = await readAgentState(provider, d, [1, 2, 3, 4, 5]);
  console.log(`\nReputation now (min score ${state.minScore}, min bond ${state.minBondUsdc} USDC, auditor ${state.auditor}):`);
  for (const a of state.agents) console.log(`    agent ${a.agentId}: score ${a.scoreNow}, bond ${a.bondUsdc} USDC, eligible ${a.eligible}`);

  const all = res.ok && identityOk;
  console.log(all ? '\nALL VERIFIED from chain state' : '\nSOME CHECKS FAILED');
  process.exit(all ? 0 : 1);
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
