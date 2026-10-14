import { z } from 'zod';
import { invoiceHash } from './hash';
import {
  findVendorByDomain, findVendorByName, jaccard, lineSignature, normalizeName, tokenize,
  type Agreement, type Ledger, type Vendor,
} from './ledger';
import { gapFill, needsGapFill } from './extract';
import { DATA_ONLY_RULE, parseJsonReply, untrusted, type LLM } from './llm';
import { diffBps, fmtMicro, parseMicro } from './money';
import { parseInvoice } from './parse';
import { worstOf, type AgentResult, type Check, type LlmTrace, type ParsedInvoice, type RoleName, type VerdictName } from './types';

export interface AgentContext {
  now: Date;
  ledger: Readonly<Ledger>;
}

// ---- shared helpers ----

const verdictFromChecks = (checks: Check[]): VerdictName =>
  checks.some((c) => c.status === 'fail') ? 'FAIL' : checks.some((c) => c.status === 'warn') ? 'ESCALATE' : 'PASS';

function noteFor(checks: Check[], passNote: string): string {
  const bad = checks.filter((c) => c.status === 'fail');
  const doubt = checks.filter((c) => c.status === 'warn');
  const pick = bad.length ? bad : doubt;
  return pick.length ? pick.map((c) => c.detail).join(' ') : passNote;
}

function finish(role: RoleName, checks: Check[], passNote: string, confidence: number, extra?: Record<string, unknown>, llm?: LlmTrace): AgentResult {
  const verdict = verdictFromChecks(checks);
  return { role, verdict, confidence: Number(Math.min(0.99, Math.max(0.5, confidence)).toFixed(2)), note: noteFor(checks, passNote), checks, extra, llm };
}

const check = (name: string, status: Check['status'], detail: string): Check => ({ name, status, detail });

/** Without a model, confidence is capped: only deterministic checks backed the verdict. */
const capNoLlm = (c: number, hasLlm: boolean) => (hasLlm ? c : Math.min(c, 0.85));

function levenshtein(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)] as number[]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return dp[a.length][b.length];
}

const similarity = (a: string, b: string) => 1 - levenshtein(a, b) / Math.max(a.length, b.length, 1);
const daysBetween = (a: string, b: string) => Math.abs(Date.parse(a) - Date.parse(b)) / 86_400_000;

type LlmOutcome<T> = { ok: true; value: T; trace: LlmTrace } | { ok: false; trace: LlmTrace };

/** Ask a model; any failure becomes a trace with `error`, which callers turn into ESCALATE (never PASS). */
async function ask<T>(llm: LLM, system: string, user: string, schema: z.ZodType<T>): Promise<LlmOutcome<T>> {
  try {
    const raw = await llm.complete({ system, user });
    const value = parseJsonReply(raw, schema);
    return { ok: true, value, trace: { model: llm.id, used: true, opinion: JSON.stringify(value) } };
  } catch (e) {
    return { ok: false, trace: { model: llm.id, used: true, error: e instanceof Error ? e.message : String(e) } };
  }
}

const llmUnavailable = (t: LlmTrace): Check =>
  check('llm', 'warn', `Model ${t.model} was unavailable or returned an invalid reply (${t.error}); holding for a human instead of passing.`);

// ---- Reader ----

const readerSchema = z.object({
  invoiceNumber: z.string().nullable(),
  payee: z.string().nullable(),
  total: z.string().nullable(),
  vendorName: z.string().nullable(),
});

