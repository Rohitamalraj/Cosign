import 'server-only';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { initiateDeveloperControlledWalletsClient } from '@circle-fin/developer-controlled-wallets';
import { Contract, JsonRpcProvider, Wallet } from 'ethers';
import { POLICY_ABI, REGISTRY_READ_ABI } from '../../../executor/src/abi';
import { CctpSettler, CCTP_DESTINATIONS } from '../../../executor/src/cctp';
import { CircleSigner, CircleSubmitter, circleCall } from '../../../executor/src/circle';
import { Executor } from '../../../executor/src/executor';
import type { RoleName } from '../../../agents/src/types';
import type { Db } from './db';
import { PgSettlementStore, PgStore, type ChainFacts } from './repo';

/**
 * The live runtime: everything that touches the chain. It exists only when Circle credentials, wallet ids and a
 * deployment record are all present; otherwise the app runs in preview mode and says so (no payments, no signing).
 *
 * Keys: the agents' signing keys, the Executor, the payee screener and the Auditor are all Circle-held wallets, so no
 * private key exists in this process. The only raw key is the CCTP relayer, which pays destination-chain gas and
 * holds no USDC.
 */

const ROOT = process.env.COSIGN_ROOT ?? resolve(process.cwd(), '..');
const DEPLOYMENTS = process.env.COSIGN_DEPLOYMENTS ?? join(ROOT, 'deployments');
export const ARC_RPC = process.env.ARC_TESTNET_RPC_URL ?? 'https://rpc.testnet.arc.io';
export const EXPLORER = 'https://explorer.testnet.arc.io';

const ROLES: RoleName[] = ['READER', 'VERIFIER', 'MATCHER', 'SENTINEL', 'TREASURER'];

const POLICY_READ_ABI = [
  'function perTxLimit() view returns (uint256)',
  'function humanApprover() view returns (address)',
  'function coolingOff() view returns (uint64)',
  'function categoryBudget(bytes32) view returns (uint256)',
  'function payees(address) view returns (uint64 eligibleAt, bool blocked)',
  'function remotePayees(uint32, address) view returns (uint64 eligibleAt, bool blocked)',
  'function screener() view returns (address)',
];
const REGISTRY_WRITE_ABI = ['function recordOutcome(uint256 agentId, int32 scoreDelta, uint128 slashAmount)'];

export interface Deployment {
  chainId: number; policy: string; registry: string; usdc: string; tokenMessenger?: string; approver?: string;
  treasury?: { address: string };
}

export interface Live {
  chainId: number;
  deployment: Deployment;
  provider: JsonRpcProvider;
  policy: Contract;
  registry: Contract;
  usdc: Contract;
  agentIds: Record<RoleName, number>;
  signers: Record<RoleName, CircleSigner>;
  executor: Executor;
  settler: CctpSettler | null;
  chainFacts(reserveMicro: bigint): Promise<ChainFacts>;
  humanApprover(): Promise<string>;
  /** Gas (USDC) held by one of the operating wallets. A wallet that runs dry cannot send, so this is shown on the dashboard. */
  gasOf(role: 'EXECUTOR' | 'SCREENER' | 'AUDITOR'): Promise<{ address: string; usdc: number }>;
  /** Call a contract as one of the app's operating wallets. Each wallet can only do what the contract allows its role. */
  call(role: 'SCREENER' | 'AUDITOR', args: { contract: string; signature: string; params: unknown[]; key: string }): Promise<{ txHash: string }>;
  circleReady: true;
}

const g = globalThis as unknown as { __cosignLive?: Promise<Live | null> };

function readJson<T>(p: string): T | null {
  return existsSync(p) ? (JSON.parse(readFileSync(p, 'utf8')) as T) : null;
}

/** Why live mode is unavailable, in words an operator can act on. Null when it is available. */
export function liveProblem(env: NodeJS.ProcessEnv = process.env): string | null {
  if (!env.CIRCLE_API_KEY || !env.CIRCLE_ENTITY_SECRET) return 'CIRCLE_API_KEY and CIRCLE_ENTITY_SECRET are not set';
  if (!readJson(join(DEPLOYMENTS, 'arc-testnet.json'))) return 'no deployments/arc-testnet.json';
  if (!walletMap()) return 'no Circle wallet ids (set COSIGN_CIRCLE_WALLETS or provide executor/circle-wallets.local.json)';
  return null;
}

