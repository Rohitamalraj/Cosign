import { Contract, type ContractTransactionResponse, type Provider, type Signer } from 'ethers';
import type { PackageInput } from './types';

/**
 * How a release transaction reaches the chain. The Executor's safety logic (evaluate first, durable record,
 * paid-set check, receipts) is identical for every submitter; only the signing and sending differ:
 *   - EthersSubmitter: a local key (used by the tests)
 *   - CircleSubmitter: a Circle developer-controlled wallet, so no raw key exists on our side
 */
export interface SubmitResult {
  /** An id the submitter can poll later: a tx hash, or a Circle transaction id. Saved before anything else. */
  ref: string;
  txHash?: string;
}

export type TxStatus =
  | { status: 'pending' }
  | { status: 'confirmed'; txHash: string }
  | { status: 'failed'; reason: string };

export interface Submitter {
  /** Send `release`. `idempotencyKey` is stable per invoice, for submitters whose backend supports it. */
  submit(pkg: PackageInput, idempotencyKey: string): Promise<SubmitResult>;
  status(ref: string, txHash?: string): Promise<TxStatus>;
}

/** Arc silently drops transactions whose maxFeePerGas is under 20 gwei, so never go below this. */
export const ARC_MIN_MAX_FEE_PER_GAS = 21_000_000_000n;

export class EthersSubmitter implements Submitter {
  constructor(
    private readonly policy: Contract,
    private readonly minMaxFeePerGas: bigint = ARC_MIN_MAX_FEE_PER_GAS,
  ) {}

  private get signer(): Signer {
    const s = this.policy.runner as Signer | null;
    if (!s || typeof s.getNonce !== 'function') throw new Error('EthersSubmitter needs a policy contract connected to a signer');
    return s;
  }

  private get provider(): Provider {
    const p = this.signer.provider;
    if (!p) throw new Error('signer has no provider');
    return p;
  }

  async submit(pkg: PackageInput): Promise<SubmitResult> {
    const fee = await this.provider.getFeeData();
    const maxFeePerGas = (fee.maxFeePerGas ?? 0n) > this.minMaxFeePerGas ? fee.maxFeePerGas! : this.minMaxFeePerGas;
    const maxPriorityFeePerGas = fee.maxPriorityFeePerGas !== null && fee.maxPriorityFeePerGas < maxFeePerGas ? fee.maxPriorityFeePerGas : 0n;
    const tx = (await this.policy.release(pkg.req, pkg.atts, pkg.sigs, pkg.humanSig, {
      nonce: await this.signer.getNonce('pending'), maxFeePerGas, maxPriorityFeePerGas,
    })) as ContractTransactionResponse;
    return { ref: tx.hash, txHash: tx.hash };
  }

  async status(ref: string): Promise<TxStatus> {
    const r = await this.provider.getTransactionReceipt(ref);
    if (!r) return { status: 'pending' };
    return r.status === 1 ? { status: 'confirmed', txHash: ref } : { status: 'failed', reason: 'transaction reverted' };
  }
}
