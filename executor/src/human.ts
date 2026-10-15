import { concat, toBeHex, type TypedDataDomain } from 'ethers';
import { HUMAN_APPROVAL_TYPES } from './abi';
import { domainFor } from './receipt';

/** What a human approver signs (in a wallet or the frontend) to release an over-limit payment. */
export function humanApprovalTypedData(args: {
  chainId: bigint | string; policyAddress: string; invoiceHash: string; payee: string; amount: bigint; destinationDomain: number; expiry: number;
}): { domain: TypedDataDomain; types: typeof HUMAN_APPROVAL_TYPES; value: Record<string, unknown> } {
  return {
    domain: domainFor(args.chainId, args.policyAddress),
    types: HUMAN_APPROVAL_TYPES,
    value: { invoiceHash: args.invoiceHash, payee: args.payee, amount: args.amount, destinationDomain: args.destinationDomain, expiry: args.expiry },
  };
}

/** The contract expects `uint64 expiry` followed by the 65-byte signature. */
export const packHumanSig = (expiry: number, signature: string): string => concat([toBeHex(expiry, 8), signature]);