export async function runReader(text: string, llm: LLM | null): Promise<{ parsed: ParsedInvoice; result: AgentResult }> {
  let p = parseInvoice(text);
  const checks: Check[] = [];
  let trace: LlmTrace | undefined;
  let modelFilled: string[] = [];

  // Real invoices rarely match the template. A model may propose values for the gaps, but only values that appear
  // verbatim in the document are accepted, and a field the parser already found is never overridden.
  if (llm && needsGapFill(p)) {
    const g = await gapFill(text, p, llm);
    trace = g.trace;
    if (g.error) checks.push(llmUnavailable(g.trace));
    else {
      p = g.parsed;
      modelFilled = g.accepted;
      if (g.accepted.length) checks.push(check('model_filled', 'info', `The parser could not read ${g.accepted.join(', ')}; ${llm.id} proposed them and each was verified against the document text.`));
      for (const r of g.rejected) checks.push(check('model_rejected', 'warn', `${llm.id} proposed ${r.field}, rejected: ${r.reason}.`));
      if (g.accepted.includes('payee') && p.bodyAddresses.length > 1) {
        checks.push(check('ambiguous_destination', 'warn', `The document contains ${p.bodyAddresses.length} wallet addresses and a model chose the payee. A human should confirm which is right.`));
      }
    }
  }

  const missing = [
    !p.invoiceNumber && 'invoice number', !p.vendorName && 'vendor', !p.issued && 'issue date', !p.due && 'due date',
    !p.payee && 'payee wallet', p.totalMicro === null && 'total', p.lineItems.length === 0 && 'line items',
  ].filter(Boolean) as string[];
  checks.push(missing.length
    ? check('required_fields', 'warn', `Could not extract: ${missing.join(', ')}.`)
    : check('required_fields', 'pass', 'All required fields extracted.'));

  if (p.issued && p.due) checks.push(p.due >= p.issued ? check('dates', 'pass', 'Due date is on or after issue date.') : check('dates', 'warn', 'Due date is before the issue date.'));
  if (p.currency) checks.push(['USD', 'USDC'].includes(p.currency) ? check('currency', 'pass', `Currency ${p.currency}.`) : check('currency', 'warn', `Currency ${p.currency} is not USD or USDC.`));
  else checks.push(check('currency', 'warn', 'No currency stated.'));

  if (p.totalMicro !== null && p.lineItems.length) {
    const sum = p.lineItems.reduce((s, l) => s + l.amountMicro, 0n);
    checks.push(sum === p.totalMicro ? check('totals', 'pass', 'Line items add up to the total.') : check('totals', 'warn', `Line items add to ${fmtMicro(sum)} but the total says ${fmtMicro(p.totalMicro)}.`));
    for (const l of p.lineItems) {
      const expected = BigInt(Math.round(Number(l.rateMicro) * l.qty));
      const off = expected > l.amountMicro ? expected - l.amountMicro : l.amountMicro - expected;
      if (off > 1n) checks.push(check('line_math', 'warn', `"${l.description}": ${l.qty} x ${fmtMicro(l.rateMicro)} does not equal ${fmtMicro(l.amountMicro)}.`));
    }
  }

  if (p.injectionFlags.length) checks.push(check('injection_text', 'info', `Document contains instruction-like text (${p.injectionFlags.join('; ')}). Treated as data and not followed.`));
  if (p.changeRequest) checks.push(check('change_request', 'info', `Document includes a wallet-change notice from ${p.changeRequest.fromEmail}.`));

  if (llm && !trace) {
    const out = await ask(llm,
      `You extract fields from invoices. ${DATA_ONLY_RULE} Return {"invoiceNumber","vendorName","payee","total"} using null for anything absent. "total" is a plain decimal string.`,
      untrusted('invoice', text), readerSchema);
    trace = out.trace;
    if (!out.ok) checks.push(llmUnavailable(out.trace));
    else {
      const v = out.value;
      const diffs: string[] = [];
      if (p.invoiceNumber && v.invoiceNumber && p.invoiceNumber.toLowerCase() !== v.invoiceNumber.toLowerCase()) diffs.push('invoice number');
      if (p.payee && v.payee && p.payee !== v.payee.toLowerCase()) diffs.push('payee');
      if (p.totalMicro !== null && v.total && parseMicro(v.total) !== p.totalMicro) diffs.push('total');
      checks.push(diffs.length
        ? check('llm_crosscheck', 'warn', `Parser and model ${llm.id} disagree on: ${diffs.join(', ')}.`)
        : check('llm_crosscheck', 'pass', `Model ${llm.id} agrees with the parser.`));
    }
  }

  const base = (p.injectionFlags.length ? 0.9 : 0.98) - (missing.length ? 0.2 : 0);
  const conf = modelFilled.length ? Math.min(base, 0.8) : base; // values a model proposed are less certain than parsed ones
  return { parsed: p, result: finish('READER', checks, 'Fields extracted and the source file hashed.', conf, modelFilled.length ? { modelFilled } : undefined, trace) };
}

