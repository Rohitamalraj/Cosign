/**
 * The Auditor, for the Arc testnet demo. It turns outcomes into on-chain reputation and bond changes through
 * AgentRegistry.recordOutcome, which only the Auditor address can call.
 *
 *   npx hardhat run scripts/audit-arc.js --network arcTestnet
 *
 * HONEST SCOPE: a real Auditor reads external ground truth (a dispute, a recovered payment, a human review).
 * Here the ground truth is scripted, because we built the five invoices and know which are attacks. The script
 * still refuses to credit a "catch" unless the chain agrees the payment was held (not in the paid set) and the
 * agent signed FAIL or ESCALATE. The one slash is a SEEDED stand-in for "an earlier miss", and is marked so.
 * Every event is written to deployments/auditor-events.json with its reason and whether it was seeded.
 */
const fs = require('node:fs');
const path = require('node:path');
const { ethers, network } = require('hardhat');

const root = path.join(__dirname, '..', '..');
const read = (p) => JSON.parse(fs.readFileSync(path.join(root, p), 'utf8'));
const usdc = (n) => ethers.parseUnits(String(n), 6);
const EXPLORER = 'https://explorer.testnet.arc.io/tx/';
const AGENT_ID = { READER: 1, VERIFIER: 2, MATCHER: 3, SENTINEL: 4, TREASURER: 5 };

async function main() {
  if (network.name !== 'arcTestnet') throw new Error('run with --network arcTestnet');
  const [deployer] = await ethers.getSigners();
  const dep = read('deployments/arc-testnet.json');
  const demo = read('deployments/onchain-demo.json');
  const out = path.join(root, 'deployments', 'auditor-events.json');
  if (fs.existsSync(out)) throw new Error('deployments/auditor-events.json exists: the audit already ran (delete it only if you redeployed)');

  const registry = await ethers.getContractAt('AgentRegistry', dep.registry);
  const policy = await ethers.getContractAt('CosignPolicy', dep.policy);
  const token = new ethers.Contract(dep.usdc, ['function approve(address,uint256) returns (bool)'], deployer);
  const send = async (p) => { const tx = await p; await tx.wait(); return tx.hash; };

  // The Auditor is a distinct role. For the demo the deployer plays it; production would be its own key.
  if ((await registry.auditor()).toLowerCase() !== deployer.address.toLowerCase()) {
    console.log('setAuditor', await send(registry.setAuditor(deployer.address)));
  }

  const events = [];
  const record = async ({ agent, delta, slash = 0, kind, case: c, reason, seeded = false }) => {
    const id = AGENT_ID[agent];
    const before = await registry.getAgent(id);
    const hash = await send(registry.recordOutcome(id, delta, usdc(slash)));
    const after = await registry.getAgent(id);
    events.push({ agent, agentId: id, kind, case: c, reason, seeded, scoreDelta: delta, slashUsdc: slash, scoreBefore: Number(before.score), scoreAfter: Number(after.score), bondAfterUsdc: Number(ethers.formatUnits(after.bond, 6)), tx: hash, explorer: EXPLORER + hash });
    console.log(`  ${agent.padEnd(9)} ${String(delta).padStart(3)} score ${before.score}->${after.score}  bond ${ethers.formatUnits(after.bond, 6)}  ${kind}${seeded ? ' (seeded)' : ''}  ${hash}`);
  };

  // 1. Confirmed catches: the chain must agree the payment was held, and the agent must have signed doubt.
  const catches = [
    { case: 'B', agent: 'SENTINEL', verdicts: ['FAIL'], delta: 6, reason: 'Near-duplicate of INV-1041 confirmed against the paid history; payment blocked.' },
    { case: 'C', agent: 'VERIFIER', verdicts: ['ESCALATE', 'FAIL'], delta: 6, reason: 'Wallet-change email held for an out-of-band challenge; payment blocked.' },
    { case: 'D', agent: 'VERIFIER', verdicts: ['FAIL'], delta: 5, reason: 'Injected destination address rejected; payment blocked.' },
    { case: 'D', agent: 'SENTINEL', verdicts: ['FAIL'], delta: 5, reason: 'Instruction-like text aimed at an AI agent flagged; payment blocked.' },
  ];
  console.log('confirmed catches');
  for (const c of catches) {
    const row = demo.cases.find((x) => x.case === c.case);
    if (!row) throw new Error(`demo case ${c.case} missing`);
    const paid = await policy.paid(row.invoiceHash);
    const verdict = row.verdicts[c.agent];
    if (paid || !c.verdicts.includes(verdict)) throw new Error(`case ${c.case}: cannot credit ${c.agent} (paid=${paid}, verdict=${verdict})`);
    await record({ agent: c.agent, delta: c.delta, kind: 'confirmed catch', case: c.case, reason: c.reason });
  }

  // 2. Seeded earlier miss: a PASS that contributed to a duplicate found later. Score drops, bond is slashed into the
  //    recovery pool, and the operator then restores the bond so the agent is eligible again.
  console.log('seeded earlier miss (Sentinel), then the operator restores the bond');
  await record({ agent: 'SENTINEL', delta: -8, slash: 0.2, kind: 'confirmed miss, bond slashed', case: 'earlier', reason: 'SEEDED: stands in for an earlier PASS on an invoice later proven to be a duplicate. Slash goes to the loss-recovery pool.', seeded: true });
  await send(token.approve(dep.registry, usdc(0.2)));
  const topUp = await send(registry.topUpBond(AGENT_ID.SENTINEL, usdc(0.2)));
  console.log('  operator topped the Sentinel bond back up', topUp);

  const agents = {};
  for (const [name, id] of Object.entries(AGENT_ID)) {
    const a = await registry.getAgent(id);
    agents[name] = { agentId: id, score: Number(a.score), bondUsdc: Number(ethers.formatUnits(a.bond, 6)), eligible: await registry.isEligible(id, id - 1) };
  }
  fs.writeFileSync(out, JSON.stringify({ network: 'arc-testnet', registry: dep.registry, auditor: deployer.address, ranAt: new Date().toISOString(), note: 'Ground truth is scripted for the demo. Entries with seeded=true are stand-ins, not real incidents.', events, finalState: agents, bondTopUpTx: topUp }, null, 2) + '\n');
  console.log('\nfinal state:', JSON.stringify(agents));
}

main().catch((e) => { console.error(e.shortMessage || e.message); process.exit(1); });
