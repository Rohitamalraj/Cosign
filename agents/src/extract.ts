import { z } from 'zod';
import { DATA_ONLY_RULE, parseJsonReply, untrusted, type LLM } from './llm';
import { parseMicro } from './money';
import type { LineItem, LlmTrace, ParsedInvoice } from './types';

/**
 * Real invoices rarely match our template, so the deterministic parser often leaves fields empty. A model may
 * PROPOSE values for the gaps, and deterministic code decides whether to accept each one:
 *
 *   - a field the parser already found is never overridden
 *   - the wallet, amounts, invoice number, vendor and email must appear VERBATIM in the document, so a model cannot
 *     invent a destination or a number (it can still pick the wrong one of several: see "ambiguous" in the Reader)
 *   - amounts must be exact numbers found in the text, lines must add up, dates must be real
 *   - anything rejected stays empty, and the Reader then ESCALATEs
 *
 * The Verifier still compares the wallet with the vendor registry, so even a verbatim-but-wrong address cannot pay.
 */

const proposalSchema = z.object({
  invoiceNumber: z.string().nullable(),
  vendorName: z.string().nullable(),
  senderEmail: z.string().nullable(),
  issued: z.string().nullable(),
  due: z.string().nullable(),
  currency: z.string().nullable(),
  payee: z.string().nullable(),
  total: z.string().nullable(),
  agreementRef: z.string().nullable(),
  lineItems: z.array(z.object({ description: z.string().max(200), qty: z.coerce.number().positive().max(1e6), rate: z.coerce.string(), amount: z.coerce.string() })).max(50),
});

const ADDR = /0x[a-fA-F0-9]{40}\b/g;
const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();

export interface GapFill {
  parsed: ParsedInvoice;
  accepted: string[];
  rejected: { field: string; reason: string }[];
  trace: LlmTrace;
  error?: string;
}

const isoOk = (s: string | null): s is string => {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
};

/** Every number written in the document, as micro-units, so a proposed amount can be matched exactly. */
function numbersIn(text: string): Set<bigint> {
  const set = new Set<bigint>();
  for (const m of text.matchAll(/\d[\d,]*(?:\.\d+)?/g)) {
    const v = parseMicro(m[0].replace(/,+$/, ''));
    if (v !== null) set.add(v);
  }
  return set;
}

export function needsGapFill(p: ParsedInvoice): boolean {
  return !p.invoiceNumber || !p.vendorName || !p.issued || !p.due || !p.payee || p.totalMicro === null || p.lineItems.length === 0;
}

