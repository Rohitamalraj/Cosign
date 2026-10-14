import { Contract, Interface, formatUnits, type Provider } from 'ethers';
import { POLICY_ABI, REGISTRY_READ_ABI } from './abi';
import { replayReceipt, type ReplayCheck, type Receipt } from './receipt';

/**
 * Keyless verification: re-check a recorded run straight from a chain's RPC. It needs no API key, no wallet and no
 * trust in whoever produced the records, so it is safe to expose publicly.
 */

export interface Deployment {
  chainId: number;
  usdc: string;
  registry: string;
  policy: string;
  approver?: string;
}

export interface RecordedCase {
  case: string;
  title?: string;
  executor: string; // RELEASED | ALREADY_RELEASED | HELD | PENDING
  txHash?: string;
  invoiceHash: string;
  payee: string;
  amountUsdc: number;
  verdicts?: Record<string, string>;
  reason?: string;
}

export interface CaseVerification {
  case: string;
  ok: boolean;
  kind: 'paid' | 'held';
  summary: string;
  checks: ReplayCheck[];
}

export interface RunVerification {
  ok: boolean;
  checkedAt: string;
  cases: CaseVerification[];
  receipts: { invoiceHash: string; ok: boolean; checks: ReplayCheck[] }[];
}

const releasedIface = new Interface(POLICY_ABI);
const ERC20 = ['function balanceOf(address) view returns (uint256)'];

export async function verifyRun(provider: Provider, dep: Deployment, cases: RecordedCase[], receipts: Receipt[]): Promise<RunVerification> {
  const policy = new Contract(dep.policy, POLICY_ABI, provider);
  const registry = new Contract(dep.registry, REGISTRY_READ_ABI, provider);
  const usdc = new Contract(dep.usdc, ERC20, provider);
  const out: CaseVerification[] = [];

  for (const c of cases) {
    const checks: ReplayCheck[] = [];
    const add = (name: string, ok: boolean, detail: string) => checks.push({ name, ok, detail });
    const paid: boolean = await policy.paid(c.invoiceHash);
    const released = (c.executor === 'RELEASED' || c.executor === 'ALREADY_RELEASED') && !!c.txHash;

    if (released) {
      const r = await provider.getTransactionReceipt(c.txHash!);
      add('tx_success', !!r && r.status === 1, r ? `mined in block ${r.blockNumber}` : 'transaction not found');
      const ev = r?.logs
        .filter((l) => l.address.toLowerCase() === dep.policy.toLowerCase())
        .map((l) => { try { return releasedIface.parseLog(l); } catch { return null; } })
        .find((p) => p?.name === 'Released');
      add('released_event', !!ev && ev.args.invoiceHash === c.invoiceHash, ev ? `Released ${formatUnits(ev.args.amount, 6)} USDC, humanSigned=${ev.args.humanSigned}` : 'no Released event from the policy contract');
      if (ev) add('amount', Number(formatUnits(ev.args.amount, 6)) === c.amountUsdc, `on-chain ${formatUnits(ev.args.amount, 6)} vs recorded ${c.amountUsdc}`);
      add('in_paid_set', paid, paid ? 'the contract\'s paid set contains this invoice' : 'not in the paid set');
      const bal = Number(formatUnits(await usdc.balanceOf(c.payee), 6));
      add('payee_funded', bal >= c.amountUsdc, `payee holds ${bal} USDC now`);
    } else {
      add('not_paid', !paid, paid ? 'UNEXPECTED: this invoice is in the paid set' : 'the invoice is not in the paid set: nothing was paid');
    }
    const ok = checks.every((x) => x.ok);
    out.push({
      case: c.case, ok, kind: released ? 'paid' : 'held', checks,
      summary: released ? (ok ? 'verified on-chain' : 'MISMATCH with the chain') : (ok ? 'held, nothing paid' : 'MISMATCH: was paid'),
    });
  }

  const reps = [];
  for (const r of receipts) {
    const res = await replayReceipt(r, { registry, approver: dep.approver });
    reps.push({ invoiceHash: r.invoiceHash, ok: res.ok, checks: res.checks });
  }

  return { ok: out.every((c) => c.ok) && reps.every((r) => r.ok), checkedAt: new Date().toISOString(), cases: out, receipts: reps };
}

export interface AgentState {
  agentId: number;
  role: number;
  signer: string;
  scoreNow: number;
  bondUsdc: number;
  active: boolean;
  eligible: boolean;
}

/** Live reputation and bond state straight from the registry. */
export async function readAgentState(provider: Provider, dep: Deployment, agentIds: number[]): Promise<{ agents: AgentState[]; minScore: number; minBondUsdc: number; auditor: string }> {
  const registry = new Contract(dep.registry, REGISTRY_READ_ABI, provider);
  const agents: AgentState[] = [];
  for (const id of agentIds) {
    const a = await registry.getAgent(id);
    agents.push({
      agentId: id, role: Number(a.role), signer: a.signer, scoreNow: Number(a.score), bondUsdc: Number(formatUnits(a.bond, 6)),
      active: a.active, eligible: await registry.isEligible(id, Number(a.role)),
    });
  }
  return { agents, minScore: Number(await registry.minScore()), minBondUsdc: Number(formatUnits(await registry.minBond(), 6)), auditor: await registry.auditor() };
}
