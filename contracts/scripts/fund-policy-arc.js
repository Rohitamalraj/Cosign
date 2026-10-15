/** Top the current policy up so it holds at least TARGET USDC (default 11.5). npx hardhat run scripts/fund-policy-arc.js --network arcTestnet */
const fs = require('node:fs');
const path = require('node:path');
const { ethers } = require('hardhat');
(async () => {
  const [deployer] = await ethers.getSigners();
  const dep = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'deployments', 'arc-testnet.json'), 'utf8'));
  const token = new ethers.Contract(dep.usdc, ['function transfer(address,uint256) returns (bool)', 'function balanceOf(address) view returns (uint256)'], deployer);
  const target = ethers.parseUnits(process.env.TARGET ?? '11.5', 6);
  const have = await token.balanceOf(dep.policy);
  if (have < target) { const tx = await token.transfer(dep.policy, target - have); await tx.wait(); console.log('sent', ethers.formatUnits(target - have, 6), tx.hash); }
  console.log('policy USDC', ethers.formatUnits(await token.balanceOf(dep.policy), 6), '| deployer', ethers.formatUnits(await token.balanceOf(deployer.address), 6));
})().catch((e) => { console.error(e.shortMessage || e.message); process.exit(1); });