// ---- Verifier ----

export function runVerifier(p: ParsedInvoice, ctx: AgentContext): AgentResult {
  const { ledger } = ctx;
  const checks: Check[] = [];
  const actions: { type: string; payee: string; reason: string }[] = [];

  let vendor: Vendor | null = findVendorByName(ledger, p.vendorName);
  const byDomain = findVendorByDomain(ledger, p.senderEmail);
  if (!vendor && byDomain) {
    vendor = byDomain;
    checks.push(check('vendor', 'warn', `Vendor name "${p.vendorName}" is not on file, but the sender domain belongs to ${byDomain.name}.`));
  } else if (!vendor) {
    checks.push(check('vendor', 'warn', `"${p.vendorName ?? 'unknown'}" is not a registered vendor. Onboarding verification is required before first payment.`));
    return finish('VERIFIER', checks, '', 0.9, { actions });
  } else checks.push(check('vendor', 'pass', `${vendor.name} is a registered vendor.`));

  if (p.senderEmail) {
    checks.push(p.senderEmail.endsWith(`@${vendor.emailDomain}`)
      ? check('sender_domain', 'pass', `Sender domain matches ${vendor.emailDomain}.`)
      : check('sender_domain', 'warn', `Sender ${p.senderEmail} does not match the registered domain ${vendor.emailDomain}.`));
  } else checks.push(check('sender_domain', 'warn', 'No sender email on the invoice.'));

  const payee = p.payee;
  if (!payee) {
    checks.push(check('payee', 'warn', 'No payee wallet could be extracted.'));
    return finish('VERIFIER', checks, '', 0.9, { actions });
  }

  if (ledger.sanctioned.includes(payee)) checks.push(check('screening', 'fail', `Payee ${payee} is on the sanctions or risk list.`));
  else checks.push(check('screening', 'pass', 'Payee wallet is not on the sanctions or risk list.'));

  if (payee === vendor.wallet) {
    checks.push(check('wallet', 'pass', `Payee matches the wallet on file, unchanged for ${vendor.walletSinceDays} days.`));
  } else {
    const verifiedChange =
      p.changeRequest && p.changeRequest.newWallet === payee && p.changeRequest.fromEmail.endsWith(`@${vendor.emailDomain}`);
    if (verifiedChange) {
      checks.push(check('wallet', 'warn', `Payee differs from the wallet on file (${vendor.wallet}). A change notice from ${p.changeRequest!.fromEmail} was found; opening a 48h cooling-off and an out-of-band challenge.`));
      actions.push({ type: 'open_cooling_off_and_challenge', payee, reason: 'vendor wallet change request' });
    } else {
      checks.push(check('wallet', 'fail', `Payee ${payee} differs from the registered wallet and no verified change request exists.`));
    }
  }

  const known = new Set([payee, vendor.wallet, p.changeRequest?.newWallet].filter(Boolean) as string[]);
  const extra = p.bodyAddresses.filter((a) => !known.has(a));
  if (extra.length) checks.push(check('body_destinations', 'fail', `The invoice body names another destination (${extra.join(', ')}) that is not the registered wallet.`));

  return finish('VERIFIER', checks, 'Vendor and destination wallet verified.', 0.96, { actions, vendorId: vendor.id });
}

// ---- Matcher ----

const matcherSchema = z.object({ assessment: z.enum(['consistent', 'minor_issue', 'inconsistent']), reason: z.string().max(400) });

