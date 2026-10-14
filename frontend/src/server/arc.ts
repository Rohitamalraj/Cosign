import 'server-only';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { JsonRpcProvider } from 'ethers';
import { readAgentState, verifyRun, type Deployment, type RecordedCase, type RunVerification, type AgentState } from '../../../executor/src/verify';
import type { Receipt } from '../../../executor/src/receipt';

/**
 * Read-only view of the Arc testnet run: the recorded deployment and demo (deployments/*.json), re-verified against
 * the chain's RPC. It needs no keys and can only read, so it is safe to serve publicly.
 */

const DIR = process.env.COSIGN_DEPLOYMENTS ?? resolve(process.cwd(), '..', 'deployments');
const RPC = process.env.ARC_TESTNET_RPC_URL ?? 'https://rpc.testnet.arc.io';
const TTL_MS = 30_000;

const json = <T>(f: string): T | null => (existsSync(join(DIR, f)) ? (JSON.parse(readFileSync(join(DIR, f), 'utf8')) as T) : null);

export interface AuditorEvent {
  agent: string; agentId: number; kind: string; case: string; reason: string; seeded: boolean;
  scoreDelta: number; slashUsdc: number; scoreBefore: number; scoreAfter: number; tx: string; explorer: string;
}

export interface ArcView {
  available: boolean;
  deployment?: Record<string, unknown> & { policy: string; registry: string; usdc: string; chainId: number; explorer?: { policy: string; registry: string } };
  cases?: (RecordedCase & { verification?: RunVerification['cases'][number] })[];
  receipts?: RunVerification['receipts'];
  verifiedOk?: boolean;
  checkedAt?: string;
  agents?: AgentState[];
  reputation?: { minScore: number; minBondUsdc: number; auditor: string };
  auditorEvents?: AuditorEvent[];
  auditorNote?: string;
  error?: string;
}

const g = globalThis as unknown as { __arcCache?: { at: number; view: ArcView } };

export async function getArcView(force = false): Promise<ArcView> {
  if (!force && g.__arcCache && Date.now() - g.__arcCache.at < TTL_MS) return g.__arcCache.view;

  const dep = json<Deployment & Record<string, unknown> & { policy: string; registry: string; usdc: string; chainId: number }>('arc-testnet.json');
  const demo = json<{ cases: RecordedCase[] }>('onchain-demo.json');
  if (!dep || !demo) return { available: false };

  const receipts: Receipt[] = existsSync(join(DIR, 'receipts'))
    ? readdirSync(join(DIR, 'receipts')).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(readFileSync(join(DIR, 'receipts', f), 'utf8')) as Receipt)
    : [];
  const audit = json<{ events: AuditorEvent[]; note: string }>('auditor-events.json');

  const view: ArcView = { available: true, deployment: dep, auditorEvents: audit?.events ?? [], auditorNote: audit?.note };
  try {
    const provider = new JsonRpcProvider(RPC, undefined, { staticNetwork: true });
    const d: Deployment = { chainId: dep.chainId, usdc: dep.usdc, registry: dep.registry, policy: dep.policy, approver: dep.approver as string | undefined };
    const [res, state] = await Promise.all([verifyRun(provider, d, demo.cases, receipts), readAgentState(provider, d, [1, 2, 3, 4, 5])]);
    view.cases = demo.cases.map((c) => ({ ...c, verification: res.cases.find((v) => v.case === c.case) }));
    view.receipts = res.receipts;
    view.verifiedOk = res.ok;
    view.checkedAt = res.checkedAt;
    view.agents = state.agents;
    view.reputation = { minScore: state.minScore, minBondUsdc: state.minBondUsdc, auditor: state.auditor };
    provider.destroy();
  } catch (e) {
    // The chain RPC can be down or slow. Show the recorded run, and say it could not be re-verified right now.
    view.cases = demo.cases;
    view.error = `Could not reach the Arc RPC to re-verify: ${e instanceof Error ? e.message.slice(0, 160) : 'unknown error'}`;
  }
  g.__arcCache = { at: Date.now(), view };
  return view;
}
