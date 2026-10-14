import { verifyTypedData, type TypedDataDomain, type TypedDataField } from 'ethers';

/**
 * Anything that can sign EIP-712 typed data and has an address: a local ethers wallet, or a key held by Circle
 * Wallets (see executor/src/circle.ts). The agents never see the private key either way.
 */
export interface TypedDataSigner {
  readonly address: string;
  signTypedData(domain: TypedDataDomain, types: Record<string, TypedDataField[]>, value: Record<string, unknown>): Promise<string>;
}

/** Must stay identical to the typehash in contracts/CosignPolicy.sol. The e2e test in contracts/ proves it. */
export const ATTESTATION_TYPES = {
  Attestation: [
    { name: 'invoiceHash', type: 'bytes32' },
    { name: 'payee', type: 'address' },
    { name: 'amount', type: 'uint256' },
    { name: 'role', type: 'uint8' },
    { name: 'verdict', type: 'uint8' },
    { name: 'confidenceBps', type: 'uint16' },
    { name: 'evidenceHash', type: 'bytes32' },
    { name: 'agentId', type: 'uint256' },
    { name: 'expiry', type: 'uint64' },
    { name: 'nonce', type: 'uint256' },
  ],
};

export interface Attestation {
  invoiceHash: string;
  payee: string;
  amount: bigint; // USDC micro-units
  role: number;
  verdict: number;
  confidenceBps: number;
  evidenceHash: string;
  agentId: number;
  expiry: number; // unix seconds
  nonce: bigint;
}

export function domainFor(chainId: bigint | number, verifyingContract: string): TypedDataDomain {
  return { name: 'CosignPolicy', version: '1', chainId, verifyingContract };
}

export const signAttestation = (signer: TypedDataSigner, domain: TypedDataDomain, a: Attestation): Promise<string> =>
  signer.signTypedData(domain, ATTESTATION_TYPES, { ...a });

export const recoverAttestationSigner = (domain: TypedDataDomain, a: Attestation, sig: string): string =>
  verifyTypedData(domain, ATTESTATION_TYPES, a, sig);
