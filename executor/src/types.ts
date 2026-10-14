import { isAddress } from 'ethers';
import { z } from 'zod';

const bytes32 = z.string().regex(/^0x[0-9a-fA-F]{64}$/, 'expected a 32-byte hex string');
const address = z.string().refine((s) => isAddress(s), 'expected an address');
const uint = z.union([z.bigint(), z.string().regex(/^\d+$/), z.number().int().nonnegative()]).transform((v) => BigInt(v));
const sig = z.string().regex(/^0x[0-9a-fA-F]{130}$/, 'expected a 65-byte signature');

export const attestationSchema = z.object({
  invoiceHash: bytes32,
  payee: address,
  amount: uint,
  role: z.number().int().min(0).max(4),
  verdict: z.number().int().min(1).max(3),
  confidenceBps: z.number().int().min(0).max(10_000),
  evidenceHash: bytes32,
  agentId: z.number().int().positive(),
  expiry: z.number().int().positive(),
  nonce: uint,
});

/** Exactly what `CosignPolicy.release` takes. Strictly validated: this crosses a trust boundary on the HTTP path. */
export const packageSchema = z.object({
  req: z.object({ invoiceHash: bytes32, payee: address, amount: uint, category: bytes32 }),
  atts: z.array(attestationSchema).length(5),
  sigs: z.array(sig).length(5),
  // '0x' (none) or 8-byte expiry + 65-byte signature
  humanSig: z.string().regex(/^0x([0-9a-fA-F]{146})?$/).default('0x'),
});

export type PackageInput = z.infer<typeof packageSchema>;
export type AttestationInput = z.infer<typeof attestationSchema>;

export type ReleaseState = 'HELD' | 'SENDING' | 'PENDING' | 'CONFIRMED' | 'REVERTED';

/** The Executor's durable memory of one invoice. Written BEFORE any transaction is sent. */
export interface ReleaseRecord {
  invoiceHash: string;
  state: ReleaseState;
  attempts: number;
  nonce?: number;
  /** What the submitter can poll: a tx hash for a local key, a Circle transaction id for a Circle wallet. */
  ref?: string;
  txHash?: string;
  rule?: number;
  detail?: number;
  reason?: string;
  package?: unknown; // JSON form of the package, so a receipt can be rebuilt after a crash
  updatedAt: string;
}

export type ReleaseOutcome =
  | { status: 'RELEASED' | 'ALREADY_RELEASED'; invoiceHash: string; txHash: string; receipt: import('./receipt').Receipt | null }
  | { status: 'HELD'; invoiceHash: string; rule: number; detail: number; reason: string }
  | { status: 'PENDING'; invoiceHash: string; txHash: string };

/** bigint-safe JSON for storage and HTTP. */
export const toJson = (v: unknown): unknown => JSON.parse(JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? x.toString() : x)));
