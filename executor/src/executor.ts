import { Contract, Interface, type Provider, type TransactionReceipt } from 'ethers';
import { POLICY_ABI } from './abi';
import { explainRule } from './explain';
import { buildReceipt, domainFor, foldReceiptHash, type Receipt } from './receipt';
import type { Store } from './store';
import { EthersSubmitter, type Submitter, type SubmitResult } from './submitter';
import { packageSchema, toJson, type PackageInput, type ReleaseOutcome, type ReleaseRecord } from './types';

export interface ExecutorOptions {
  /** CosignPolicy, for read calls (`evaluate`, `paid`, events). Needs a provider; a signer only if you use the default submitter. */
  policy: Contract;
  store: Store;
  /** How the transaction is signed and sent. Default: the policy contract's own signer (a local key). */
  submitter?: Submitter;
  receiptTimeoutMs?: number; // default 60_000; on timeout the payment stays PENDING and is reconciled later
  pollIntervalMs?: number; // default: 1s, or a third of the timeout if that is shorter
  /** Refuse to send attestations that expire within this many seconds: they could go stale mid-flight. */
  minFreshnessSec?: number; // default 120
  /** Override the clock. Default: the latest block's timestamp, because the contract checks expiry against block time. */
  nowSec?: () => number | Promise<number>;
}

/** A confirmed transaction that did not release this invoice through this policy: it belongs to something else (an older deployment). */
class NoReleasedEvent extends Error {}

const iface = new Interface(POLICY_ABI);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * The Executor does exactly one thing: submit a package to the policy contract and record the result.
 *
 * It never reads an agent's opinion. It does not trust `decision` fields, notes or confidence. It asks the contract
 * (`evaluate`, a free view call) and only sends when the contract says it will release. If it did send something it
 * should not, the contract would revert, because the contract, not this service, is the gate.
 *
 * Idempotent: for one invoice hash it never sends two payments. It checks its own durable record, then the
 * contract's paid set, then re-evaluates, and it writes `SENDING` before it ever touches the network.
 */
export class Executor {
  private readonly policy: Contract;
  private readonly store: Store;
  private readonly submitter: Submitter;
  private readonly receiptTimeoutMs: number;
  private readonly pollIntervalMs: number;
  private readonly minFreshnessSec: number;
  private readonly nowSec?: () => number | Promise<number>;
  private readonly locks = new Map<string, Promise<unknown>>();

  constructor(opts: ExecutorOptions) {
    this.policy = opts.policy;
    this.store = opts.store;
    this.submitter = opts.submitter ?? new EthersSubmitter(opts.policy);
    this.receiptTimeoutMs = opts.receiptTimeoutMs ?? 60_000;
    this.pollIntervalMs = opts.pollIntervalMs ?? Math.max(50, Math.min(1_000, Math.floor(this.receiptTimeoutMs / 3)));
    this.minFreshnessSec = opts.minFreshnessSec ?? 120;
    this.nowSec = opts.nowSec;
  }

  private get provider(): Provider {
    const r = this.policy.runner as (Provider & { provider?: Provider }) | null;
    const p = r?.provider ?? (r as Provider | null);
    if (!p || typeof p.getBlock !== 'function') throw new Error('policy contract must be connected to a provider');
    return p;
  }

  private async now(): Promise<number> {
    if (this.nowSec) return this.nowSec();
    const block = await this.provider.getBlock('latest');
    return block ? block.timestamp : Math.floor(Date.now() / 1000);
  }

  /** Serialize work per invoice so two concurrent calls for the same hash cannot both send. */
  private locked<T>(hash: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.locks.get(hash) ?? Promise.resolve();
    const next = prev.catch(() => undefined).then(fn);
    this.locks.set(hash, next);
    next.finally(() => { if (this.locks.get(hash) === next) this.locks.delete(hash); }).catch(() => undefined);
    return next;
  }

  /** Validate the package (throws ZodError on bad input) and release it if, and only if, the contract allows. */
  async release(raw: unknown): Promise<ReleaseOutcome> {
    const pkg = packageSchema.parse(raw);
    const hash = pkg.req.invoiceHash.toLowerCase();
    return this.locked(hash, () => this.doRelease(hash, pkg));
  }

  /** Resolve a payment that was sent but not confirmed, e.g. after a crash or a confirmation timeout. */
  async reconcile(invoiceHash: string): Promise<ReleaseOutcome | null> {
    const hash = invoiceHash.toLowerCase();
    return this.locked(hash, async () => {
      const rec = await this.store.getRecord(hash);
      if (!rec || !rec.package) return null;
      return this.resolveInFlight(hash, rec, packageSchema.parse(rec.package));
    });
  }

  async status(invoiceHash: string): Promise<{ record: ReleaseRecord | null; receipt: Receipt | null }> {
    const h = invoiceHash.toLowerCase();
    return { record: await this.store.getRecord(h), receipt: await this.store.getReceipt(h) };
  }

  // ---- internals ----

