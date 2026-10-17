/** Owner: set the policy's per-transaction limit (LIMIT in USDC, default 5). npx hardhat run scripts/set-limit-arc.js --network arcTestnet */
const fs = require('node:fs');
const path = require('node:path');
const { ethers } = require('hardhat');
(async () => {
  const dep = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'deployments', 'arc-testnet.json'), 'utf8'));
  const p = await ethers.getContractAt('CosignPolicy', dep.policy);
  const limit = ethers.parseUnits(process.env.LIMIT ?? '5', 6);
  const tx = await p.setPerTxLimit(limit);
  await tx.wait();
  console.log('per-transaction limit is now', ethers.formatUnits(await p.perTxLimit(), 6), 'USDC', tx.hash);
})().catch((e) => { console.error(e.shortMessage || e.message); process.exit(1); });
