import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Contract, Interface, ZeroAddress, getAddress, zeroPadValue, type Provider, type Signer } from 'ethers';

/**
 * The second half of a cross-chain payment. `CosignPolicy.release` burns USDC on Arc through CCTP V2; this module
 * waits for Circle's attestation and submits it to the destination chain's MessageTransmitter, which mints the USDC
 * for the payee that all five agents signed. The relayer holds no funds and cannot redirect anything: the
 * recipient is fixed inside Circle's signed message, so the relayer only pays destination gas.
 */

export const ARC_DOMAIN = 26;
export const IRIS_SANDBOX = 'https://iris-api-sandbox.circle.com';

export interface CctpDestination {
  domain: number;
  name: string;
  chainId: number;
  rpcUrl: string;
  /** CCTP V2 MessageTransmitter on the destination (same CREATE2 address on every testnet). */
  messageTransmitter: string;
  explorer: string;
}

/** Circle's CCTP V2 testnet MessageTransmitter, identical on every supported EVM testnet. */
export const MESSAGE_TRANSMITTER_V2 = '0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275';

export const CCTP_DESTINATIONS: Record<number, CctpDestination> = {
  6: { domain: 6, name: 'Base Sepolia', chainId: 84532, rpcUrl: 'https://sepolia.base.org', messageTransmitter: MESSAGE_TRANSMITTER_V2, explorer: 'https://sepolia.basescan.org' },
};

const TRANSMITTER_ABI = [
  'function receiveMessage(bytes message, bytes attestation) returns (bool)',
  'function usedNonces(bytes32) view returns (uint256)',
];

export type SettlementState = 'BURNED' | 'ATTESTED' | 'MINT_SENT' | 'MINTED' | 'FAILED';

/** What the Executor knows about the cross-chain leg of one payment. Written after every step so a crash can resume. */
export interface Settlement {
  invoiceHash: string;
  destinationDomain: number;
  destinationChain: string;
  payee: string;
  amount: string; // USDC micro-units
  burnTx: string; // on Arc
  state: SettlementState;
  eventNonce?: string;
  message?: string;
  attestation?: string;
  mintTx?: string;
  mintBlock?: number;
  error?: string;
  updatedAt: string;
}

export interface SettlementStore {
  get(invoiceHash: string): Promise<Settlement | null>;
  put(s: Settlement): Promise<void>;
}

export class MemorySettlementStore implements SettlementStore {
  private m = new Map<string, Settlement>();
  async get(h: string) { return this.m.get(h.toLowerCase()) ?? null; }
  async put(s: Settlement) { this.m.set(s.invoiceHash.toLowerCase(), structuredClone(s)); }
}

