import { Contract, Interface, type ContractTransactionResponse, type Provider, type Signer, type TransactionReceipt } from 'ethers';
import { POLICY_ABI } from './abi';
import { explainRule } from './explain';
import { buildReceipt, domainFor, foldReceiptHash, type Receipt } from './receipt';
import type { Store } from './store';
import { packageSchema, toJson, type PackageInput, type ReleaseOutcome, type ReleaseRecord } from './types';

export interface ExecutorOptions {
  /** CosignPolicy connected to the Executor's own signer. This key can ONLY call `release`. */
  policy: Contract;
  store: Store;
  confirmations?: number; // default 1
  receiptTimeoutMs?: number; // default 60_000; on timeout the payment stays PENDING and is reconciled later
  /** Refuse to send attestations that expire within this many seconds: they could go stale mid-flight. */
  minFreshnessSec?: number; // default 120
  /** Override the clock. Default: the latest block's timestamp, because the contract checks expiry against block time. */
  nowSec?: () => number | Promise<number>;
}

const iface = new Interface(POLICY_ABI);

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
  private readonly confirmations: number;
  private readonly receiptTimeoutMs: number;
  private readonly minFreshnessSec: number;
  private readonly nowSec?: () => number | Promise<number>;
  private readonly locks = new Map<string, Promise<unknown>>();

  constructor(opts: ExecutorOptions) {
    this.policy = opts.policy;
    this.store = opts.store;
    this.confirmations = opts.confirmations ?? 1;
    this.receiptTimeoutMs = opts.receiptTimeoutMs ?? 60_000;
    this.minFreshnessSec = opts.minFreshnessSec ?? 120;
    this.nowSec = opts.nowSec;
  }

  private async now(): Promise<number> {
    if (this.nowSec) return this.nowSec();
    const block = await this.provider.getBlock('latest');
    return block ? block.timestamp : Math.floor(Date.now() / 1000);
  }

  private get provider(): Provider {
    const p = (this.policy.runner as Signer | null)?.provider;
    if (!p) throw new Error('policy contract must be connected to a signer with a provider');
    return p;
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
      return { status: 'ALREADY_RELEASED', invoiceHash: hash, txHash: rec.txHash!, receipt: await this.store.getReceipt(hash) };
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

    const signer = this.policy.runner as Signer;
    const nonce = await signer.getNonce('pending');
    await this.store.putRecord({
      invoiceHash: hash, state: 'SENDING', attempts: (rec?.attempts ?? 0) + 1, nonce,
      package: toJson(pkg), updatedAt: new Date().toISOString(),
    });

    let tx: ContractTransactionResponse;
    try {
      tx = await this.policy.release(...args, { nonce });
    } catch (e) {
      const rf = this.decodeRuleFailed(e);
      if (rf) return this.hold(hash, rf.rule, rf.detail, rec, pkg);
      await this.store.putRecord({
        invoiceHash: hash, state: 'REVERTED', attempts: (rec?.attempts ?? 0) + 1, nonce,
        reason: e instanceof Error ? e.message.slice(0, 300) : String(e).slice(0, 300),
        package: toJson(pkg), updatedAt: new Date().toISOString(),
      });
      throw e;
    }

    await this.store.putRecord({
      invoiceHash: hash, state: 'PENDING', attempts: (rec?.attempts ?? 0) + 1, nonce, txHash: tx.hash,
      package: toJson(pkg), updatedAt: new Date().toISOString(),
    });

    const mined = await this.waitFor(tx);
    if (!mined) return { status: 'PENDING', invoiceHash: hash, txHash: tx.hash };
    if (mined.status !== 1) {
      await this.store.putRecord({ invoiceHash: hash, state: 'REVERTED', attempts: (rec?.attempts ?? 0) + 1, nonce, txHash: tx.hash, reason: 'transaction reverted', package: toJson(pkg), updatedAt: new Date().toISOString() });
      throw new Error(`release transaction ${tx.hash} reverted`);
    }
    return this.finalize(hash, pkg, mined);
  }

  /** Decide what became of a payment that was already SENDING or PENDING. Returns null when a retry is safe. */
  private async resolveInFlight(hash: string, rec: ReleaseRecord, pkg: PackageInput): Promise<ReleaseOutcome | null> {
    if (rec.txHash) {
      const r = await this.provider.getTransactionReceipt(rec.txHash);
      if (!r) return { status: 'PENDING', invoiceHash: hash, txHash: rec.txHash }; // still in the mempool: do not send again
      if (r.status === 1) return this.finalize(hash, pkg, r);
      await this.store.putRecord({ ...rec, state: 'REVERTED', reason: 'transaction reverted', updatedAt: new Date().toISOString() });
      return null;
    }
    // SENDING with no tx hash: we crashed around the send. If it landed, the paid set shows it.
    if (await this.policy.paid(hash)) return this.fromChain(hash, pkg);
    await this.store.putRecord({ ...rec, state: 'REVERTED', reason: 'send did not complete', updatedAt: new Date().toISOString() });
    return null; // not paid on-chain: a retry cannot double-pay, because the contract would reject a second release
  }

  private async finalize(hash: string, pkg: PackageInput, r: TransactionReceipt): Promise<ReleaseOutcome> {
    const policyAddress = await this.policy.getAddress();
    const log = r.logs
      .filter((l) => l.address.toLowerCase() === policyAddress.toLowerCase())
      .map((l) => { try { return iface.parseLog(l); } catch { return null; } })
      .find((p) => p?.name === 'Released');
    if (!log) throw new Error(`transaction ${r.hash} succeeded but emitted no Released event`);

    const block = await this.provider.getBlock(r.blockNumber);
    const receipt = buildReceipt({
      pkg, chainId: (await this.provider.getNetwork()).chainId, policyAddress,
      policyVersion: await this.policy.POLICY_VERSION(), txHash: r.hash, blockNumber: r.blockNumber,
      blockTimestamp: block!.timestamp, onChainReceiptHash: log.args.receiptHash, humanSigned: log.args.humanSigned,
    });
    await this.store.putReceipt(hash, receipt);
    const prev = await this.store.getRecord(hash);
    await this.store.putRecord({ invoiceHash: hash, state: 'CONFIRMED', attempts: prev?.attempts ?? 1, nonce: prev?.nonce, txHash: r.hash, package: toJson(pkg), updatedAt: new Date().toISOString() });
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

  private async waitFor(tx: ContractTransactionResponse): Promise<TransactionReceipt | null> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), this.receiptTimeoutMs); });
    try {
      return await Promise.race([tx.wait(this.confirmations), timeout]);
    } finally {
      clearTimeout(timer);
    }
  }
}