export async function runMatcher(p: ParsedInvoice, ctx: AgentContext, llm: LLM | null): Promise<AgentResult> {
  const { ledger } = ctx;
  const checks: Check[] = [];
  const vendor = findVendorByName(ledger, p.vendorName) ?? findVendorByDomain(ledger, p.senderEmail);
  const agreement: Agreement | undefined = ledger.agreements.find((a) => a.ref.toLowerCase() === (p.agreementRef ?? '').toLowerCase());
  let variance = 0n;

  if (!agreement) {
    checks.push(check('agreement', 'warn', `No agreement or PO "${p.agreementRef ?? 'none cited'}" on file to match against.`));
  } else if (vendor && agreement.vendorId !== vendor.id) {
    checks.push(check('agreement', 'fail', `Agreement ${agreement.ref} belongs to a different vendor.`));
  } else if (p.totalMicro === null) {
    checks.push(check('agreement', 'warn', 'No total to compare.'));
  } else {
    checks.push(check('agreement', 'pass', `Matched to ${agreement.ref}: ${agreement.description}.`));
    let expected = 0n;
    let unmatched = 0;
    for (const l of p.lineItems) {
      const rule = agreement.lines.find((r) => l.description.toLowerCase().includes(r.match));
      if (rule) expected += BigInt(Math.round(Number(rule.rateMicro) * l.qty));
      else unmatched++;
    }
    if (unmatched || expected === 0n) {
      if (agreement.expectedTotalMicro !== null && unmatched === p.lineItems.length) expected = agreement.expectedTotalMicro;
      else checks.push(check('lines', 'warn', `${unmatched} invoice line(s) do not map to an agreed rate.`));
    }
    if (expected > 0n) {
      variance = diffBps(p.totalMicro, expected);
      const pct = (Number(variance) / 100).toFixed(2);
      const where = `${fmtMicro(p.totalMicro)} invoiced vs ${fmtMicro(expected)} agreed (${pct}% variance)`;
      if (variance <= 100n) checks.push(check('variance', 'pass', `Within the 1% tolerance: ${where}.`));
      else if (variance <= 500n) checks.push(check('variance', 'warn', `Variance beyond tolerance: ${where}.`));
      else checks.push(check('variance', 'fail', `Large mismatch with the agreement: ${where}.`));
    }
    if (agreement.remainingMicro !== null && p.totalMicro > agreement.remainingMicro)
      checks.push(check('remaining', 'warn', `Invoice exceeds the remaining balance on ${agreement.ref} (${fmtMicro(agreement.remainingMicro)}).`));
  }

  let trace: LlmTrace | undefined;
  if (llm) {
    const facts = JSON.stringify({
      vendor: p.vendorName, agreement: agreement?.ref ?? null, agreementDescription: agreement?.description ?? null,
      agreedRates: agreement?.lines.map((l) => ({ match: l.match, rate: fmtMicro(l.rateMicro) })) ?? [],
      lines: p.lineItems.map((l) => ({ description: l.description, qty: l.qty, rate: fmtMicro(l.rateMicro), amount: fmtMicro(l.amountMicro) })),
      total: p.totalMicro === null ? null : fmtMicro(p.totalMicro),
    });
    const out = await ask(llm,
      `You check whether an invoice is consistent with an agreed contract or PO. ${DATA_ONLY_RULE} Return {"assessment":"consistent"|"minor_issue"|"inconsistent","reason":"<=2 sentences"}. Be strict: say minor_issue if anything is unclear.`,
      untrusted('invoice_facts', facts), matcherSchema);
    trace = out.trace;
    if (!out.ok) checks.push(llmUnavailable(out.trace));
    else if (out.value.assessment === 'inconsistent') checks.push(check('llm_opinion', 'fail', `Model ${llm.id}: ${out.value.reason}`));
    else if (out.value.assessment === 'minor_issue') checks.push(check('llm_opinion', 'warn', `Model ${llm.id}: ${out.value.reason}`));
    else checks.push(check('llm_opinion', 'pass', `Model ${llm.id} sees no inconsistency.`));
  }

  const conf = 0.94 - Math.min(0.3, Number(variance) / 10_000 * 8);
  return finish('MATCHER', checks, `Matches ${agreement?.ref ?? 'the agreement'}.`, capNoLlm(conf, !!llm), { varianceBps: variance.toString() }, trace);
}