const HASH_RE = /^0x[0-9a-f]{64}$/;
export class FileSettlementStore implements SettlementStore {
  constructor(private readonly dir: string) { mkdirSync(join(dir, 'settlements'), { recursive: true }); }
  private path(h: string) {
    const x = h.toLowerCase();
    if (!HASH_RE.test(x)) throw new Error('invalid invoice hash');
    return join(this.dir, 'settlements', `${x}.json`);
  }
  async get(h: string) { const p = this.path(h); return existsSync(p) ? (JSON.parse(readFileSync(p, 'utf8')) as Settlement) : null; }
  async put(s: Settlement) {
    const p = this.path(s.invoiceHash);
    const tmp = `${p}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(s, null, 2));
    renameSync(tmp, p);
  }
}

export interface IrisMessage { message: string; attestation: string; eventNonce: string; status: string }

type Fetch = (url: string) => Promise<{ ok: boolean; status: number; json(): Promise<unknown>; text(): Promise<string> }>;

/** One poll of Circle's attestation service. Returns null while it has not indexed the burn or signed it yet. */
export async function fetchAttestation(burnTx: string, opts: { iris?: string; fetch?: Fetch } = {}): Promise<IrisMessage | null> {
  const doFetch = opts.fetch ?? (fetch as unknown as Fetch);
  const res = await doFetch(`${opts.iris ?? IRIS_SANDBOX}/v2/messages/${ARC_DOMAIN}?transactionHash=${burnTx}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Iris returned ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const body = (await res.json()) as { messages?: IrisMessage[] };
  const m = body.messages?.[0];
  if (!m || m.status !== 'complete' || !m.attestation || m.attestation === 'PENDING') return null;
  return m;
}

export async function waitForAttestation(
  burnTx: string,
  opts: { iris?: string; fetch?: Fetch; timeoutMs?: number; intervalMs?: number; sleep?: (ms: number) => Promise<void>; now?: () => number } = {},
): Promise<IrisMessage> {
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = opts.now ?? Date.now;
  const deadline = now() + (opts.timeoutMs ?? 30 * 60_000);
  for (;;) {
    const m = await fetchAttestation(burnTx, opts);
    if (m) return m;
    if (now() >= deadline) throw new Error(`Circle has not attested burn ${burnTx} yet. Standard transfers wait for finality; try again later.`);
    await sleep(opts.intervalMs ?? 15_000);
  }
}

export interface Transmitter {
  usedNonces(nonce: string): Promise<bigint>;
  receiveMessage(message: string, attestation: string): Promise<{ hash: string; wait(): Promise<{ blockNumber: number } | null> }>;
}

export interface SettlerOptions {
  destinations?: Record<number, CctpDestination>;
  /** Signer on the destination chain, funded with that chain's gas token. Holds no USDC. */
  signerFor?: (dest: CctpDestination) => Signer;
  /** Test seam: supply the transmitter instead of building one from `signerFor`. */
  transmitterFor?: (dest: CctpDestination) => Transmitter;
  iris?: string;
  fetch?: Fetch;
  attestTimeoutMs?: number;
  intervalMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

/** Drives burn -> attestation -> mint, idempotently: safe to call again after a crash or a timeout. */
export class CctpSettler {
  constructor(private readonly store: SettlementStore, private readonly opts: SettlerOptions) {}

  private dest(domain: number): CctpDestination {
    const d = (this.opts.destinations ?? CCTP_DESTINATIONS)[domain];
    if (!d) throw new Error(`no CCTP destination configured for domain ${domain}`);
    return d;
  }

