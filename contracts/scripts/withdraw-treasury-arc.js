/** Owner: move idle USDC out of CosignTreasury to an address (default: the policy). AMOUNT default 7. npx hardhat run scripts/withdraw-treasury-arc.js --network arcTestnet */
const fs = require('node:fs');
const path = require('node:path');
const { ethers } = require('hardhat');
(async () => {
  const dep = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'deployments', 'arc-testnet.json'), 'utf8'));
  const t = await ethers.getContractAt('CosignTreasury', dep.treasury.address);
  const token = new ethers.Contract(dep.usdc, ['function balanceOf(address) view returns (uint256)'], ethers.provider);
  const to = process.env.TO ?? dep.policy;
  const amount = ethers.parseUnits(process.env.AMOUNT ?? '7', 6);
  const tx = await t.withdrawUsdc(to, amount);
  await tx.wait();
  console.log('moved', ethers.formatUnits(amount, 6), 'USDC to', to, tx.hash);
  console.log('policy', ethers.formatUnits(await token.balanceOf(dep.policy), 6), '| treasury', ethers.formatUnits(await token.balanceOf(dep.treasury.address), 6));
})().catch((e) => { console.error(e.shortMessage || e.message); process.exit(1); });