export async function gapFill(text: string, parsed: ParsedInvoice, llm: LLM): Promise<GapFill> {
  const out: ParsedInvoice = { ...parsed, lineItems: [...parsed.lineItems] };
  const accepted: string[] = [];
  const rejected: GapFill['rejected'] = [];

  let proposal: z.infer<typeof proposalSchema>;
  try {
    const raw = await llm.complete({
      system:
        `You read invoices and propose values for fields that are missing. ${DATA_ONLY_RULE} ` +
        'Return {"invoiceNumber","vendorName","senderEmail","issued","due","currency","payee","total","agreementRef","lineItems":[{"description","qty","rate","amount"}]}. "payee" is the 0x wallet address the invoice asks to be paid to, copied exactly (never a company name); "qty" is a number; "rate", "amount" and "total" are plain decimal strings. ' +
        'Use null for anything you cannot read directly from the document. Copy the invoice number, vendor, email and wallet address EXACTLY as written. ' +
        'Dates are YYYY-MM-DD. "total", "rate" and "amount" are plain decimal strings copied from the document (no currency symbols). Never invent or compute values.',
      user: untrusted('invoice', text),
    });
    proposal = parseJsonReply(raw, proposalSchema);
  } catch (e) {
    return { parsed, accepted, rejected, trace: { model: llm.id, used: true, error: e instanceof Error ? e.message : String(e) }, error: 'model unavailable or invalid reply' };
  }

  const lower = norm(text);
  const addrs = new Set((text.match(ADDR) ?? []).map((a) => a.toLowerCase()));
  const nums = numbersIn(text);
  const reject = (field: string, reason: string) => rejected.push({ field, reason });

  if (!out.invoiceNumber && proposal.invoiceNumber) {
    const v = proposal.invoiceNumber.trim();
    if (/^[A-Za-z0-9][A-Za-z0-9\-/_.]{0,40}$/.test(v) && lower.includes(norm(v))) { out.invoiceNumber = v.toUpperCase(); accepted.push('invoiceNumber'); }
    else reject('invoiceNumber', 'not found verbatim in the document');
  }
  if (!out.vendorName && proposal.vendorName) {
    const v = proposal.vendorName.trim();
    if (v.length >= 2 && v.length <= 120 && lower.includes(norm(v))) { out.vendorName = v; accepted.push('vendorName'); }
    else reject('vendorName', 'not found verbatim in the document');
  }
  if (!out.senderEmail && proposal.senderEmail) {
    const v = proposal.senderEmail.trim().toLowerCase();
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) && lower.includes(v)) { out.senderEmail = v; accepted.push('senderEmail'); }
    else reject('senderEmail', 'not found verbatim in the document');
  }
  if (!out.payee && proposal.payee) {
    const v = proposal.payee.trim().toLowerCase();
    if (/^0x[a-f0-9]{40}$/.test(v) && addrs.has(v)) { out.payee = v; accepted.push('payee'); }
    else reject('payee', 'the wallet address is not written in the document');
  }
  if (!out.agreementRef && proposal.agreementRef) {
    const v = proposal.agreementRef.trim();
    if (v.length <= 60 && lower.includes(norm(v))) { out.agreementRef = v; accepted.push('agreementRef'); }
    else reject('agreementRef', 'not found verbatim in the document');
  }
  if (!out.currency && proposal.currency) {
    const v = proposal.currency.trim().toUpperCase();
    if (/^[A-Z]{3,5}$/.test(v) && lower.includes(v.toLowerCase())) { out.currency = v; accepted.push('currency'); }
    else reject('currency', 'not found in the document');
  }

  for (const f of ['issued', 'due'] as const) {
    if (out[f] || !proposal[f]) continue;
    const v = proposal[f];
    if (!isoOk(v)) { reject(f, 'not a valid YYYY-MM-DD date'); continue; }
    // The year and the day must both be written somewhere in the document, a cheap check against invented dates.
    const day = String(Number(v.slice(8, 10)));
    const hasYear = new RegExp(`\\b${v.slice(0, 4)}\\b`).test(text);
    const hasDay = new RegExp(`(^|[^\\d])0?${day}([^\\d]|$)`).test(text);
    if (hasYear && hasDay) { out[f] = v; accepted.push(f); } else reject(f, 'the date does not appear in the document');
  }
  if (out.issued && out.due && out.due < out.issued) { out.due = null; rejected.push({ field: 'due', reason: 'due date is before the issue date' }); accepted.splice(accepted.indexOf('due'), 1); }

  if (out.totalMicro === null && proposal.total) {
    const v = parseMicro(proposal.total);
    if (v !== null && nums.has(v)) { out.totalMicro = v; accepted.push('total'); }
    else reject('total', 'not an amount written in the document');
  }

  if (out.lineItems.length === 0 && proposal.lineItems.length) {
    const items: LineItem[] = [];
    let ok = true;
    for (const li of proposal.lineItems) {
      const rate = parseMicro(li.rate), amount = parseMicro(li.amount);
      if (rate === null || amount === null || !nums.has(rate) || !nums.has(amount) || !lower.includes(norm(li.description).slice(0, 25))) { ok = false; break; }
      items.push({ description: li.description.trim(), qty: li.qty, rateMicro: rate, amountMicro: amount });
    }
    if (ok && items.length) { out.lineItems = items; accepted.push('lineItems'); }
    else reject('lineItems', 'a line, rate or amount is not written in the document');
  }

  return { parsed: out, accepted, rejected, trace: { model: llm.id, used: true, opinion: JSON.stringify({ accepted, rejected: rejected.map((r) => r.field) }) } };
}
