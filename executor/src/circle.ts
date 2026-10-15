import { createHash } from 'node:crypto';
import type { TypedDataDomain, TypedDataField } from 'ethers';
import type { CircleDeveloperControlledWalletsClient } from '@circle-fin/developer-controlled-wallets';
import type { Submitter, SubmitResult, TxStatus } from './submitter';
import type { PackageInput } from './types';

/**
 * Circle developer-controlled wallets (EOA, ARC-TESTNET) as the custody layer:
 *  - CircleSigner: one wallet per agent signs that agent's EIP-712 attestation. The private key never exists
 *    on our machines. CosignPolicy still checks the signature with ecrecover, so it verifies as before.
 *  - CircleSubmitter: the Executor wallet calls `release` through Circle's contract-execution API.
 */

type Client = CircleDeveloperControlledWalletsClient;

const EIP712_DOMAIN_FIELDS: Record<string, TypedDataField> = {
  name: { name: 'name', type: 'string' },
  version: { name: 'version', type: 'string' },
  chainId: { name: 'chainId', type: 'uint256' },
  verifyingContract: { name: 'verifyingContract', type: 'address' },
  salt: { name: 'salt', type: 'bytes32' },
};

/** JSON cannot carry bigint; Circle takes integers as decimal strings. */
const plain = (v: unknown): unknown => JSON.parse(JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? x.toString() : x)));

export class CircleSigner {
  constructor(
    private readonly client: Client,
    private readonly walletId: string,
    readonly address: string,
  ) {}

  async signTypedData(domain: TypedDataDomain, types: Record<string, TypedDataField[]>, value: Record<string, unknown>): Promise<string> {
    const primaryType = Object.keys(types)[0];
    const typedData = {
      types: { EIP712Domain: Object.keys(domain).map((k) => EIP712_DOMAIN_FIELDS[k]), ...types },
      primaryType,
      domain: plain(domain),
      message: plain(value),
    };
    const res = await this.client.signTypedData({ walletId: this.walletId, data: JSON.stringify(typedData), memo: `cosign ${primaryType}` });
    const signature = res.data?.signature;
    if (!signature) throw new Error('Circle returned no signature');
    return signature;
  }
}

const RELEASE_SIGNATURE =
  'release((bytes32,address,uint256,bytes32,uint32),(bytes32,address,uint256,uint8,uint8,uint16,bytes32,uint256,uint64,uint256,uint32)[],bytes[],bytes)';

/** Deterministic UUID for an invoice, so Circle itself will not create two transactions for one release. */
export function idempotencyUuid(key: string): string {
  const h = createHash('sha256').update(`cosign-release:${key}`).digest('hex');
  const variant = ((parseInt(h[16], 16) & 0x3) | 0x8).toString(16);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${variant}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

export class CircleSubmitter implements Submitter {
  constructor(
    private readonly client: Client,
    private readonly walletId: string,
    private readonly policyAddress: string,
    private readonly feeLevel: 'LOW' | 'MEDIUM' | 'HIGH' = 'MEDIUM',
  ) {}

  async submit(pkg: PackageInput, idempotencyKey: string): Promise<SubmitResult> {
    const att = (a: PackageInput['atts'][number]) => [a.invoiceHash, a.payee, a.amount.toString(), String(a.role), String(a.verdict), String(a.confidenceBps), a.evidenceHash, String(a.agentId), String(a.expiry), a.nonce.toString(), String(a.destinationDomain)];
    const res = await this.client.createContractExecutionTransaction({
      walletId: this.walletId,
      contractAddress: this.policyAddress,
      abiFunctionSignature: RELEASE_SIGNATURE,
      abiParameters: [
        [pkg.req.invoiceHash, pkg.req.payee, pkg.req.amount.toString(), pkg.req.category, String(pkg.req.destinationDomain)],
        pkg.atts.map(att),
        pkg.sigs,
        pkg.humanSig,
      ] as unknown as never,
      fee: { type: 'level', config: { feeLevel: this.feeLevel } },
      refId: idempotencyKey,
      idempotencyKey: idempotencyUuid(`${this.policyAddress.toLowerCase()}:${idempotencyKey}`), // per policy: a new deployment must not collapse into an old transaction
    } as never);
    const id = (res.data as { id?: string } | undefined)?.id;
    if (!id) throw new Error('Circle returned no transaction id');
    return { ref: id };
  }

  async status(ref: string): Promise<TxStatus> {
    const res = await this.client.getTransaction({ id: ref });
    const tx = res.data?.transaction as { state?: string; txHash?: string; errorReason?: string; errorDetails?: string } | undefined;
    if (!tx) return { status: 'pending' };
    if ((tx.state === 'CONFIRMED' || tx.state === 'COMPLETE') && tx.txHash) return { status: 'confirmed', txHash: tx.txHash };
    if (tx.state === 'FAILED' || tx.state === 'DENIED' || tx.state === 'CANCELLED') {
      return { status: 'failed', reason: `${tx.state}${tx.errorReason ? `: ${tx.errorReason}` : ''}${tx.errorDetails ? ` (${tx.errorDetails})` : ''}` };
    }
    return { status: 'pending' };
  }
}

/**
 * Call any contract function through a Circle wallet and wait for it to confirm. Used by the web app's operating
 * wallets (the payee screener and the Auditor), each of which can only do what the contract lets its role do.
 * `idempotencyKey` makes a retry return the same Circle transaction instead of sending a second one.
 */
export async function circleCall(
  client: Client,
  args: { walletId: string; contractAddress: string; signature: string; params: unknown[]; idempotencyKey: string; timeoutMs?: number; pollMs?: number },
): Promise<{ txHash: string }> {
  const res = await client.createContractExecutionTransaction({
    walletId: args.walletId,
    contractAddress: args.contractAddress,
    abiFunctionSignature: args.signature,
    abiParameters: plain(args.params) as unknown as never,
    fee: { type: 'level', config: { feeLevel: 'MEDIUM' } },
    refId: args.idempotencyKey.slice(0, 80),
    idempotencyKey: idempotencyUuid(args.idempotencyKey),
  } as never);
  const id = (res.data as { id?: string } | undefined)?.id;
  if (!id) throw new Error('Circle returned no transaction id');
  const deadline = Date.now() + (args.timeoutMs ?? 120_000);
  for (;;) {
    const r = await client.getTransaction({ id });
    const tx = r.data?.transaction as { state?: string; txHash?: string; errorReason?: string } | undefined;
    if ((tx?.state === 'CONFIRMED' || tx?.state === 'COMPLETE') && tx.txHash) return { txHash: tx.txHash };
    if (tx && (tx.state === 'FAILED' || tx.state === 'DENIED' || tx.state === 'CANCELLED')) throw new Error(`transaction ${tx.state}${tx.errorReason ? `: ${tx.errorReason}` : ''}`);
    if (Date.now() >= deadline) throw new Error(`transaction ${id} not confirmed within ${Math.round((args.timeoutMs ?? 120_000) / 1000)}s`);
    await new Promise((r2) => setTimeout(r2, args.pollMs ?? 2_000));
  }
}
