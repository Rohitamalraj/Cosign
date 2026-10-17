/** Send test USDC (gas) to one of the Circle operating wallets: ROLE (default EXECUTOR), AMOUNT (default 1). npx hardhat run scripts/fund-gas-arc.js --network arcTestnet */
const fs = require('node:fs');
const path = require('node:path');
const { ethers } = require('hardhat');
(async () => {
  const [deployer] = await ethers.getSigners();
  const dep = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'deployments', 'arc-testnet.json'), 'utf8'));
  const wallets = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'deployments', 'circle-wallets-arc-testnet.json'), 'utf8')).addresses;
  const role = (process.env.ROLE ?? 'EXECUTOR').toUpperCase();
  if (!wallets[role]) throw new Error(`unknown role ${role}`);
  const token = new ethers.Contract(dep.usdc, ['function transfer(address,uint256) returns (bool)'], deployer);
  const tx = await token.transfer(wallets[role], ethers.parseUnits(process.env.AMOUNT ?? '1', 6));
  await tx.wait();
  console.log(role, wallets[role], 'now has', ethers.formatEther(await ethers.provider.getBalance(wallets[role])), 'USDC for gas', tx.hash);
  console.log('deployer left', ethers.formatEther(await ethers.provider.getBalance(deployer.address)));
})().catch((e) => { console.error(e.shortMessage || e.message); process.exit(1); });
