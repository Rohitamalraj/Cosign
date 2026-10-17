/** Send test USDC into CosignTreasury (AMOUNT, default 5). npx hardhat run scripts/fund-treasury-arc.js --network arcTestnet */
const fs = require('node:fs');
const path = require('node:path');
const { ethers } = require('hardhat');
(async () => {
  const [deployer] = await ethers.getSigners();
  const dep = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'deployments', 'arc-testnet.json'), 'utf8'));
  const token = new ethers.Contract(dep.usdc, ['function transfer(address,uint256) returns (bool)', 'function balanceOf(address) view returns (uint256)'], deployer);
  const amount = ethers.parseUnits(process.env.AMOUNT ?? '5', 6);
  const tx = await token.transfer(dep.treasury.address, amount);
  await tx.wait();
  console.log('sent', ethers.formatUnits(amount, 6), tx.hash);
  console.log('treasury USDC', ethers.formatUnits(await token.balanceOf(dep.treasury.address), 6), '| deployer', ethers.formatUnits(await token.balanceOf(deployer.address), 6));
})().catch((e) => { console.error(e.shortMessage || e.message); process.exit(1); });
