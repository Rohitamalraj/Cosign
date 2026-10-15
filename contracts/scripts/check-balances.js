const fs = require('node:fs');
const path = require('node:path');
const { ethers } = require('hardhat');
(async () => {
  const dep = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'deployments', 'arc-testnet.json'), 'utf8'));
  const token = new ethers.Contract(dep.usdc, ['function balanceOf(address) view returns (uint256)'], ethers.provider);
  for (const [n, a] of Object.entries({ deployer: dep.deployer, executor: dep.executor, oldPolicy: dep.policy, treasury: dep.treasury?.address })) {
    if (a) console.log(n.padEnd(10), a, ethers.formatUnits(await token.balanceOf(a), 6), 'USDC (erc20) |', ethers.formatUnits(await ethers.provider.getBalance(a), 18), 'native');
  }
})();
