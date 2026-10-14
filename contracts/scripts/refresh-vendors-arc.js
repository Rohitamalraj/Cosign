/**
 * After regenerating agents/data-testnet (new vendor wallets): allowlist the new vendors, block the retired ones,
 * and top the policy contract up so it can pay the demo invoices.
 *   npx hardhat run scripts/refresh-vendors-arc.js --network arcTestnet
 */
const fs = require('node:fs');
const path = require('node:path');
const { ethers, network } = require('hardhat');

const root = path.join(__dirname, '..', '..');
const usdc = (n) => ethers.parseUnits(String(n), 6);

// The first demo wallets were derived from a public mnemonic and got swept by a bot. Block them for good.
const RETIRED = [
  '0xcd5691ea878d262516be278cb46f2fd7ff132083', // Northwind (first run)
  '0x9b63f0cef479924e5d2c4e22dbe31e6d0353b448', // Lumen (first run)
  '0xaada98978453263132587d0805c4a17376af9f13', // Orbit (first run)
  '0x55ef996639b608a25ab4293f39247a9e23411d3a', // Kestrel (first run)
];

async function main() {
  if (network.name !== 'arcTestnet') throw new Error('run with --network arcTestnet');
  const [deployer] = await ethers.getSigners();
  const dep = JSON.parse(fs.readFileSync(path.join(root, 'deployments', 'arc-testnet.json'), 'utf8'));
  const ledger = JSON.parse(fs.readFileSync(path.join(root, 'agents', 'data-testnet', 'ledger.json'), 'utf8'));
  const policy = await ethers.getContractAt('CosignPolicy', dep.policy);
  const token = new ethers.Contract(dep.usdc, ['function transfer(address,uint256) returns (bool)', 'function balanceOf(address) view returns (uint256)'], deployer);
  const send = async (label, p) => { const tx = await p; await tx.wait(); console.log('  ok', label, tx.hash); };

  for (const v of ledger.vendors) {
    if ((await policy.payees(v.wallet)).eligibleAt === 0n) await send(`allowlist ${v.name} ${v.wallet}`, policy.registerPayee(v.wallet, true));
    else console.log('  already allowlisted', v.name);
  }
  for (const a of RETIRED) {
    if (!(await policy.payees(a)).blocked) await send(`block retired ${a}`, policy.challengePayee(a));
  }

  const want = usdc(11.5);
  const have = await token.balanceOf(dep.policy);
  if (have < want) await send(`top up policy by ${ethers.formatUnits(want - have, 6)} USDC`, token.transfer(dep.policy, want - have));
  console.log('policy USDC', ethers.formatUnits(await token.balanceOf(dep.policy), 6), '| deployer USDC', ethers.formatUnits(await token.balanceOf(deployer.address), 6));
}

main().catch((e) => { console.error(e.shortMessage || e.message); process.exit(1); });
