import { createHash } from 'node:crypto';
import { id as keccakText } from 'ethers';
import type { ParsedInvoice } from './types';

export const sha256Hex = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');

/** Deterministic JSON: sorted keys, bigint as decimal string. Used before hashing anything. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_k, v) => {
    if (typeof v === 'bigint') return v.toString();
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      return Object.keys(v as object).sort().reduce<Record<string, unknown>>((o, k) => {
        o[k] = (v as Record<string, unknown>)[k];
        return o;
      }, {});
    }
    return v;
  });
}

export const keccak = (text: string): string => keccakText(text);

/** invoiceHash binds the canonical invoice fields AND the source file, per the PRD. */
export function invoiceHash(p: ParsedInvoice): string {
  const canonical = canonicalJson({
    vendorName: p.vendorName,
    invoiceNumber: p.invoiceNumber,
    issued: p.issued,
    due: p.due,
    currency: p.currency,
    payee: p.payee,
    totalMicro: p.totalMicro,
    lineItems: p.lineItems,
  });
  return keccak(`${canonical}|${p.sourceSha256}`);
}