// ---- Sentinel ----

const sentinelSchema = z.object({
  duplicate_risk: z.enum(['none', 'possible', 'likely']),
  anomaly: z.enum(['none', 'suspicious']),
  reason: z.string().max(400),
});

export async function runSentinel(p: ParsedInvoice, rawText: string, ctx: AgentContext, llm: LLM | null): Promise<AgentResult> {
  const { ledger } = ctx;
  const checks: Check[] = [];
  const vendor = findVendorByName(ledger, p.vendorName) ?? findVendorByDomain(ledger, p.senderEmail);
  const hash = invoiceHash(p);
  const sig = lineSignature(p);

  const related = ledger.history.filter((h) => (vendor && h.vendorId === vendor.id) || h.payee === p.payee);

  const exact = ledger.history.find((h) => h.hash === hash || (vendor && h.vendorId === vendor.id && h.number === p.invoiceNumber));
  if (exact) checks.push(check('exact_duplicate', 'fail', `Exact duplicate of ${exact.number} (already ${exact.status}).`));

  if (!exact && p.totalMicro !== null && p.invoiceNumber && p.issued) {
    for (const h of related) {
      const numberClose = levenshtein(p.invoiceNumber, h.number) <= 2;
      const amountClose = diffBps(p.totalMicro, h.totalMicro) <= 200n;
      const sigSame = sig === h.lineSignature || jaccard(sig.split(/[\s|#]+/), h.lineSignature.split(/[\s|#]+/)) >= 0.9;
      const days = daysBetween(p.issued, h.issued);
      // Same lines within two weeks, or a near-identical number and amount within a week. A same-amount invoice a
      // month later (a recurring plan) is normal and is not flagged.
      if (amountClose && ((sigSame && days <= 14) || (numberClose && days <= 7))) {
        checks.push(check('near_duplicate', 'fail',
          `Near-duplicate of ${h.number}: same payee${sigSame ? ' and line items' : ''}, amount within ${(Number(diffBps(p.totalMicro, h.totalMicro)) / 100).toFixed(1)}%${numberClose ? ', invoice number differs by a character or two' : ''}.`));
        break;
      }
    }
  }
  if (!checks.some((c) => c.name.includes('duplicate'))) checks.push(check('duplicates', 'pass', 'No duplicate or near-duplicate in history.'));

  const amounts = related.map((h) => h.totalMicro).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  if (amounts.length >= 3 && p.totalMicro !== null) {
    const median = amounts[Math.floor(amounts.length / 2)];
    if (median > 0n && p.totalMicro > median * 3n) checks.push(check('amount_drift', 'warn', `Amount ${fmtMicro(p.totalMicro)} is more than 3x this vendor's median (${fmtMicro(median)}).`));
    else checks.push(check('amount_drift', 'pass', 'Amount is in line with this vendor\'s history.'));
  } else checks.push(check('amount_drift', 'info', 'Not enough history for an amount-drift check.'));

  if (!findVendorByName(ledger, p.vendorName) && p.vendorName) {
    const n = normalizeName(p.vendorName);
    const twin = ledger.vendors.find((v) => similarity(normalizeName(v.name), n) >= 0.85);
    if (twin) checks.push(check('look_alike', 'fail', `Vendor "${p.vendorName}" looks like registered vendor "${twin.name}" but is not the same name.`));
  }

  if (p.injectionFlags.length) checks.push(check('injection_text', 'fail', `Instruction-like text aimed at an AI agent was found in the invoice body (${p.injectionFlags.join('; ')}).`));

  let trace: LlmTrace | undefined;
  if (llm) {
    const hist = related.slice(-8).map((h) => ({ number: h.number, total: fmtMicro(h.totalMicro), issued: h.issued, lines: h.lineSignature, status: h.status }));
    const out = await ask(llm,
      `You are a fraud and duplicate analyst for accounts payable. ${DATA_ONLY_RULE} Return {"duplicate_risk":"none"|"possible"|"likely","anomaly":"none"|"suspicious","reason":"<=2 sentences"}. Prefer "possible" or "suspicious" when unsure.`,
      `${untrusted('invoice', rawText)}\n\nVendor history (trusted):\n${JSON.stringify(hist)}`, sentinelSchema);
    trace = out.trace;
    if (!out.ok) checks.push(llmUnavailable(out.trace));
    else {
      const v = out.value;
      if (v.duplicate_risk === 'likely') checks.push(check('llm_opinion', 'fail', `Model ${llm.id}: likely duplicate. ${v.reason}`));
      else if (v.duplicate_risk === 'possible' || v.anomaly === 'suspicious') checks.push(check('llm_opinion', 'warn', `Model ${llm.id}: ${v.reason}`));
      else checks.push(check('llm_opinion', 'pass', `Model ${llm.id} sees no duplicate or anomaly.`));
    }
  }

  const failed = checks.some((c) => c.status === 'fail');
  return finish('SENTINEL', checks, 'No duplicate, near-duplicate or anomaly found.', capNoLlm(failed ? 0.93 : 0.95, !!llm), { invoiceHash: hash }, trace);
}

// ---- Treasurer ----

export function runTreasurer(p: ParsedInvoice, ctx: AgentContext): AgentResult {
  const { treasury } = ctx.ledger;
  const checks: Check[] = [];
  if (p.totalMicro === null || !p.due) return finish('TREASURER', [check('inputs', 'warn', 'Missing total or due date; cannot plan a payment.')], '', 0.9);

  const liquid = treasury.balanceMicro - treasury.reserveMicro - treasury.committedMicro;
  const today = ctx.now.toISOString().slice(0, 10);
  const daysToDue = Math.round((Date.parse(p.due) - Date.parse(today)) / 86_400_000);

  let plan: { action: 'PAY_NOW' | 'TAKE_DISCOUNT' | 'PAY_ON_DUE'; payDate: string; rationale: string };
  if (liquid < p.totalMicro) {
    checks.push(check('liquidity', 'warn', `Liquid cash ${fmtMicro(liquid)} (after reserve and commitments) is below the invoice; a USYC redemption or a human decision is needed.`));
    plan = { action: 'PAY_ON_DUE', payDate: p.due, rationale: 'Insufficient liquid cash.' };
  } else {
    checks.push(check('liquidity', 'pass', `Liquid cash ${fmtMicro(liquid)} covers the invoice.`));
    const d = p.discount;
    const windowEnd = d && p.issued ? Date.parse(p.issued) + d.withinDays * 86_400_000 : null;
    if (d && windowEnd !== null && Date.parse(today) <= windowEnd) {
      const saving = (p.totalMicro * BigInt(Math.round(d.percent * 100))) / 10_000n;
      plan = { action: 'TAKE_DISCOUNT', payDate: today, rationale: `Pay by day ${d.withinDays} to save ${fmtMicro(saving)} (${d.percent}%).` };
    } else if (daysToDue <= 0) {
      plan = { action: 'PAY_NOW', payDate: today, rationale: 'Invoice is due or overdue.' };
    } else {
      plan = { action: 'PAY_ON_DUE', payDate: p.due, rationale: `Pay on the due date, ${daysToDue} days away; no discount available.` };
    }
  }
  checks.push(check('plan', 'info', `${plan.action} on ${plan.payDate}. ${plan.rationale}`));
  return finish('TREASURER', checks, `${plan.rationale}`, 0.91, { plan });
}
