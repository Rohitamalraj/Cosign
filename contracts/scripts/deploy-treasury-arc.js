/**
 * Deploy CosignTreasury to Arc testnet against the REAL USYC token and Teller, wired to the existing registry/policy.
 *   npx hardhat run scripts/deploy-treasury-arc.js --network arcTestnet
 * The Treasury is the only address that calls the Teller, so it is the only address Circle must entitle for USYC.
 * Adds a `treasury` section to ../deployments/arc-testnet.json (public addresses only).
 */
const fs = require('node:fs');
const path = require('node:path');
const { ethers, network } = require('hardhat');

const USYC = '0xe9185F0c5F296Ed1797AaE4238D26CCaBEadb86C';
const TELLER = '0x9fdF14c5B14173D74C08Af27AebFf39240dC105A';
const ENTITLEMENTS = '0xcc205224862c7641930c87679e98999d23c26113';

async function main() {
  if (network.name !== 'arcTestnet') throw new Error('run with --network arcTestnet');
  const file = path.join(__dirname, '..', '..', 'deployments', 'arc-testnet.json');
  const dep = JSON.parse(fs.readFileSync(file, 'utf8'));
  const [deployer] = await ethers.getSigners();
  for (const [name, addr] of Object.entries({ USYC, TELLER, ENTITLEMENTS })) {
    if ((await ethers.provider.getCode(addr)) === '0x') throw new Error(`${name} has no code at ${addr}`);
  }
  const Treasury = await ethers.getContractFactory('CosignTreasury');
  const treasury = await Treasury.deploy(dep.usdc, USYC, TELLER, dep.registry);
  await treasury.waitForDeployment();
  console.log('CosignTreasury', treasury.target);
  await (await treasury.setOperator(dep.executor)).wait();
  await (await treasury.setPayoutPolicy(dep.policy)).wait();
  await (await treasury.setLimits(7_000, ethers.parseUnits('1', 6))).wait(); // 70% cap, 1 USDC floor (testnet scale)
  dep.treasury = {
    address: treasury.target,
    usyc: USYC,
    teller: TELLER,
    entitlements: ENTITLEMENTS,
    maxInvestBps: 7000,
    operatingFloorUsdc: 1,
    usycAccess: 'NOT ENTITLED YET: Circle support ticket required before deposit/redeem work on the real Teller',
    deployedAt: new Date().toISOString(),
    explorer: `https://explorer.testnet.arc.io/address/${treasury.target}`,
  };
  fs.writeFileSync(file, JSON.stringify(dep, null, 2) + '\n');
  console.log('updated', file);
}
main().catch((e) => { console.error(e.shortMessage || e.message); process.exit(1); });
