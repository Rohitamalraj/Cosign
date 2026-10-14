/**
 * Deploy AgentRegistry and CosignPolicy to Arc testnet against the REAL USDC token.
 *   npx hardhat run scripts/deploy-arc.js --network arcTestnet
 * Writes ../deployments/arc-testnet.json (public addresses only).
 *
 * Testnet-scale parameters: the faucet gives ~20 USDC, so the minimum agent bond is 1 USDC and the
 * per-transaction limit is 5 USDC. Production values would be far higher.
 */
const fs = require('node:fs');
const path = require('node:path');
const { ethers, network } = require('hardhat');

const ARC_TESTNET_USDC = '0x3600000000000000000000000000000000000000';
const usdc = (n) => ethers.parseUnits(String(n), 6);

async function main() {
  if (network.name !== 'arcTestnet') throw new Error('run with --network arcTestnet');
  const [deployer] = await ethers.getSigners();
  const { chainId } = await ethers.provider.getNetwork();
  if (chainId !== 5042002n) throw new Error(`unexpected chain ${chainId}`);

  const token = new ethers.Contract(ARC_TESTNET_USDC, ['function decimals() view returns (uint8)', 'function symbol() view returns (string)', 'function balanceOf(address) view returns (uint256)'], ethers.provider);
  if ((await token.decimals()) !== 6n) throw new Error('USDC ERC-20 interface is not 6 decimals');
  console.log(`deployer ${deployer.address}, USDC balance ${ethers.formatUnits(await token.balanceOf(deployer.address), 6)}`);

  const Registry = await ethers.getContractFactory('AgentRegistry');
  const registry = await Registry.deploy(ARC_TESTNET_USDC, deployer.address); // recovery pool = deployer for the demo
  await registry.waitForDeployment();
  console.log('AgentRegistry', registry.target);

  const Policy = await ethers.getContractFactory('CosignPolicy');
  const policy = await Policy.deploy(ARC_TESTNET_USDC, registry.target, usdc(5));
  await policy.waitForDeployment();
  console.log('CosignPolicy ', policy.target);

  await (await registry.setConfig(50, 40, usdc(1))).wait(); // initial score 50, min score 40, min bond 1 USDC
  console.log('registry config set: minBond 1 USDC');

  const out = {
    network: 'arc-testnet',
    chainId: 5042002,
    usdc: ARC_TESTNET_USDC,
    registry: registry.target,
    policy: policy.target,
    policyVersion: await policy.POLICY_VERSION(),
    perTxLimitUsdc: 5,
    minBondUsdc: 1,
    deployer: deployer.address,
    deployedAt: new Date().toISOString(),
    explorer: {
      registry: `https://explorer.testnet.arc.io/address/${registry.target}`,
      policy: `https://explorer.testnet.arc.io/address/${policy.target}`,
    },
  };
  const file = path.join(__dirname, '..', '..', 'deployments', 'arc-testnet.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(out, null, 2) + '\n');
  console.log('wrote', file);
}

main().catch((e) => { console.error(e.shortMessage || e.message); process.exit(1); });