  private async doRelease(hash: string, pkg: PackageInput): Promise<ReleaseOutcome> {
    let rec = await this.store.getRecord(hash);

    if (rec?.state === 'CONFIRMED') {
      // The contract's paid set is the truth, not our file. A CONFIRMED record that this policy does not know about came from
      // another deployment (for example the policy before an upgrade), so it proves nothing here: ignore it and start fresh.
      if (await this.policy.paid(hash)) {
        return { status: 'ALREADY_RELEASED', invoiceHash: hash, txHash: rec.txHash!, receipt: await this.store.getReceipt(hash) };
      }
      rec = null;
    }
    if (rec && (rec.state === 'PENDING' || rec.state === 'SENDING')) {
      const settled = await this.resolveInFlight(hash, rec, pkg);
      if (settled) return settled;
      rec = await this.store.getRecord(hash);
    }

    // The contract's paid set is the source of truth, whatever our own files say.
    if (await this.policy.paid(hash)) return this.fromChain(hash, pkg);

    const args = [pkg.req, pkg.atts, pkg.sigs, pkg.humanSig] as const;

    const soonest = pkg.atts.reduce((m, a, i) => (a.expiry < m.exp ? { exp: a.expiry, i } : m), { exp: Infinity, i: 0 });
    if (soonest.exp - (await this.now()) < this.minFreshnessSec) {
      return this.hold(hash, 8, soonest.i, rec, pkg);
    }

    const [rule, detail] = await this.policy.evaluate(...args);
    if (Number(rule) !== 0) return this.hold(hash, Number(rule), Number(detail), rec, pkg);

    const attempts = (rec?.attempts ?? 0) + 1;
    await this.store.putRecord({ invoiceHash: hash, state: 'SENDING', attempts, package: toJson(pkg), updatedAt: new Date().toISOString() });

    let sent: SubmitResult;
    try {
      // One key per attempt: a backend that de-duplicates by key (Circle) would otherwise hand back the earlier FAILED transaction
      // forever. A second attempt cannot double-pay, because the contract's paid set rejects a repeat.
      sent = await this.submitter.submit(pkg, attempts > 1 ? `${hash}:${attempts}` : hash);
    } catch (e) {
      const rf = this.decodeRuleFailed(e);
      if (rf) return this.hold(hash, rf.rule, rf.detail, rec, pkg);
      await this.store.putRecord({
        invoiceHash: hash, state: 'REVERTED', attempts,
        reason: e instanceof Error ? e.message.slice(0, 300) : String(e).slice(0, 300),
        package: toJson(pkg), updatedAt: new Date().toISOString(),
      });
      throw e;
    }

    await this.store.putRecord({ invoiceHash: hash, state: 'PENDING', attempts, ref: sent.ref, txHash: sent.txHash, package: toJson(pkg), updatedAt: new Date().toISOString() });

    const outcome = await this.settle(sent);
    if (outcome.status === 'pending') return { status: 'PENDING', invoiceHash: hash, txHash: sent.txHash ?? sent.ref };
    if (outcome.status === 'failed') {
      await this.store.putRecord({ invoiceHash: hash, state: 'REVERTED', attempts, ref: sent.ref, txHash: sent.txHash, reason: outcome.reason, package: toJson(pkg), updatedAt: new Date().toISOString() });
      throw new Error(`release ${sent.ref} failed: ${outcome.reason}`);
    }
    return this.finalize(hash, pkg, outcome.txHash);
  }

  /** Poll the submitter until the transaction settles or the timeout passes. The first check is immediate. */
  private async settle(sent: SubmitResult) {
    const deadline = Date.now() + this.receiptTimeoutMs;
    for (;;) {
      const s = await this.submitter.status(sent.ref, sent.txHash);
      if (s.status !== 'pending' || Date.now() >= deadline) return s;
      await sleep(this.pollIntervalMs);
    }
  }

  /** Decide what became of a payment that was already SENDING or PENDING. Returns null when a retry is safe. */
  private async resolveInFlight(hash: string, rec: ReleaseRecord, pkg: PackageInput): Promise<ReleaseOutcome | null> {
    const ref = rec.ref ?? rec.txHash;
    if (ref) {
      const s = await this.submitter.status(ref, rec.txHash);
      if (s.status === 'pending') return { status: 'PENDING', invoiceHash: hash, txHash: rec.txHash ?? ref }; // still in flight: do not send again
      if (s.status === 'confirmed') {
        try { return await this.finalize(hash, pkg, s.txHash); }
        catch (e) {
          if (!(e instanceof NoReleasedEvent)) throw e;
          await this.store.putRecord({ ...rec, state: 'REVERTED', reason: 'the recorded transaction did not release this invoice through this policy', updatedAt: new Date().toISOString() });
          return null; // safe to retry: the contract's paid set is checked next
        }
      }
      await this.store.putRecord({ ...rec, state: 'REVERTED', reason: s.reason, updatedAt: new Date().toISOString() });
      return null;
    }
    // SENDING with no reference: we crashed around the send. If it landed, the paid set shows it.
    if (await this.policy.paid(hash)) return this.fromChain(hash, pkg);
    await this.store.putRecord({ ...rec, state: 'REVERTED', reason: 'send did not complete', updatedAt: new Date().toISOString() });
    return null; // not paid on-chain: a retry cannot double-pay, because the contract would reject a second release
  }

