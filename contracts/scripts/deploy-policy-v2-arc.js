/**
 * Deploy CosignPolicy v0.2 (CCTP destinations) to Arc testnet and re-wire it. The AgentRegistry, the five registered
 * agents (and their bonds) and the Treasury are reused, so reputation carries over. The v0.1 policy is archived in
 * deployments/arc-testnet.json under `previous`; its receipts still verify against it.
 *   npx hardhat run scripts/deploy-policy-v2-arc.js --network arcTestnet
 */
const fs = require('node:fs');
const path = require('node:path');
const { ethers, network } = require('hardhat');

const root = path.join(__dirname, '..', '..');
const usdc = (n) => ethers.parseUnits(String(n), 6);
const TOKEN_MESSENGER_V2 = '0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA'; // Arc testnet, from Arc's contract-address docs
const BASE_SEPOLIA_DOMAIN = 6;
const CHAIN_DOMAINS = { arc: 26, 'ethereum sepolia': 0, 'op sepolia': 2, 'arbitrum sepolia': 3, 'base sepolia': 6 };

async function main() {
  if (network.name !== 'arcTestnet') throw new Error('run with --network arcTestnet');
  const [deployer] = await ethers.getSigners();
  const file = path.join(root, 'deployments', 'arc-testnet.json');
  const dep = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (dep.policyVersion === 'policy-v0.2.0') throw new Error('policy v0.2 is already deployed; refusing to redeploy');
  const ledger = JSON.parse(fs.readFileSync(path.join(root, 'agents', 'data-testnet', 'ledger.json'), 'utf8'));
  const send = async (label, p) => { const tx = await p; await tx.wait(); console.log('  ok', label, tx.hash); };

  const policy = await (await ethers.getContractFactory('CosignPolicy')).deploy(dep.usdc, dep.registry, usdc(5));
  await policy.waitForDeployment();
  console.log('CosignPolicy v0.2', policy.target);

  await send('setExecutor', policy.setExecutor(dep.executor));
  await send('setHumanApprover', policy.setHumanApprover(dep.approver));
  await send('setScreener', policy.setScreener(deployer.address));
  await send('setTokenMessenger', policy.setTokenMessenger(TOKEN_MESSENGER_V2));

  const seen = new Set();
  for (const v of ledger.vendors) {
    await send(`registerPayee ${v.name} (Arc)`, policy.registerPayee(v.wallet, true));
    for (const c of v.chains ?? ['arc']) {
      if (c !== 'arc') await send(`registerRemotePayee ${v.name} on ${c}`, policy.registerRemotePayee(CHAIN_DOMAINS[c], v.wallet, true));
    }
    if (!seen.has(v.category)) { seen.add(v.category); await send(`budget ${v.category}`, policy.setBudget(ethers.id(v.category), usdc(100))); }
  }

  if (dep.treasury) {
    const treasury = await ethers.getContractAt('CosignTreasury', dep.treasury.address);
    await send('treasury payout -> new policy', treasury.setPayoutPolicy(policy.target));
  }

  // The faucet is small: keep ~0.4 USDC of gas in the deployer, put the rest in the policy.
  const token = new ethers.Contract(dep.usdc, ['function transfer(address,uint256) returns (bool)', 'function balanceOf(address) view returns (uint256)'], deployer);
  const spare = (await token.balanceOf(deployer.address)) - usdc(0.4);
  if (spare > 0n) await send(`fund policy ${ethers.formatUnits(spare, 6)} USDC`, token.transfer(policy.target, spare));

  dep.previous = { ...(dep.previous ?? {}), 'policy-v0.1.0': { policy: dep.policy, policyVersion: dep.policyVersion, deployedAt: dep.deployedAt, note: 'Archived. Receipts from the first live run verify against this contract.' } };
  dep.policy = policy.target;
  dep.policyVersion = await policy.POLICY_VERSION();
  dep.tokenMessenger = TOKEN_MESSENGER_V2;
  dep.deployedAt = new Date().toISOString();
  dep.explorer.policy = `https://explorer.testnet.arc.io/address/${policy.target}`;
  fs.writeFileSync(file, JSON.stringify(dep, null, 2) + '\n');
  console.log('wrote', file, '| policy USDC', ethers.formatUnits(await token.balanceOf(policy.target), 6));
}
main().catch((e) => { console.error(e.shortMessage || e.message); process.exit(1); });
