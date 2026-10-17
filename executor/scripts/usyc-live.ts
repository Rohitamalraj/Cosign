import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { initiateDeveloperControlledWalletsClient } from '@circle-fin/developer-controlled-wallets';
import { Contract, JsonRpcProvider, formatUnits, parseUnits } from 'ethers';
import { CircleSigner, circleCall } from '../src/circle';

/**
 * A REAL USYC round trip on Arc testnet, through the real Teller:
 *   1. the Treasurer agent (a Circle-held key) signs an INVEST order; the Executor wallet submits it to CosignTreasury,
 *      which subscribes USDC to USYC;
 *   2. the Treasurer signs a REDEEM order; the Executor submits it; the USDC comes back to the policy contract only.
 * Each step is first simulated with eth_call so a revert (for example a missing entitlement) is explained before any
 * transaction is sent. Writes ../deployments/usyc-live.json (public hashes and amounts).
 *   node --env-file=.env --import tsx scripts/usyc-live.ts [investUsdc]
 */
const ROOT = join(process.cwd(), '..');
const dep = JSON.parse(readFileSync(join(ROOT, 'deployments', 'arc-testnet.json'), 'utf8')) as { usdc: string; policy: string; executor: string; treasury: { address: string; usyc: string; teller: string }; agents: Record<string, { agentId: number; signer: string }> };
const local = JSON.parse(readFileSync(join(process.cwd(), 'circle-wallets.local.json'), 'utf8')) as { wallets: Record<string, { id: string; address: string }> };
const EXPLORER = 'https://explorer.testnet.arc.io';

const ORDER_TYPES = {
  TreasuryOrder: [
    { name: 'action', type: 'uint8' }, { name: 'amount', type: 'uint256' }, { name: 'agentId', type: 'uint256' },
    { name: 'expiry', type: 'uint64' }, { name: 'nonce', type: 'uint256' },
  ],
};
const ORDER_TUPLE = '(uint8,uint256,uint256,uint64,uint256)';
const TREASURY_ABI = [
  `function invest(${ORDER_TUPLE} order, bytes sig) returns (uint256)`,
  `function redeem(${ORDER_TUPLE} order, bytes sig) returns (uint256)`,
  'function investedPrincipal() view returns (uint256)',
  'function maxInvestBps() view returns (uint16)',
  'function operatingFloor() view returns (uint256)',
  'function operator() view returns (address)',
  'function payoutPolicy() view returns (address)',
];
const ERC20 = ['function balanceOf(address) view returns (uint256)'];

