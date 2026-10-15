/**
 * Owner-only wiring for the live web app (run by the deployer key, never by the server):
 *   - policy.screener  -> the SCREENER Circle wallet (the app registers payees when an admin adds a vendor)
 *   - registry.auditor -> the AUDITOR Circle wallet (the app writes reputation outcomes reported by operators)
 *   - gas for both wallets, category budgets, and the cooling-off period
 *   - optionally the human approver (APPROVER_ADDRESS): the person who signs over-limit payments in their wallet
 *   npx hardhat run scripts/wire-live-arc.js --network arcTestnet
 *   APPROVER_ADDRESS=0x... COOLING_OFF_SECONDS=600 npx hardhat run scripts/wire-live-arc.js --network arcTestnet
 * Re-runnable: only changes what differs.
 */
const fs = require('node:fs');
const path = require('node:path');
const { ethers, network } = require('hardhat');

const root = path.join(__dirname, '..', '..');
const usdc = (n) => ethers.parseUnits(String(n), 6);
const CATEGORIES = ['design', 'infrastructure', 'marketing', 'production', 'software', 'legal', 'travel', 'general'];

async function main() {
  if (network.name !== 'arcTestnet') throw new Error('run with --network arcTestnet');
  const [deployer] = await ethers.getSigners();
  const dep = JSON.parse(fs.readFileSync(path.join(root, 'deployments', 'arc-testnet.json'), 'utf8'));
  const wallets = JSON.parse(fs.readFileSync(path.join(root, 'deployments', 'circle-wallets-arc-testnet.json'), 'utf8')).addresses;
  const policy = await ethers.getContractAt('CosignPolicy', dep.policy);
  const registry = await ethers.getContractAt('AgentRegistry', dep.registry);
  const token = new ethers.Contract(dep.usdc, ['function transfer(address,uint256) returns (bool)'], deployer);
  const send = async (label, p) => { const tx = await p; await tx.wait(); console.log('  ok', label, tx.hash); };

  if ((await policy.screener()).toLowerCase() !== wallets.SCREENER.toLowerCase()) await send('policy.setScreener', policy.setScreener(wallets.SCREENER));
  if ((await registry.auditor()).toLowerCase() !== wallets.AUDITOR.toLowerCase()) await send('registry.setAuditor', registry.setAuditor(wallets.AUDITOR));

  for (const role of ['SCREENER', 'AUDITOR']) {
    if ((await ethers.provider.getBalance(wallets[role])) < ethers.parseUnits('0.1', 18)) await send(`gas for ${role}`, token.transfer(wallets[role], usdc(0.5)));
  }

  for (const c of CATEGORIES) {
    const id = ethers.id(c);
    if ((await policy.categoryBudget(id)) < usdc(100)) await send(`budget ${c}`, policy.setBudget(id, usdc(100)));
  }

  const cooling = BigInt(process.env.COOLING_OFF_SECONDS ?? '600');
  if ((await policy.coolingOff()) !== cooling) await send(`coolingOff ${cooling}s`, policy.setCoolingOff(cooling));

  if (process.env.APPROVER_ADDRESS) {
    const a = ethers.getAddress(process.env.APPROVER_ADDRESS);
    if ((await policy.humanApprover()).toLowerCase() !== a.toLowerCase()) await send(`policy.setHumanApprover ${a}`, policy.setHumanApprover(a));
    dep.approver = a;
  }
  dep.screener = wallets.SCREENER;
  dep.auditor = wallets.AUDITOR;
  dep.coolingOffSeconds = Number(cooling);
  fs.writeFileSync(path.join(root, 'deployments', 'arc-testnet.json'), JSON.stringify(dep, null, 2) + '\n');
  console.log('screener', await policy.screener(), '| auditor', await registry.auditor(), '| approver', await policy.humanApprover(), '| coolingOff', (await policy.coolingOff()).toString());
}
main().catch((e) => { console.error(e.shortMessage || e.message); process.exit(1); });