function walletMap(): Record<string, { id: string; address: string }> | null {
  if (process.env.COSIGN_CIRCLE_WALLETS) {
    try { return JSON.parse(process.env.COSIGN_CIRCLE_WALLETS) as Record<string, { id: string; address: string }>; } catch { return null; }
  }
  return readJson<{ wallets: Record<string, { id: string; address: string }> }>(join(ROOT, 'executor', 'circle-wallets.local.json'))?.wallets ?? null;
}

function relayerKey(): string | null {
  return process.env.COSIGN_RELAYER_PRIVATE_KEY ?? readJson<{ privateKey: string }>(join(ROOT, 'executor', 'relayer.local.json'))?.privateKey ?? null;
}

export function getLive(db: Db): Promise<Live | null> {
  // Local development only: load Circle credentials from another env file (for example ../executor/.env) without copying them.
  if (process.env.COSIGN_LOAD_ENV_FILE && !process.env.CIRCLE_API_KEY) {
    try { process.loadEnvFile(resolve(process.cwd(), process.env.COSIGN_LOAD_ENV_FILE)); } catch (e) { console.error('could not load COSIGN_LOAD_ENV_FILE:', (e as Error).message); }
  }
  g.__cosignLive ??= build(db).catch((e) => { console.error('live runtime unavailable:', e instanceof Error ? e.message : e); return null; });
  return g.__cosignLive;
}

async function build(db: Db): Promise<Live | null> {
  if (liveProblem()) return null;
  const dep = readJson<Deployment>(join(DEPLOYMENTS, 'arc-testnet.json'))!;
  const wallets = walletMap()!;
  for (const r of [...ROLES, 'EXECUTOR', 'SCREENER', 'AUDITOR']) if (!wallets[r]) throw new Error(`Circle wallet for ${r} is missing`);

  const client = initiateDeveloperControlledWalletsClient({ apiKey: process.env.CIRCLE_API_KEY!, entitySecret: process.env.CIRCLE_ENTITY_SECRET! });
  const provider = new JsonRpcProvider(ARC_RPC, undefined, { staticNetwork: true });
  const policy = new Contract(dep.policy, [...POLICY_ABI, ...POLICY_READ_ABI], provider);
  const registry = new Contract(dep.registry, [...REGISTRY_READ_ABI, ...REGISTRY_WRITE_ABI], provider);
  const usdc = new Contract(dep.usdc, ['function balanceOf(address) view returns (uint256)'], provider);

  const signers = Object.fromEntries(ROLES.map((r) => [r, new CircleSigner(client, wallets[r].id, wallets[r].address)])) as Record<RoleName, CircleSigner>;
  const agentIds = Object.fromEntries(ROLES.map((r, i) => [r, i + 1])) as Record<RoleName, number>;

  const executor = new Executor({
    policy, store: new PgStore(db),
    submitter: new CircleSubmitter(client, wallets.EXECUTOR.id, dep.policy),
    receiptTimeoutMs: 120_000, pollIntervalMs: 2_000,
  });

  const rk = relayerKey();
  const settler = rk
    ? new CctpSettler(new PgSettlementStore(db), { signerFor: (d) => new Wallet(rk, new JsonRpcProvider(d.rpcUrl)), intervalMs: 15_000, attestTimeoutMs: 30 * 60_000 })
    : null;
  void CCTP_DESTINATIONS;

  return {
    chainId: dep.chainId, deployment: dep, provider, policy, registry, usdc, agentIds, signers, executor, settler, circleReady: true,
    async chainFacts(reserveMicro) {
      const [balance, limit] = await Promise.all([usdc.balanceOf(dep.policy), policy.perTxLimit()]);
      return { balanceMicro: BigInt(balance), perTxLimitMicro: BigInt(limit), reserveMicro };
    },
    humanApprover: async () => (await policy.humanApprover()) as string,
    gasOf: async (role) => ({ address: wallets[role].address, usdc: Number(await provider.getBalance(wallets[role].address)) / 1e18 }),
    call: (role, a) => circleCall(client, { walletId: wallets[role].id, contractAddress: a.contract, signature: a.signature, params: a.params, idempotencyKey: a.key }),
  };
}