async function main() {
  const investUsdc = process.argv[2] ?? '3';
  const provider = new JsonRpcProvider('https://rpc.testnet.arc.io');
  const client = initiateDeveloperControlledWalletsClient({ apiKey: process.env.CIRCLE_API_KEY!, entitySecret: process.env.CIRCLE_ENTITY_SECRET! });
  const treasurer = new CircleSigner(client, local.wallets.TREASURER.id, local.wallets.TREASURER.address);
  const treasury = new Contract(dep.treasury.address, TREASURY_ABI, provider);
  const usdc = new Contract(dep.usdc, ERC20, provider);
  const usyc = new Contract(dep.treasury.usyc, ERC20, provider);
  const agentId = dep.agents.TREASURER.agentId;
  const n = (v: bigint) => formatUnits(v, 6);

  const state = async () => ({
    treasuryUsdc: await usdc.balanceOf(dep.treasury.address) as bigint,
    treasuryUsyc: await usyc.balanceOf(dep.treasury.address) as bigint,
    policyUsdc: await usdc.balanceOf(dep.policy) as bigint,
    principal: await treasury.investedPrincipal() as bigint,
  });

  console.log('operator', await treasury.operator(), '(Executor wallet is', dep.executor + ')');
  console.log('limits: max invested', Number(await treasury.maxInvestBps()) / 100 + '%', '| operating floor', n(await treasury.operatingFloor()), 'USDC | payout ->', await treasury.payoutPolicy());
  const before = await state();
  console.log('before:', Object.fromEntries(Object.entries(before).map(([k, v]) => [k, n(v)])));

  const domain = { name: 'CosignTreasury', version: '1', chainId: 5042002, verifyingContract: dep.treasury.address };
  const order = async (action: 0 | 1, amount: bigint) => {
    const o = { action, amount, agentId, expiry: Math.floor(Date.now() / 1000) + 3600, nonce: BigInt(Date.now()) * 1000n + BigInt(action) };
    const sig = await treasurer.signTypedData(domain, ORDER_TYPES, o);
    return { o, sig, tuple: [o.action, o.amount.toString(), o.agentId, o.expiry, o.nonce.toString()] };
  };

  // ---- 1. INVEST ----
  const inv = await order(0, parseUnits(investUsdc, 6));
  console.log(`\nTreasurer signed INVEST ${investUsdc} USDC. Simulating against the real Teller...`);
  try {
    const shares = await treasury.getFunction('invest').staticCall(inv.tuple, inv.sig, { from: dep.executor });
    console.log('  simulation ok: would mint', n(shares), 'USYC');
  } catch (e) {
    console.log('  SIMULATION REVERTED:', (e as { shortMessage?: string }).shortMessage ?? (e as Error).message.slice(0, 200));
    console.log('  Not sending. (A revert here usually means the treasury is not entitled yet, or a limit was hit.)');
    process.exit(1);
  }
  const investTx = await circleCall(client, { walletId: local.wallets.EXECUTOR.id, contractAddress: dep.treasury.address, signature: `invest(${ORDER_TUPLE},bytes)`, params: [inv.tuple, inv.sig], idempotencyKey: `usyc-invest:${dep.treasury.address}:${inv.o.nonce}` });
  const afterInvest = await state();
  console.log('  INVEST confirmed', `${EXPLORER}/tx/${investTx.txHash}`);
  console.log('  after invest:', Object.fromEntries(Object.entries(afterInvest).map(([k, v]) => [k, n(v)])));
  if (afterInvest.treasuryUsyc === 0n) throw new Error('invest confirmed but the treasury holds no USYC');

  // ---- 2. REDEEM (all the USYC just bought) ----
  const red = await order(1, afterInvest.treasuryUsyc);
  console.log(`\nTreasurer signed REDEEM ${n(afterInvest.treasuryUsyc)} USYC. Simulating...`);
  try {
    const assets = await treasury.getFunction('redeem').staticCall(red.tuple, red.sig, { from: dep.executor });
    console.log('  simulation ok: would return', n(assets), 'USDC to the policy');
  } catch (e) {
    console.log('  SIMULATION REVERTED:', (e as { shortMessage?: string }).shortMessage ?? (e as Error).message.slice(0, 200));
    console.log('  The invest succeeded, so the position is open; redeem is not sent. Tell me this output.');
    writeFileSync(join(ROOT, 'deployments', 'usyc-live.json'), JSON.stringify({ network: 'arc-testnet', treasury: dep.treasury.address, ranAt: new Date().toISOString(), invest: { usdc: investUsdc, tx: investTx.txHash }, redeem: null, note: 'redeem simulation reverted' }, null, 2) + '\n');
    process.exit(1);
  }
  const redeemTx = await circleCall(client, { walletId: local.wallets.EXECUTOR.id, contractAddress: dep.treasury.address, signature: `redeem(${ORDER_TUPLE},bytes)`, params: [red.tuple, red.sig], idempotencyKey: `usyc-redeem:${dep.treasury.address}:${red.o.nonce}` });
  const afterRedeem = await state();
  console.log('  REDEEM confirmed', `${EXPLORER}/tx/${redeemTx.txHash}`);
  console.log('  after redeem:', Object.fromEntries(Object.entries(afterRedeem).map(([k, v]) => [k, n(v)])));
  const gained = afterRedeem.policyUsdc - before.policyUsdc;
  console.log(`\nThe policy contract received ${n(gained)} USDC from the redeem (invested ${investUsdc}).`);

  writeFileSync(join(ROOT, 'deployments', 'usyc-live.json'), JSON.stringify({
    network: 'arc-testnet', treasury: dep.treasury.address, teller: dep.treasury.teller, usyc: dep.treasury.usyc, ranAt: new Date().toISOString(),
    invest: { usdc: investUsdc, usycReceived: n(afterInvest.treasuryUsyc), tx: investTx.txHash, explorer: `${EXPLORER}/tx/${investTx.txHash}` },
    redeem: { usyc: n(afterInvest.treasuryUsyc), usdcToPolicy: n(gained), tx: redeemTx.txHash, explorer: `${EXPLORER}/tx/${redeemTx.txHash}` },
    signedBy: `Treasurer agent #${agentId} (Circle wallet ${local.wallets.TREASURER.address})`, submittedBy: 'Executor Circle wallet',
  }, null, 2) + '\n');
  console.log('wrote deployments/usyc-live.json');
}
main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
