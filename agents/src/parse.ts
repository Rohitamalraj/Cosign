import { sha256Hex } from './hash';
import { parseMicro } from './money';
import type { LineItem, ParsedInvoice } from './types';

/**
 * Deterministic extraction of invoice text. The text is UNTRUSTED DATA: nothing in it is ever executed,
 * obeyed or used to change behaviour. Instruction-like phrases are only recorded as flags.
 */

const ADDR_RE = /0x[a-fA-F0-9]{40}\b/g;

// Strong patterns are only ever aimed at an AI. Weak patterns are ordinary business phrasing ("please send
// payment to ..."), so they are reported only when a strong pattern is also present.
const STRONG_INJECTION: [string, RegExp][] = [
  ['ignore prior rules or instructions', /\bignore\b[^.\n]{0,40}\b(rules|instructions|policy|policies|checks)\b/i],
  ['disregard rules', /\bdisregard\b[^.\n]{0,40}\b(rules|instructions|policy|checks)\b/i],
  ['addresses an AI agent', /\b(note|message|instruction)s?\s+(to|for)\s+(the\s+)?(ai|agent|assistant|model|llm)\b|\bsystem (note|prompt|message)\b/i],
];
const WEAK_INJECTION: [string, RegExp][] = [
  ['tells the agent to approve or pay', /\b(approve|authorize|release)\b[^.\n]{0,30}\b(this invoice|payment|immediately)\b/i],
  ['tells the agent to redirect payment', /\b(send|redirect|route)\b[^.\n]{0,30}\bpayment\b[^.\n]{0,60}\binstead\b/i],
];

function field(text: string, label: RegExp): string | null {
  const m = text.match(new RegExp(`^\\s*(?:${label.source})\\s*:\\s*(.+?)\\s*$`, 'im'));
  return m ? m[1] : null;
}

function isoDate(s: string | null): string | null {
  if (!s) return null;
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const d = new Date(`${s}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s ? null : s;
}

function parseLineItems(text: string): LineItem[] {
  const items: LineItem[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.includes('|')) continue;
    const cells = line.split('|').map((c) => c.trim());
    if (cells.length < 4) continue;
    const [description, qtyS, rateS, amountS] = cells;
    const qty = Number(qtyS);
    const rate = parseMicro(rateS);
    const amount = parseMicro(amountS);
    if (!description || !Number.isFinite(qty) || qty <= 0 || rate === null || amount === null) continue; // header or junk row
    items.push({ description, qty, rateMicro: rate, amountMicro: amount });
  }
  return items;
}

export function parseInvoice(text: string): ParsedInvoice {
  // Only the part before any forwarded message is "the invoice"; the rest is context from an email thread.
  const [invoicePart, ...forwarded] = text.split(/^-{2,}\s*Forwarded message\s*-{2,}\s*$/im);

  const numberMatch = invoicePart.match(/^\s*INVOICE\s+(?:No\.?|#)?\s*([A-Z0-9][A-Z0-9-]*)\s*$/im);
  const from = field(invoicePart, /From/i);
  const fromMatch = from?.match(/^(.*?)\s*<([^>\s]+@[^>\s]+)>\s*$/);
  const vendorName = (fromMatch ? fromMatch[1] : from)?.trim() || null;
  const senderEmail = fromMatch ? fromMatch[2].toLowerCase() : null;

  const wallet = field(invoicePart, /Pay to wallet|Payment address|Wallet/i);
  const payee = wallet && /^0x[a-fA-F0-9]{40}$/.test(wallet) ? wallet.toLowerCase() : null;

  const totalLine = field(invoicePart, /Total/i);
  const totalMatch = totalLine?.match(/^([\d,]+(?:\.\d+)?)\s*([A-Za-z]{3,5})?$/);
  const totalMicro = totalMatch ? parseMicro(totalMatch[1]) : null;
  const currency = (field(invoicePart, /Currency/i) ?? totalMatch?.[2] ?? null)?.toUpperCase() ?? null;

  const terms = field(invoicePart, /Terms/i);
  const disc = terms?.match(/(\d+(?:\.\d+)?)\s*%\s*(?:discount\s*)?(?:if paid\s*)?within\s*(\d+)\s*days/i);

  let changeRequest: ParsedInvoice['changeRequest'] = null;
  for (const block of forwarded) {
    const fromEmail = block.match(/^\s*From:\s*.*?([\w.+-]+@[\w.-]+)/im)?.[1]?.toLowerCase();
    const newWallet = block.match(/(0x[a-fA-F0-9]{40})/)?.[1]?.toLowerCase();
    if (fromEmail && newWallet && /\b(wallet|address|payment details)\b/i.test(block)) changeRequest = { fromEmail, newWallet };
  }

  const strong = STRONG_INJECTION.filter(([, re]) => re.test(text)).map(([name]) => name);
  const injectionFlags = strong.length ? [...strong, ...WEAK_INJECTION.filter(([, re]) => re.test(text)).map(([name]) => name)] : [];
  const bodyAddresses = [...new Set((text.match(ADDR_RE) ?? []).map((a) => a.toLowerCase()))];

  return {
    invoiceNumber: numberMatch ? numberMatch[1].toUpperCase() : null,
    vendorName,
    senderEmail,
    issued: isoDate(field(invoicePart, /Issued/i)),
    due: isoDate(field(invoicePart, /Due/i)),
    agreementRef: field(invoicePart, /PO\s*\/\s*Agreement|Agreement|PO/i),
    currency,
    payee,
    totalMicro,
    lineItems: parseLineItems(invoicePart),
    terms,
    discount: disc ? { percent: Number(disc[1]), withinDays: Number(disc[2]) } : null,
    bodyAddresses,
    changeRequest,
    injectionFlags,
    sourceSha256: sha256Hex(text),
  };
}

/** Recursively freeze so an agent cannot mutate what it was given (agents must not influence each other). */
export function deepFreeze<T>(o: T): T {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o as object)) deepFreeze(v);
  }
  return o;
}
