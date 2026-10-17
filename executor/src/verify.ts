import { Contract, Interface, formatUnits, type Provider } from 'ethers';
import { POLICY_ABI, REGISTRY_READ_ABI } from './abi';
import { replayReceipt, type ReplayCheck, type Receipt } from './receipt';
import { verifySettlement, type CctpDestination, type Settlement } from './cctp';

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
  /** CCTP domain the payment was sent to. Absent or 26 means Arc itself. */
  destinationDomain?: number;
  /** The Executor's record of the cross-chain leg (burn -> mint). Re-checked against both chains. */
  settlement?: Partial<Settlement> | null;
}

/** What verifyRun needs to re-check the destination chain of a cross-chain payment. */
export interface CrossChainVerifier {
  dest: Provider;
  destination: CctpDestination;
  tokenMessenger: string;
  destUsdc: string;
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

export async function verifyRun(provider: Provider, dep: Deployment, cases: RecordedCase[], receipts: Receipt[], cross?: CrossChainVerifier): Promise<RunVerification> {
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
      const domain = c.destinationDomain ?? 26;
      if (domain === 26) {
        const bal = Number(formatUnits(await usdc.balanceOf(c.payee), 6));
        add('payee_funded', bal >= c.amountUsdc, `payee holds ${bal} USDC now`);
      } else {
        // Paid on another chain: the policy burned USDC on Arc through CCTP, and Circle mints it for the payee there.
        if (ev) add('destination_domain', Number(ev.args.destinationDomain) === domain, `released to CCTP domain ${ev.args.destinationDomain}`);
        const st = c.settlement as Settlement | null | undefined;
        if (st?.state === 'MINTED' && st.mintTx && cross) {
          const res = await verifySettlement({ arc: provider, dest: cross.dest, destination: cross.destination, settlement: st, tokenMessenger: cross.tokenMessenger, usdc: dep.usdc, destUsdc: cross.destUsdc });
          for (const k of res.checks) add(k.name, k.ok, k.detail);
        } else {
          // Not an error: the money is burned (it cannot be spent twice) and the mint is a separate, permissionless step.
          add('mint_pending', true, 'burned on Arc; the mint on the destination chain has not been recorded yet');
        }
      }
    } else {
      add('not_paid', !paid, paid ? 'UNEXPECTED: this invoice is in the paid set' : 'the invoice is not in the paid set: nothing was paid');
    }
    const ok = checks.every((x) => x.ok);
    out.push({
      case: c.case, ok, kind: released ? 'paid' : 'held', checks,
      summary: released ? (ok ? (checks.some((x) => x.name === 'mint_pending') ? 'burn verified on-chain; mint pending' : 'verified on-chain') : 'MISMATCH with the chain') : (ok ? 'held, nothing paid' : 'MISMATCH: was paid'),
    });
  }

  const reps = [];
  for (const r of receipts) {
    const res = await replayReceipt(r, { registry, approver: dep.approver, approverAt: async (b) => (await policy.humanApprover({ blockTag: b })) as string });
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
