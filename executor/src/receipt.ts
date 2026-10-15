import { AbiCoder, Contract, TypedDataEncoder, ZeroHash, keccak256, verifyTypedData, type TypedDataDomain } from 'ethers';
import { ATTESTATION_TYPES, HUMAN_APPROVAL_TYPES } from './abi';
import type { AttestationInput, PackageInput } from './types';

export interface AttestationJson {
  invoiceHash: string; payee: string; amount: string; role: number; verdict: number; confidenceBps: number;
  evidenceHash: string; agentId: number; expiry: number; nonce: string; destinationDomain: number;
}

/**
 * Everything needed to re-check a payment without trusting Cosign: the signed attestations, the policy
 * version, the transaction, and the receipt hash the contract emitted.
 */
export interface Receipt {
  version: 2;
  invoiceHash: string;
  payee: string;
  amount: string; // USDC micro-units
  category: string;
  /** CCTP domain the money was sent to. 26 = Arc itself; anything else was burned here and minted there. */
  destinationDomain: number;
  policyVersion: string;
  chainId: string;
  policyAddress: string;
  txHash: string;
  blockNumber: number;
  releasedAt: string; // ISO time of the block
  humanSigned: boolean;
  humanSig: string | null;
  onChainReceiptHash: string;
  attestations: { attestation: AttestationJson; signature: string }[];
}

export const attestationToJson = (a: AttestationInput): AttestationJson => ({ ...a, amount: a.amount.toString(), nonce: a.nonce.toString() });

const typed = (a: AttestationJson | AttestationInput) => ({ ...a, amount: BigInt(a.amount), nonce: BigInt(a.nonce) });

export function domainFor(chainId: bigint | string, policyAddress: string): TypedDataDomain {
  return { name: 'CosignPolicy', version: '2', chainId: BigInt(chainId), verifyingContract: policyAddress };
}

/** Mirrors the contract: receipt = keccak256(abi.encode(receipt, digest)) over attestations in order, starting at zero. */
export function foldReceiptHash(domain: TypedDataDomain, atts: (AttestationJson | AttestationInput)[]): string {
  let r: string = ZeroHash;
  for (const a of atts) {
    const digest = TypedDataEncoder.hash(domain, ATTESTATION_TYPES, typed(a));
    r = keccak256(AbiCoder.defaultAbiCoder().encode(['bytes32', 'bytes32'], [r, digest]));
  }
  return r;
}

export function buildReceipt(args: {
  pkg: PackageInput; chainId: bigint; policyAddress: string; policyVersion: string; txHash: string; blockNumber: number;
  blockTimestamp: number; onChainReceiptHash: string; humanSigned: boolean;
}): Receipt {
  const { pkg } = args;
  return {
    version: 2,
    invoiceHash: pkg.req.invoiceHash,
    payee: pkg.req.payee,
    amount: pkg.req.amount.toString(),
    category: pkg.req.category,
    destinationDomain: pkg.req.destinationDomain,
    policyVersion: args.policyVersion,
    chainId: args.chainId.toString(),
    policyAddress: args.policyAddress,
    txHash: args.txHash,
    blockNumber: args.blockNumber,
    releasedAt: new Date(args.blockTimestamp * 1000).toISOString(),
    humanSigned: args.humanSigned,
    humanSig: args.humanSigned ? pkg.humanSig : null,
    onChainReceiptHash: args.onChainReceiptHash,
    attestations: pkg.atts.map((a, i) => ({ attestation: attestationToJson(a), signature: pkg.sigs[i] })),
  };
}

export interface ReplayCheck { name: string; ok: boolean; detail: string }

/**
 * Re-verify a receipt from scratch. Needs no Cosign service: only the receipt, and (optionally) the registry
 * contract and the human approver's address for the two checks that depend on chain state.
 */
export async function replayReceipt(
  receipt: Receipt,
  opts: { registry?: Contract; approver?: string } = {},
): Promise<{ ok: boolean; checks: ReplayCheck[] }> {
  const checks: ReplayCheck[] = [];
  const add = (name: string, ok: boolean, detail: string) => checks.push({ name, ok, detail });
  const domain = domainFor(receipt.chainId, receipt.policyAddress);
  const atts = receipt.attestations;

  add('five_roles', atts.length === 5 && new Set(atts.map((x) => x.attestation.role)).size === 5, `${atts.length} attestations, roles ${atts.map((x) => x.attestation.role).join(',')}`);
  add('same_invoice_payee_amount',
    atts.every((x) => x.attestation.invoiceHash === receipt.invoiceHash && x.attestation.payee.toLowerCase() === receipt.payee.toLowerCase() && x.attestation.amount === receipt.amount && x.attestation.destinationDomain === receipt.destinationDomain),
    'every attestation binds the receipt\'s invoice, payee, amount and destination chain');
  add('all_pass', atts.every((x) => x.attestation.verdict === 1), 'every verdict is PASS');

  const releasedAt = Date.parse(receipt.releasedAt) / 1000;
  add('fresh_at_release', atts.every((x) => x.attestation.expiry > releasedAt), 'no attestation had expired when the payment was released');

  for (const x of atts) {
    let signer = '';
    try { signer = verifyTypedData(domain, ATTESTATION_TYPES, typed(x.attestation), x.signature); } catch { /* bad sig */ }
    if (!signer) { add(`signature_role_${x.attestation.role}`, false, 'signature does not verify'); continue; }
    if (opts.registry) {
      const expected: string = await opts.registry.signerOf(x.attestation.agentId);
      add(`signature_role_${x.attestation.role}`, expected.toLowerCase() === signer.toLowerCase(), `signed by ${signer}; registry says agent ${x.attestation.agentId} is ${expected}`);
    } else add(`signature_role_${x.attestation.role}`, true, `signed by ${signer} (registry not checked)`);
  }

  add('receipt_hash', foldReceiptHash(domain, atts.map((x) => x.attestation)) === receipt.onChainReceiptHash, 'recomputed hash equals the hash the contract emitted');

  if (receipt.humanSigned) {
    if (!receipt.humanSig || receipt.humanSig.length !== 2 + 146) add('human_signature', false, 'receipt claims a human signature but has none');
    else if (opts.approver) {
      const expiry = BigInt('0x' + receipt.humanSig.slice(2, 18));
      let who = '';
      try {
        who = verifyTypedData(domain, HUMAN_APPROVAL_TYPES,
          { invoiceHash: receipt.invoiceHash, payee: receipt.payee, amount: BigInt(receipt.amount), destinationDomain: receipt.destinationDomain, expiry }, '0x' + receipt.humanSig.slice(18));
      } catch { /* bad sig */ }
      add('human_signature', who.toLowerCase() === opts.approver.toLowerCase(), `approval signed by ${who || 'nobody valid'}`);
    } else add('human_signature', true, 'a human signature is present (approver address not checked)');
  }

  return { ok: checks.every((c) => c.ok), checks };
}
