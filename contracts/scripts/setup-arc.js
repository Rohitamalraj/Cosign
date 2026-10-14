/**
 * One-time wiring of the deployed contracts on Arc testnet:
 *  - sets the Executor (a Circle wallet), the human approver and the screener
 *  - allowlists the demo vendors and sets category budgets
 *  - registers the five signing agents (Circle wallets) with a 1 USDC bond each
 *  - funds the policy contract with USDC so it can pay
 *   npx hardhat run scripts/setup-arc.js --network arcTestnet
 */
const fs = require('node:fs');
const path = require('node:path');
const { ethers, network } = require('hardhat');

const root = path.join(__dirname, '..', '..');
const read = (p) => JSON.parse(fs.readFileSync(path.join(root, p), 'utf8'));
const usdc = (n) => ethers.parseUnits(String(n), 6);
const ROLES = ['READER', 'VERIFIER', 'MATCHER', 'SENTINEL', 'TREASURER'];

async function main() {
  if (network.name !== 'arcTestnet') throw new Error('run with --network arcTestnet');
  const [deployer] = await ethers.getSigners();
  const dep = read('deployments/arc-testnet.json');
  const circle = read('deployments/circle-wallets-arc-testnet.json').addresses;
  const ledger = read('agents/data-testnet/ledger.json');

  // The human approver: a person's wallet in real life. For the demo it is a throwaway testnet key kept in contracts/.env.
  let approverKey = process.env.APPROVER_PRIVATE_KEY;
  if (!approverKey) {
    approverKey = ethers.Wallet.createRandom().privateKey;
    fs.appendFileSync(path.join(__dirname, '..', '.env'), `APPROVER_PRIVATE_KEY=${approverKey}\n`);
    console.log('generated an approver key into contracts/.env');
  }
  const approver = new ethers.Wallet(approverKey).address;

  const token = new ethers.Contract(dep.usdc, ['function approve(address,uint256) returns (bool)', 'function transfer(address,uint256) returns (bool)', 'function balanceOf(address) view returns (uint256)'], deployer);
  const registry = await ethers.getContractAt('AgentRegistry', dep.registry);
  const policy = await ethers.getContractAt('CosignPolicy', dep.policy);
  const send = async (label, p) => { const tx = await p; await tx.wait(); console.log('  ok', label, tx.hash); };

  console.log('policy roles');
  await send('setExecutor', policy.setExecutor(circle.EXECUTOR));
  await send('setHumanApprover', policy.setHumanApprover(approver));
  await send('setScreener', policy.setScreener(deployer.address));

  console.log('vendors and budgets');
  for (const v of ledger.vendors) {
    await send(`registerPayee ${v.name}`, policy.registerPayee(v.wallet, true));
    await send(`budget ${v.category}`, policy.setBudget(ethers.id(v.category), usdc(100)));
  }

  console.log('agents');
  if ((await registry.nextAgentId()) > 1n) {
    console.log('  agents already registered, skipping');
  } else {
    await send('approve bonds', token.approve(dep.registry, usdc(ROLES.length)));
    for (let i = 0; i < ROLES.length; i++) {
      await send(`register ${ROLES[i]} -> ${circle[ROLES[i]]}`, registry.register(i, circle[ROLES[i]], usdc(1)));
    }
  }

  const want = usdc(11.5); // 1.25 (case A) + 9.80 (case E) + margin
  if ((await token.balanceOf(dep.policy)) < want) await send('fund policy 11.5 USDC', token.transfer(dep.policy, want));

  // Gas on Arc is paid in USDC, so the Executor's Circle wallet needs a little. (Circle's faucet API refused this key.)
  if ((await ethers.provider.getBalance(circle.EXECUTOR)) < ethers.parseUnits('0.2', 18)) {
    await send('send 0.5 USDC gas to the Executor wallet', token.transfer(circle.EXECUTOR, usdc(0.5)));
  }

  const out = { ...dep, executor: circle.EXECUTOR, approver, screener: deployer.address, agents: Object.fromEntries(ROLES.map((r, i) => [r, { agentId: i + 1, signer: circle[r] }])) };
  fs.writeFileSync(path.join(root, 'deployments', 'arc-testnet.json'), JSON.stringify(out, null, 2) + '\n');

  console.log('\nexecutor   ', circle.EXECUTOR, '| approver', approver);
  console.log('policy USDC', ethers.formatUnits(await token.balanceOf(dep.policy), 6), '| deployer USDC', ethers.formatUnits(await token.balanceOf(deployer.address), 6));
}

main().catch((e) => { console.error(e.shortMessage || e.message); process.exit(1); });
