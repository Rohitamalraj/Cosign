import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { initiateDeveloperControlledWalletsClient } from '@circle-fin/developer-controlled-wallets';
import { Contract, JsonRpcProvider, Wallet, formatUnits } from 'ethers';
import {
  CircleSigner, CircleSubmitter, Executor, FileStore, POLICY_ABI, REGISTRY_ABI, humanApprovalTypedData, packHumanSig, replayReceipt,
  type ReleaseOutcome,
} from '../src';

// Run the REAL agents against the testnet-scale data (amounts / 1000, the faucet gives ~20 USDC).
process.env.COSIGN_AGENTS_DATA = resolve(process.cwd(), '..', 'agents', 'data-testnet');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const agents = require('../../agents/src') as typeof import('../../agents/src');

const ROOT = resolve(process.cwd(), '..');
const dep = JSON.parse(readFileSync(join(ROOT, 'deployments', 'arc-testnet.json'), 'utf8'));
const local = JSON.parse(readFileSync(join(process.cwd(), 'circle-wallets.local.json'), 'utf8')) as { wallets: Record<string, { id: string; address: string }> };
const EXPLORER = 'https://explorer.testnet.arc.io';

/** Only the approver key is read from contracts/.env; the deployer key is never loaded into this process. */
function approverKey(): string {
  const line = readFileSync(join(ROOT, 'contracts', '.env'), 'utf8').split(/\r?\n/).find((l) => l.startsWith('APPROVER_PRIVATE_KEY='));
  if (!line) throw new Error('APPROVER_PRIVATE_KEY missing in contracts/.env (run contracts/scripts/setup-arc.js)');
  return line.split('=')[1].trim();
}

async function main() {
  const client = initiateDeveloperControlledWalletsClient({ apiKey: process.env.CIRCLE_API_KEY!, entitySecret: process.env.CIRCLE_ENTITY_SECRET! });
  const provider = new JsonRpcProvider('https://rpc.testnet.arc.io');
  const policy = new Contract(dep.policy, POLICY_ABI, provider);
  const registryRead = new Contract(dep.registry, REGISTRY_ABI, provider);
  const usdc = new Contract(dep.usdc, ['function balanceOf(address) view returns (uint256)'], provider);
  const bal = async (a: string) => Number(formatUnits(await usdc.balanceOf(a), 6));

  const signers = Object.fromEntries(agents.ROLE_ORDER.map((r) => [r, new CircleSigner(client, local.wallets[r].id, local.wallets[r].address)])) as Record<(typeof agents.ROLE_ORDER)[number], CircleSigner>;
  const agentIds = Object.fromEntries(agents.ROLE_ORDER.map((r, i) => [r, i + 1])) as Record<(typeof agents.ROLE_ORDER)[number], number>;
  const cfg = { chainId: 5042002, policyAddress: dep.policy as string, agentIds, llm: agents.llmConfigFromEnv() };

  const store = new FileStore(join(process.cwd(), 'store-arc'));
  const executor = new Executor({
    policy, store,
    submitter: new CircleSubmitter(client, local.wallets.EXECUTOR.id, dep.policy),
    receiptTimeoutMs: 120_000, pollIntervalMs: 2_000,
  });
  const approver = new Wallet(approverKey());

  const ledger = agents.loadDemoLedger();
  const log: unknown[] = [];
  const show = (o: ReleaseOutcome) => (o.status === 'RELEASED' || o.status === 'ALREADY_RELEASED' ? `${o.status} ${EXPLORER}/tx/${o.txHash}` : o.status === 'HELD' ? `HELD rule ${o.rule}: ${o.reason}` : `PENDING ${o.txHash}`);

  for (const c of agents.DEMO_CASES) {
    console.log(`\n=== Case ${c.id}: ${c.title}`);
    const r = await agents.processInvoice(agents.readDemoInvoice(c.file), ledger, cfg, signers);
    console.log('  agents:', agents.ROLE_ORDER.map((role) => `${role.slice(0, 3)}:${r.results[role]!.verdict}`).join(' '), '->', r.decision);
    if (!r.package) { console.log('  no package'); log.push({ case: c.id, decision: r.decision }); continue; }

    const payee = r.package.req.payee;
    const before = await bal(payee);
    let out = await executor.release(r.package);
    console.log('  executor:', show(out));

    if (c.id === 'E' && out.status === 'HELD') {
      const expiry = Math.floor(Date.now() / 1000) + 3600;
      const td = humanApprovalTypedData({ chainId: 5042002n, policyAddress: dep.policy, invoiceHash: r.package.req.invoiceHash, payee, amount: r.package.req.amount, expiry });
      const humanSig = packHumanSig(expiry, await approver.signTypedData(td.domain, td.types, td.value));
      out = await executor.release({ ...r.package, humanSig });
      console.log('  after human approval:', show(out));
    }

    let replay: { ok: boolean } | null = null;
    if ((out.status === 'RELEASED' || out.status === 'ALREADY_RELEASED') && out.receipt) {
      replay = await replayReceipt(out.receipt, { registry: registryRead, approver: approver.address });
      console.log('  receipt replay:', replay.ok ? 'OK (signatures, registry, receipt hash, human signature)' : 'FAILED');
      mkdirSync(join(ROOT, 'deployments', 'receipts'), { recursive: true });
      writeFileSync(join(ROOT, 'deployments', 'receipts', `${r.package.req.invoiceHash}.json`), JSON.stringify(out.receipt, null, 2) + '\n');
      if (c.id === 'A') agents.recordPaid(ledger, r.parsed, r.invoiceHash!, 'northwind'); // so the Sentinel can catch case B
    }
    const after = await bal(payee);
    console.log(`  payee USDC ${before} -> ${after}`);
    log.push({
      case: c.id, title: c.title, invoice: r.parsed.invoiceNumber, amountUsdc: Number(r.package.req.amount) / 1e6, decision: r.decision,
      verdicts: Object.fromEntries(agents.ROLE_ORDER.map((role) => [role, r.results[role]!.verdict])),
      executor: out.status, rule: out.status === 'HELD' ? out.rule : undefined, reason: out.status === 'HELD' ? out.reason : undefined,
      txHash: 'txHash' in out ? out.txHash : undefined, explorer: 'txHash' in out ? `${EXPLORER}/tx/${out.txHash}` : undefined,
      invoiceHash: r.package.req.invoiceHash, payee, payeeUsdcBefore: before, payeeUsdcAfter: after, receiptReplayOk: replay?.ok ?? null,
    });
  }

  writeFileSync(join(ROOT, 'deployments', 'onchain-demo.json'), JSON.stringify({ network: 'arc-testnet', policy: dep.policy, ranAt: new Date().toISOString(), cases: log }, null, 2) + '\n');
  console.log('\nwrote deployments/onchain-demo.json');
  void copyFileSync;
}

main().catch((e) => {
  const r = (e as { response?: { status?: number; data?: unknown } })?.response;
  console.error('failed:', r ? `HTTP ${r.status} ${JSON.stringify(r.data)}` : (e instanceof Error ? e.stack : e));
  process.exit(1);
});

