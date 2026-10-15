import { parseMicro } from './money';
import type { ParsedInvoice } from './types';

/** Local stand-in for the vendor registry, agreements and payment history. Replace with a database later. */

export interface Vendor {
  id: string;
  name: string;
  aliases: string[];
  emailDomain: string;
  wallet: string; // lowercase 0x address on file
  /** Chains the vendor is registered to be paid on (lowercase names, see chains.ts). Absent means Arc only. */
  chains?: string[];
  walletSinceDays: number;
  category: string;
  paidCount: number;
}

export interface AgreementLine {
  match: string; // lowercase substring of the invoice line description
  rateMicro: bigint;
}

export interface Agreement {
  ref: string;
  vendorId: string;
  description: string;
  lines: AgreementLine[];
  expectedTotalMicro: bigint | null;
  remainingMicro: bigint | null;
}

export interface HistoryInvoice {
  number: string;
  vendorId: string;
  totalMicro: bigint;
  issued: string;
  payee: string;
  lineSignature: string;
  hash: string | null;
  status: 'paid' | 'held' | 'open';
}

export interface Ledger {
  vendors: Vendor[];
  agreements: Agreement[];
  history: HistoryInvoice[];
  treasury: { balanceMicro: bigint; reserveMicro: bigint; committedMicro: bigint };
  sanctioned: string[];
  perTxLimitMicro: bigint;
}

const micro = (s: string): bigint => {
  const v = parseMicro(s);
  if (v === null) throw new Error(`Bad amount in ledger data: ${s}`);
  return v;
};

/** Convert the JSON fixture (decimal strings) into typed ledger data. */
export function ledgerFromJson(raw: any): Ledger {
  return {
    vendors: raw.vendors.map((v: any) => ({ ...v, aliases: v.aliases ?? [], wallet: v.wallet.toLowerCase(), chains: (v.chains ?? ['arc']).map((c: string) => String(c).toLowerCase()) })),
    agreements: raw.agreements.map((a: any) => ({
      ref: a.ref,
      vendorId: a.vendorId,
      description: a.description,
      lines: (a.lines ?? []).map((l: any) => ({ match: String(l.match).toLowerCase(), rateMicro: micro(l.rate) })),
      expectedTotalMicro: a.expectedTotal ? micro(a.expectedTotal) : null,
      remainingMicro: a.remaining ? micro(a.remaining) : null,
    })),
    history: raw.history.map((h: any) => ({
      number: h.number,
      vendorId: h.vendorId,
      totalMicro: micro(h.total),
      issued: h.issued,
      payee: h.payee.toLowerCase(),
      lineSignature: h.lineSignature,
      hash: h.hash ?? null,
      status: h.status,
    })),
    treasury: {
      balanceMicro: micro(raw.treasury.balance),
      reserveMicro: micro(raw.treasury.reserve),
      committedMicro: micro(raw.treasury.committed ?? '0'),
    },
    sanctioned: (raw.sanctioned ?? []).map((a: string) => a.toLowerCase()),
    perTxLimitMicro: micro(raw.perTxLimit),
  };
}

const STOP = new Set(['the', 'a', 'an', 'of', 'for', 'and', 'to', 'in']);

export const tokenize = (s: string): string[] =>
  s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((t) => t && !STOP.has(t));

/** Stable signature of an invoice's lines: tokens of each description plus quantity. */
export function lineSignature(p: Pick<ParsedInvoice, 'lineItems'>): string {
  return p.lineItems
    .map((l) => `${tokenize(l.description).sort().join(' ')}#${l.qty}`)
    .sort()
    .join('|');
}

export function jaccard(a: string[], b: string[]): number {
  const A = new Set(a), B = new Set(b);
  if (A.size === 0 && B.size === 0) return 1;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return inter / (A.size + B.size - inter);
}

const SUFFIX = /\b(co|company|ltd|limited|llc|llp|inc|corp|gmbh)\b/g;
export const normalizeName = (s: string): string => s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(SUFFIX, ' ').replace(/\s+/g, ' ').trim();

export function findVendorByName(ledger: Ledger, name: string | null): Vendor | null {
  if (!name) return null;
  const n = normalizeName(name);
  return ledger.vendors.find((v) => [v.name, ...v.aliases].some((x) => normalizeName(x) === n)) ?? null;
}

export function findVendorByDomain(ledger: Ledger, email: string | null): Vendor | null {
  const d = email?.split('@')[1]?.toLowerCase();
  return d ? ledger.vendors.find((v) => v.emailDomain.toLowerCase() === d) ?? null : null;
}

/** Record a payment so later invoices see it in history (used by the demo and the Auditor later). */
export function recordPaid(ledger: Ledger, p: ParsedInvoice, hash: string, vendorId: string): void {
  if (!p.invoiceNumber || p.totalMicro === null || !p.payee || !p.issued) return;
  ledger.history.push({
    number: p.invoiceNumber, vendorId, totalMicro: p.totalMicro, issued: p.issued, payee: p.payee,
    lineSignature: lineSignature(p), hash, status: 'paid',
  });
  ledger.treasury.committedMicro += p.totalMicro;
}