  async settle(args: { invoiceHash: string; burnTx: string; destinationDomain: number; payee: string; amount: bigint }): Promise<Settlement> {
    const dest = this.dest(args.destinationDomain);
    let s: Settlement = (await this.store.get(args.invoiceHash)) ?? {
      invoiceHash: args.invoiceHash, destinationDomain: dest.domain, destinationChain: dest.name, payee: getAddress(args.payee),
      amount: args.amount.toString(), burnTx: args.burnTx, state: 'BURNED', updatedAt: new Date().toISOString(),
    };
    if (s.burnTx.toLowerCase() !== args.burnTx.toLowerCase()) throw new Error('a settlement already exists for this invoice with a different burn transaction');
    const save = async (patch: Partial<Settlement>) => { s = { ...s, ...patch, updatedAt: new Date().toISOString() }; await this.store.put(s); };
    await save({});
    if (s.state === 'MINTED') return s;

    try {
      if (!s.attestation || !s.message) {
        const m = await waitForAttestation(args.burnTx, { iris: this.opts.iris, fetch: this.opts.fetch, timeoutMs: this.opts.attestTimeoutMs, intervalMs: this.opts.intervalMs, sleep: this.opts.sleep });
        await save({ state: 'ATTESTED', message: m.message, attestation: m.attestation, eventNonce: m.eventNonce, error: undefined });
      }
      const transmitter: Transmitter = this.opts.transmitterFor
        ? this.opts.transmitterFor(dest)
        : (new Contract(dest.messageTransmitter, TRANSMITTER_ABI, this.opts.signerFor!(dest)) as unknown as Transmitter);

      // Already minted (by us before a crash, or by anyone: the mint is permissionless)? Then do not send again.
      if (s.eventNonce && (await transmitter.usedNonces(s.eventNonce).catch(() => 0n)) !== 0n) {
        await save({ state: 'MINTED', error: undefined });
        return s;
      }
      const tx = await transmitter.receiveMessage(s.message!, s.attestation!);
      await save({ state: 'MINT_SENT', mintTx: tx.hash });
      const r = await tx.wait();
      await save({ state: 'MINTED', mintBlock: r?.blockNumber, error: undefined });
    } catch (e) {
      await save({ error: (e as Error).message.slice(0, 300) });
      throw e;
    }
    return s;
  }
}

// ---- Verification, from chain state alone ----

const ERC20_TRANSFER = new Interface(['event Transfer(address indexed from, address indexed to, uint256 value)']);

export interface SettlementCheck { name: string; ok: boolean; detail: string }

/**
 * Check a cross-chain payment without trusting Cosign: the burn on Arc went through the TokenMessenger for the right
 * amount, recipient and domain, and the mint transaction on the destination created exactly that USDC for the payee.
 */
export async function verifySettlement(args: {
  arc: Provider; dest: Provider; destination: CctpDestination; settlement: Settlement; tokenMessenger: string; usdc: string; destUsdc: string;
}): Promise<{ ok: boolean; checks: SettlementCheck[] }> {
  const { settlement: s } = args;
  const checks: SettlementCheck[] = [];
  const add = (name: string, ok: boolean, detail: string) => checks.push({ name, ok, detail });

  const burn = await args.arc.getTransactionReceipt(s.burnTx);
  add('burn_tx', !!burn && burn.status === 1, burn ? `burn mined on Arc in block ${burn.blockNumber}` : 'burn transaction not found on Arc');
  if (burn) {
    const iface = new Interface(['event DepositForBurn(address indexed burnToken, uint256 amount, address indexed depositor, bytes32 mintRecipient, uint32 destinationDomain, bytes32 destinationTokenMessenger, bytes32 destinationCaller, uint256 maxFee, uint32 indexed minFinalityThreshold, bytes hookData)']);
    const log = burn.logs.filter((l) => l.address.toLowerCase() === args.tokenMessenger.toLowerCase()).map((l) => { try { return iface.parseLog(l); } catch { return null; } }).find((p) => p?.name === 'DepositForBurn');
    add('burn_event', !!log, log ? 'TokenMessengerV2 emitted DepositForBurn' : 'no DepositForBurn event from the TokenMessenger');
    if (log) {
      add('burn_amount', log.args.amount.toString() === s.amount, `burned ${log.args.amount} of ${s.amount}`);
      add('burn_recipient', log.args.mintRecipient.toLowerCase() === zeroPadValue(s.payee, 32).toLowerCase(), 'mint recipient is the payee the agents signed');
      add('burn_domain', Number(log.args.destinationDomain) === s.destinationDomain, `destination domain ${log.args.destinationDomain}`);
      add('burn_token', getAddress(log.args.burnToken) === getAddress(args.usdc), 'the burned token is Arc USDC');
    }
  }

  if (s.mintTx) {
    const mint = await args.dest.getTransactionReceipt(s.mintTx);
    add('mint_tx', !!mint && mint.status === 1, mint ? `mint mined on ${args.destination.name} in block ${mint.blockNumber}` : 'mint transaction not found on the destination');
    if (mint) {
      const hit = mint.logs
        .filter((l) => l.address.toLowerCase() === args.destUsdc.toLowerCase())
        .map((l) => { try { return ERC20_TRANSFER.parseLog(l); } catch { return null; } })
        .find((p) => p && p.args.from === ZeroAddress && p.args.to.toLowerCase() === s.payee.toLowerCase());
      add('mint_to_payee', !!hit && hit.args.value.toString() === s.amount, hit ? `${hit.args.value} USDC minted to the payee on ${args.destination.name}` : 'no USDC mint to the payee in that transaction');
    }
  } else add('mint_tx', false, 'no mint transaction recorded yet (the payment is burned but not yet minted)');

  return { ok: checks.every((c) => c.ok), checks };
}