  /** A confirmed transaction can take a moment to be visible on every RPC node, so retry briefly. */
  private async fetchReceipt(txHash: string): Promise<TransactionReceipt> {
    for (let i = 0; i < 15; i++) {
      const r = await this.provider.getTransactionReceipt(txHash);
      if (r) return r;
      await sleep(Math.min(1_000, this.pollIntervalMs));
    }
    throw new Error(`transaction ${txHash} is confirmed but its receipt is not visible yet; reconcile later`);
  }

  private async finalize(hash: string, pkg: PackageInput, txHash: string): Promise<ReleaseOutcome> {
    const r = await this.fetchReceipt(txHash);
    if (r.status !== 1) throw new Error(`transaction ${txHash} reverted`);
    const policyAddress = await this.policy.getAddress();
    const log = r.logs
      .filter((l) => l.address.toLowerCase() === policyAddress.toLowerCase())
      .map((l) => { try { return iface.parseLog(l); } catch { return null; } })
      .find((p) => p?.name === 'Released' && String(p.args.invoiceHash).toLowerCase() === hash);
    if (!log) throw new NoReleasedEvent(`transaction ${r.hash} succeeded but emitted no Released event`);

    const block = await this.provider.getBlock(r.blockNumber);
    const receipt = buildReceipt({
      pkg, chainId: (await this.provider.getNetwork()).chainId, policyAddress,
      policyVersion: await this.policy.POLICY_VERSION(), txHash: r.hash, blockNumber: r.blockNumber,
      blockTimestamp: block!.timestamp, onChainReceiptHash: log.args.receiptHash, humanSigned: log.args.humanSigned,
    });
    await this.store.putReceipt(hash, receipt);
    const prev = await this.store.getRecord(hash);
    await this.store.putRecord({ invoiceHash: hash, state: 'CONFIRMED', attempts: prev?.attempts ?? 1, ref: prev?.ref, txHash: r.hash, package: toJson(pkg), updatedAt: new Date().toISOString() });
    return { status: 'RELEASED', invoiceHash: hash, txHash: r.hash, receipt };
  }

  /** The invoice is already in the on-chain paid set. Report it; build a receipt only if the package provably matches. */
  private async fromChain(hash: string, pkg: PackageInput): Promise<ReleaseOutcome> {
    const events = await this.policy.queryFilter(this.policy.filters.Released(hash));
    const ev = events[0] as unknown as { transactionHash: string; blockNumber: number; args: { receiptHash: string; humanSigned: boolean } } | undefined;
    if (!ev) throw new Error('invoice is in the paid set but no Released event was found');

    const policyAddress = await this.policy.getAddress();
    const chainId = (await this.provider.getNetwork()).chainId;
    let receipt = await this.store.getReceipt(hash);
    if (!receipt && foldReceiptHash(domainFor(chainId, policyAddress), pkg.atts) === ev.args.receiptHash) {
      const block = await this.provider.getBlock(ev.blockNumber);
      receipt = buildReceipt({
        pkg, chainId, policyAddress, policyVersion: await this.policy.POLICY_VERSION(), txHash: ev.transactionHash,
        blockNumber: ev.blockNumber, blockTimestamp: block!.timestamp, onChainReceiptHash: ev.args.receiptHash, humanSigned: ev.args.humanSigned,
      });
      await this.store.putReceipt(hash, receipt);
    }
    await this.store.putRecord({ invoiceHash: hash, state: 'CONFIRMED', attempts: (await this.store.getRecord(hash))?.attempts ?? 0, txHash: ev.transactionHash, package: toJson(pkg), updatedAt: new Date().toISOString() });
    return { status: 'ALREADY_RELEASED', invoiceHash: hash, txHash: ev.transactionHash, receipt };
  }

  private async hold(hash: string, rule: number, detail: number, prev: ReleaseRecord | null, pkg: PackageInput): Promise<ReleaseOutcome> {
    const reason = explainRule(rule, detail);
    await this.store.putRecord({
      invoiceHash: hash, state: 'HELD', attempts: prev?.attempts ?? 0, rule, detail, reason,
      package: toJson(pkg), updatedAt: new Date().toISOString(),
    });
    return { status: 'HELD', invoiceHash: hash, rule, detail, reason };
  }

  private decodeRuleFailed(e: unknown): { rule: number; detail: number } | null {
    const data = (e as { data?: string })?.data ?? (e as { error?: { data?: string } })?.error?.data;
    if (typeof data !== 'string') return null;
    try {
      const parsed = iface.parseError(data);
      return parsed?.name === 'RuleFailed' ? { rule: Number(parsed.args[0]), detail: Number(parsed.args[1]) } : null;
    } catch {
      return null;
    }
  }
}
