import 'server-only';
import { join } from 'node:path';
import { concat, toBeHex, verifyTypedData } from 'ethers';
import type { Invoice, RuleState } from '@/lib/data';
import { resolve } from 'node:path';
import {
  ARC_DOMAIN, DEMO_CASES, chainDomain, chainLabel, llmConfigFromEnv, readDemoInvoice, loadAgentKeys, processInvoice, ROLE_ORDER,
  type Ledger, type ProcessResult, type RoleName,
} from '../../../agents/src';
import { findVendorByDomain, findVendorByName, lineSignature } from '../../../agents/src/ledger';
import { PdfNoTextError, pdfToText } from '../../../agents/src/pdf';
import { looksLikeImage, looksLikePdf, ocrFile } from '../../../agents/src/ocr';
import { explainRule } from '../../../executor/src/explain';
import { HUMAN_APPROVAL_TYPES } from '../../../executor/src/abi';
import { domainFor, replayReceipt } from '../../../executor/src/receipt';
import { toJson } from '../../../executor/src/types';
import { OUTCOME_KINDS, OutcomeError, effectsFor, type Effect, type OutcomeKind, type Verdict } from './auditor';
import { autoPayEnabled, shouldAutoPay } from './autopay';
import { can, type Session } from './auth';
import { InboundError, composeInvoiceText, type InboundMessage } from './email';
import { openDb, type Db } from './db';
import { EXPLORER, getLive, type Live } from './live';
import {
  PgStore, addIntake, addOutcome, createVendor, listIntake, setIntakeStatus, getInvoice, getSetting, listInvoices, listOutcomes, listVendors, loadLedger, recordPayment, saveInvoice,
  setVendorOnchain, updateInvoiceStatus, updateOutcomeEffects, upsertAgreement, type InvoiceRow, type VendorRow,
} from './repo';

/**
 * Server-side engine. Everything here is real:
 *  - the five agents run on the invoice and sign through Circle-held keys;
 *  - the real contract is asked what it would do (`evaluate`, a free view call) and that answer is what the app shows;
 *  - Release sends the payment through the Executor and Circle; over-limit payments need a signature from the on-chain approver's wallet;
 *  - everything is stored in a database.
 * With no Circle credentials (local development only) the agents still run and sign with local keys, but nothing can be
 * released, and the UI says so. A production server without the live runtime refuses to run.
 */

export const CATEGORIES = ['design', 'infrastructure', 'marketing', 'production', 'software', 'legal', 'travel', 'general'] as const;
const AGENT_IDS: Record<RoleName, number> = { READER: 1, VERIFIER: 2, MATCHER: 3, SENTINEL: 4, TREASURER: 5 };
const ATTESTATION_TTL_SECONDS = 6 * 3600;

// The example invoices are the testnet-scale set (amounts / 1000, vendor wallets we control on Arc testnet).
process.env.COSIGN_AGENTS_DATA ??= resolve(process.cwd(), '..', 'agents', 'data-testnet');

const g = globalThis as unknown as { __cosignDb?: Promise<Db>; __settling?: Map<string, Promise<void>> };

export function getDb(): Promise<Db> {
  if (!g.__cosignDb) {
    if (process.env.NODE_ENV === 'production' && !process.env.DATABASE_URL && !process.env.COSIGN_ALLOW_EPHEMERAL_DB) {
      throw new Error('DATABASE_URL is required in production (set COSIGN_ALLOW_EPHEMERAL_DB=1 only for a throwaway demo)');
    }
    g.__cosignDb = openDb({ dir: process.env.COSIGN_DB_DIR ?? join(process.cwd(), '.data', 'pg') });
  }
  return g.__cosignDb;
}

const httpError = (status: number, message: string) => Object.assign(new Error(message), { status });
const num = (n: bigint) => Number(n) / 1_000_000;
const short = (s: string, a = 6, b = 4) => (s.length > a + b + 1 ? `${s.slice(0, a)}…${s.slice(-b)}` : s);
const fmtDate = (iso: string | null) => (iso ? new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }) : '—');

export interface Status {
  mode: 'live' | 'preview';
  network: string;
  chainId: number | null;
  policy: string | null;
  humanApprover: string | null;
  perTxLimitUsdc: number | null;
  policyUsdc: number | null;
  database: 'postgres' | 'pglite';
  models: { reader: boolean; matcher: boolean; sentinel: boolean };
  crossChainMint: boolean;
  /** Invoices the contract clears are paid automatically; only over-limit or held ones wait for a person. */
  autoPay: boolean;
  /** Gas (USDC) in the operating wallets. Below about 0.3 the Executor cannot send a payment. */
  gas: { executor: number; screener: number; auditor: number } | null;
  note: string | null;
}

export async function getStatus(): Promise<Status> {
  const db = await getDb();
  const live = await getLive(db);
  const llm = llmConfigFromEnv();
  const base = { database: db.kind === 'pg' ? ('postgres' as const) : ('pglite' as const), models: { reader: !!llm.reader, matcher: !!llm.matcher, sentinel: !!llm.sentinel }, autoPay: autoPayEnabled() };
  if (!live) return { ...base, mode: 'preview', network: 'none', chainId: null, policy: null, humanApprover: null, perTxLimitUsdc: null, policyUsdc: null, crossChainMint: false, gas: null, note: 'Preview: the agents run, but no chain connection is configured, so nothing can be signed by registered agents or released.' };
  const facts = await live.chainFacts(0n);
  const [ex, sc, au] = await Promise.all([live.gasOf('EXECUTOR'), live.gasOf('SCREENER'), live.gasOf('AUDITOR')]);
  const low = ex.usdc < 0.3 ? `The Executor wallet (${ex.address}) is low on gas (${ex.usdc.toFixed(2)} USDC): payments will fail until it is topped up.` : null;
  return {
    ...base, mode: 'live', network: 'Arc testnet (test USDC)', chainId: live.chainId, policy: live.deployment.policy, humanApprover: await live.humanApprover(),
    perTxLimitUsdc: num(facts.perTxLimitMicro), policyUsdc: num(facts.balanceMicro), crossChainMint: !!live.settler,
    gas: { executor: ex.usdc, screener: sc.usdc, auditor: au.usdc }, note: low,
  };
}

// ---- Running the agents ----

interface Runtime { db: Db; live: Live | null; ledger: Ledger }

async function runtime(): Promise<Runtime> {
  const db = await getDb();
  const live = await getLive(db);
  if (!live && process.env.NODE_ENV === 'production') throw httpError(503, 'The live runtime is not configured on this server.');
  const reserve = BigInt(await getSetting<string>(db, 'reserveMicro', '1000000'));
  const facts = live ? await live.chainFacts(reserve) : { balanceMicro: 0n, perTxLimitMicro: 5_000_000n, reserveMicro: reserve };
  return { db, live, ledger: await loadLedger(db, facts) };
}

const pipelineCfg = (live: Live | null) => ({
  chainId: live?.chainId ?? 31337,
  policyAddress: live?.deployment.policy ?? '0x0000000000000000000000000000000000000001',
  agentIds: live?.agentIds ?? AGENT_IDS,
  llm: llmConfigFromEnv(),
  ttlSeconds: ATTESTATION_TTL_SECONDS,
  now: () => (process.env.COSIGN_NOW ? new Date(process.env.COSIGN_NOW) : new Date()),
});

/** The contract's own answer for this package right now: the first failing rule, or (0, 0). Null when there is no chain. */
async function contractAnswer(live: Live | null, r: ProcessResult): Promise<{ rule: number; detail: number } | null> {
  if (!live || !r.package) return null;
  const p = r.package;
  const [rule, detail] = await live.policy.evaluate(p.req, p.atts, p.sigs, '0x');
  return { rule: Number(rule), detail: Number(detail) };
}

function toView(r: ProcessResult, text: string, ledger: Ledger, answer: { rule: number; detail: number } | null, actor: string | null): Invoice {
  const p = r.parsed;
  const vendor = findVendorByName(ledger, p.vendorName) ?? findVendorByDomain(ledger, p.senderEmail);
  const anyEscalate = ROLE_ORDER.some((role) => r.results[role]?.verdict === 'ESCALATE');
  const limit = num(ledger.perTxLimitMicro);

  let status: Invoice['status'];
  let headline: string;
  const overrides: Partial<Record<number, RuleState>> = {};
  if (!r.package) { status = 'held'; headline = r.reasons[0] ?? 'Held for review.'; overrides[1] = 'fail'; }
  else if (answer) {
    if (answer.rule === 0) { status = 'ready'; headline = 'All five agents signed PASS and the contract would release this payment now.'; }
    else if (answer.rule === 6 && answer.detail === 0 && r.decision === 'NEEDS_HUMAN') {
      status = 'escalated'; headline = `All five agents signed PASS, but ${num(p.totalMicro ?? 0n).toLocaleString('en-US')} USDC is above the ${limit.toLocaleString('en-US')} USDC limit. The approver must sign.`; overrides[6] = 'wait';
    } else {
      status = r.decision === 'HOLD' && anyEscalate ? 'escalated' : 'held';
      headline = r.decision === 'HOLD' ? (r.reasons[0] ?? explainRule(answer.rule, answer.detail)) : explainRule(answer.rule, answer.detail);
      overrides[answer.rule] = 'fail';
    }
  } else {
    // Preview: no chain to ask. Use the agents' own decision and say so.
    status = r.decision === 'READY' ? 'ready' : r.decision === 'NEEDS_HUMAN' ? 'escalated' : anyEscalate ? 'escalated' : 'held';
    headline = `${r.reasons[0] ?? 'All five agents signed PASS.'} (Preview: no chain connected.)`;
  }

  const checks: Invoice['checks'] = {};
  const llm: Invoice['llm'] = {};
  for (const role of ROLE_ORDER) {
    const res = r.results[role];
    if (!res) continue;
    checks[role] = res.checks;
    if (res.llm) llm[role] = { model: res.llm.model, used: res.llm.used, error: res.llm.error };
  }
  const domain = p.chain ? (chainDomain(p.chain) ?? ARC_DOMAIN) : ARC_DOMAIN;
  const uid = r.invoiceHash ?? `unparsed-${p.sourceSha256.slice(0, 16)}`;

  return {
    uid, id: p.invoiceNumber ?? 'UNPARSED', vendor: p.vendorName ?? 'Unknown vendor', amount: p.totalMicro === null ? 0 : num(p.totalMicro),
    category: vendor ? vendor.category[0].toUpperCase() + vendor.category.slice(1) : 'Uncategorized',
    received: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' }), due: fmtDate(p.due),
    limit,
    chain: chainLabel(domain), payee: p.payee ? short(p.payee) : '—', payeeFull: p.payee ?? undefined,
    hash: r.invoiceHash ? short(r.invoiceHash) : '—', hashFull: r.invoiceHash ?? undefined,
    caseId: DEMO_CASES.find((c) => readDemoInvoice(c.file) === text)?.id,
    status, decision: r.decision, headline, flags: p.injectionFlags, checks, llm,
    source: text.slice(0, 4_000), processedAt: new Date().toISOString(), createdBy: actor ?? undefined,
    attestations: ROLE_ORDER.filter((role) => r.results[role]).map((role) => {
      const res = r.results[role]!;
      const ev = r.evidence[role];
      return { role, verdict: res.verdict, confidence: res.confidence, agentId: AGENT_IDS[role], note: res.note, cid: ev ? short(ev.hash, 8, 4) : '—' };
    }),
    ruleOverrides: overrides,
    injectedText: p.injectionFlags.length ? text.split(/\r?\n/).filter((l) => /system note|ignore|agent/i.test(l)).join(' ').slice(0, 300) || undefined : undefined,
  };
}

/**
 * Run an invoice through the five agents. `actor` is the signed-in wallet (null for an anonymous check, which is never stored).
 * Re-submitting an unpaid invoice replaces its row; re-submitting one that was already paid is a NEW row, so the Sentinel's
 * duplicate catch is visible.
 */
export async function submitInvoice(text: string, actor: Session | null, opts: { persist?: boolean; meta?: Partial<Invoice>; autoPay?: boolean } = {}): Promise<Invoice> {
  const { db, live, ledger } = await runtime();
  const signers = live ? live.signers : loadAgentKeys();
  const r = await processInvoice(text, ledger, pipelineCfg(live), signers);
  const answer = await contractAnswer(live, r);
  const owner = actor?.address.toLowerCase() ?? null;
  let view = { ...toView(r, text, ledger, answer, owner), ...(opts.meta ?? {}) };

  if (opts.persist === false || !owner) return view;

  let uid = view.uid;
  const existing = await getInvoice(db, uid);
  if (existing && existing.status === 'released') {
    let n = 2;
    while (await getInvoice(db, `${uid}#${n}`)) n++;
    uid = `${uid}#${n}`;
  } else if (existing && existing.createdBy && existing.createdBy !== owner) {
    uid = `${uid}@${owner.slice(2, 8)}`;
  }
  view = { ...view, uid };

  const vendor = findVendorByName(ledger, r.parsed.vendorName) ?? findVendorByDomain(ledger, r.parsed.senderEmail);
  const p = r.parsed;
  const history = vendor && p.invoiceNumber && p.totalMicro !== null && p.payee && p.issued && r.invoiceHash
    ? { number: p.invoiceNumber, vendorId: vendor.id, totalMicro: p.totalMicro, issued: p.issued, payee: p.payee, lineSignature: lineSignature(p), hash: r.invoiceHash }
    : null;
  await saveInvoice(db, {
    uid, hash: r.invoiceHash, status: view.status, decision: r.decision, vendor: p.vendorName, amountMicro: p.totalMicro, payee: p.payee,
    destinationDomain: r.package?.req.destinationDomain ?? ARC_DOMAIN, createdBy: owner, view: view as unknown as Record<string, unknown>,
    package: r.package ? toJson(r.package) : null, sourceText: text, history,
  });

  // Automatic payment: only when the contract itself says "releasable now" (all five PASS, all eight rules, within the limit).
  if (shouldAutoPay({ enabled: autoPayEnabled(), allowed: opts.autoPay !== false, canRelease: can.releasePayments(actor), live: !!live, status: view.status, hasPackage: !!r.package })) {
    try {
      return await releaseInvoice(uid, actor, undefined, { auto: true });
    } catch (e) {
      // Nothing is lost: the invoice stays ready and the Pay button still works. Say what happened.
      const why = (e instanceof Error ? e.message : String(e)).slice(0, 220);
      await updateInvoiceStatus(db, uid, 'ready', { headline: `Automatic payment did not go through: ${why} Press Pay now to try again.` });
      return asInvoice((await getInvoice(db, uid))!);
    }
  }
  return view;
}

export async function submitPdf(bytes: Uint8Array, actor: Session | null): Promise<Invoice> {
  return submitInvoice(await pdfToText(bytes), actor);
}

// ---- Reading ----

const asInvoice = (row: InvoiceRow): Invoice => ({ ...(row.view as unknown as Invoice), uid: row.uid, status: row.status as Invoice['status'] });

/** Operators and admins see every invoice; anyone else sees only their own. Anonymous callers see nothing. */
export async function listVisibleInvoices(actor: Session | null): Promise<Invoice[]> {
  if (!actor) return [];
  const db = await getDb();
  void resumeSettlements(db);
  const rows = await listInvoices(db, 200);
  return rows.filter((r) => can.seeAllInvoices(actor) || r.createdBy === actor.address.toLowerCase()).map(asInvoice);
}

async function visibleRow(db: Db, uid: string, actor: Session | null): Promise<InvoiceRow> {
  const row = await getInvoice(db, uid);
  if (!row || !actor || !(can.seeAllInvoices(actor) || row.createdBy === actor.address.toLowerCase())) throw httpError(404, 'unknown invoice');
  return row;
}

// ---- Receipts: the stored receipt, re-verified from scratch right now ----

export async function receiptFor(uid: string, actor: Session | null) {
  const { db, live } = await runtime();
  const row = await visibleRow(db, uid, actor);
  if (!row.hash) throw httpError(404, 'no receipt for this invoice');
  const receipt = await new PgStore(db).getReceipt(row.hash);
  if (!receipt) throw httpError(404, 'this invoice has no receipt yet (it has not been paid)');
  const replay = live
    ? await replayReceipt(receipt, { registry: live.registry, approver: await live.humanApprover(), approverAt: async (b) => (await live.policy.humanApprover({ blockTag: b })) as string })
    : await replayReceipt(receipt);
  const settlement = await new (await import('./repo')).PgSettlementStore(db).get(row.hash);
  return { receipt, replay, settlement };
}

// ---- Release (real payments) ----

export interface ApprovalRequest { domain: Record<string, unknown>; types: typeof HUMAN_APPROVAL_TYPES; value: Record<string, unknown>; expiry: number; approver: string }

/** What the approver's wallet must sign (EIP-712) to release an over-limit payment. Anyone who may release can fetch it. */
export async function approvalRequest(uid: string, actor: Session | null): Promise<ApprovalRequest> {
  if (!can.releasePayments(actor)) throw httpError(403, 'only operators and admins can request an approval');
  const { db, live } = await runtime();
  if (!live) throw httpError(503, 'No chain is connected: approvals need the live runtime.');
  const row = await visibleRow(db, uid, actor);
  const pkg = row.package as { req: { invoiceHash: string; payee: string; amount: string; destinationDomain: number } } | null;
  if (!pkg) throw httpError(409, 'this invoice has nothing to approve');
  const expiry = Math.floor(Date.now() / 1000) + 3600;
  return {
    domain: { name: 'CosignPolicy', version: '2', chainId: live.chainId, verifyingContract: live.deployment.policy }, types: HUMAN_APPROVAL_TYPES,
    value: { invoiceHash: pkg.req.invoiceHash, payee: pkg.req.payee, amount: pkg.req.amount, destinationDomain: pkg.req.destinationDomain, expiry },
    expiry, approver: await live.humanApprover(),
  };
}

const packHumanSig = (expiry: number, signature: string) => concat([toBeHex(expiry, 8), signature]);

/**
 * Release an invoice. The Executor asks the contract first and only sends if the contract will release, so this cannot
 * pay anything the eight rules refuse. `approval` is the approver wallet's signature, needed only above the limit.
 */
export async function releaseInvoice(uid: string, actor: Session | null, approval?: { expiry: number; signature: string }, opts: { auto?: boolean } = {}): Promise<Invoice> {
  if (!can.releasePayments(actor)) throw httpError(403, 'only operators and admins can release payments');
  const { db, live, ledger } = await runtime();
  if (!live) throw httpError(503, 'No chain is connected, so this server cannot release payments.');
  const row = await visibleRow(db, uid, actor);
  if (row.status === 'released') return asInvoice(row);
  if (!row.package) throw httpError(409, 'the agents could not read enough of this invoice to build a payment');
  if (row.decision === 'HOLD') throw httpError(409, 'the agents held this invoice; resolve it first (fix the cause and run it again)');

  const pkg = row.package as { req: { invoiceHash: string; payee: string; amount: string; destinationDomain: number } };
  let humanSig = '0x';
  if (approval) {
    const typed = { invoiceHash: pkg.req.invoiceHash, payee: pkg.req.payee, amount: BigInt(pkg.req.amount), destinationDomain: pkg.req.destinationDomain, expiry: approval.expiry };
    let who = '';
    try { who = verifyTypedData(domainFor(BigInt(live.chainId), live.deployment.policy), HUMAN_APPROVAL_TYPES, typed, approval.signature); } catch { /* invalid */ }
    const approver = await live.humanApprover();
    if (!who || who.toLowerCase() !== approver.toLowerCase()) throw httpError(400, `that signature is not from the approver wallet (${approver})`);
    humanSig = packHumanSig(approval.expiry, approval.signature);
  }

  let out;
  try { out = await live.executor.release({ ...(row.package as object), humanSig }); }
  catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // Say what actually went wrong instead of a vague internal error. Nothing was paid: the contract is only ever called once the rules pass.
    if (/INSUFFICIENT_NATIVE_TOKEN|insufficient funds/i.test(msg)) {
      const g = await live.gasOf('EXECUTOR').catch(() => null);
      throw httpError(503, `The payment was not sent: the Executor wallet is out of gas${g ? ` (${g.usdc.toFixed(2)} USDC at ${g.address})` : ''}. Send it some test USDC and press the button again.`);
    }
    throw httpError(502, `The payment could not be sent: ${msg.slice(0, 200)}`);
  }
  if (out.status === 'HELD') {
    const reason = out.rule === 8 ? 'The agents\' signatures have expired. Run the invoice through the agents again.' : out.reason;
    await updateInvoiceStatus(db, uid, out.rule === 6 ? 'escalated' : 'held', { headline: reason });
    throw httpError(409, reason);
  }
  if (out.status === 'PENDING') {
    await updateInvoiceStatus(db, uid, 'ready', { headline: 'Payment sent; waiting for the chain to confirm. Refresh in a moment.' });
    throw httpError(202, 'Payment sent; waiting for the chain to confirm. Refresh in a moment.');
  }

  const txUrl = `${EXPLORER}/tx/${out.txHash}`;
  await updateInvoiceStatus(db, uid, 'released', {
    tx: out.txHash, txUrl, headline: `${opts.auto ? 'Paid automatically: all five agents signed PASS and the contract released' : 'Paid on-chain. The contract released'} ${num(BigInt(pkg.req.amount)).toLocaleString('en-US')} USDC${pkg.req.destinationDomain === ARC_DOMAIN ? '' : ` (burned on Arc for ${chainLabel(pkg.req.destinationDomain)})`}.`,
    humanSig: humanSig === '0x' ? undefined : 'approver wallet', ruleOverrides: {},
  });
  if (row.history) {
    await recordPayment(db, { ...row.history, status: 'paid' });
  }
  void ledger;
  if (pkg.req.destinationDomain !== ARC_DOMAIN) startSettlement(db, live, uid, out.txHash, pkg.req);
  return asInvoice((await getInvoice(db, uid))!);
}

// ---- Cross-chain settlement (burn on Arc -> mint on the destination) ----

function startSettlement(db: Db, live: Live, uid: string, burnTx: string, req: { invoiceHash: string; payee: string; amount: string; destinationDomain: number }): void {
  if (!live.settler) return;
  g.__settling ??= new Map();
  if (g.__settling.has(uid)) return;
  const p = live.settler.settle({ invoiceHash: req.invoiceHash, burnTx, destinationDomain: req.destinationDomain, payee: req.payee, amount: BigInt(req.amount) })
    .then(async (s) => {
      await updateInvoiceStatus(db, uid, 'released', { settlement: { state: s.state, chain: s.destinationChain, mintTx: s.mintTx ?? null, error: s.error ?? null } });
    })
    .catch(async (e) => {
      await updateInvoiceStatus(db, uid, 'released', { settlement: { state: 'PENDING', chain: chainLabel(req.destinationDomain), mintTx: null, error: String((e as Error).message).slice(0, 200) } }).catch(() => undefined);
    })
    .finally(() => { g.__settling!.delete(uid); });
  g.__settling.set(uid, p);
}

/** Pick up any released cross-chain payment whose mint is not done yet (after a restart, or a slow attestation). */
async function resumeSettlements(db: Db): Promise<void> {
  const live = await getLive(db);
  if (!live?.settler) return;
  const rows = await db.query<{ uid: string; package: { req: { invoiceHash: string; payee: string; amount: string; destinationDomain: number } }; view: { tx?: string; settlement?: { state?: string } } }>(
    "select uid, package, view from invoices where status = 'released' and destination_domain <> $1", [ARC_DOMAIN]);
  for (const r of rows) {
    if (r.view.settlement?.state === 'MINTED' || !r.view.tx) continue;
    startSettlement(db, live, r.uid, r.view.tx, r.package.req);
  }
}

// ---- Auditor ----

export async function reportOutcome(uid: string, kind: OutcomeKind, note: string, actor: Session | null) {
  if (!can.reportOutcomes(actor)) throw httpError(403, 'only operators and admins can report outcomes');
  if (!OUTCOME_KINDS.some((k) => k.kind === kind)) throw httpError(400, 'unknown outcome');
  const { db, live } = await runtime();
  if (!live) throw httpError(503, 'No chain is connected, so scores cannot be changed.');
  const row = await visibleRow(db, uid, actor);
  if ((await listOutcomes(db, uid)).length) throw httpError(409, 'an outcome was already reported for this invoice');

  const view = row.view as unknown as Invoice;
  const verdicts = Object.fromEntries(view.attestations.map((a) => [a.role, a.verdict])) as Record<RoleName, Verdict>;
  let effects: Effect[];
  try { effects = effectsFor(kind, { verdicts, paid: row.status === 'released', agentIds: live.agentIds }); }
  catch (e) { if (e instanceof OutcomeError) throw httpError(400, e.message); throw e; }

  const outcome = await addOutcome(db, { invoiceUid: uid, invoiceHash: row.hash, kind, note: note.slice(0, 500), reporter: actor!.address.toLowerCase(), effects: [] });
  type Done = Omit<Effect, 'slashMicro'> & { slashMicro: string; tx?: string; error?: string };
  const done: Done[] = [];
  for (const e of effects) {
    const base: Done = { ...e, slashMicro: e.slashMicro.toString() };
    try {
      const { txHash } = await live.call('AUDITOR', { contract: live.deployment.registry, signature: 'recordOutcome(uint256,int32,uint128)', params: [e.agentId, e.scoreDelta, e.slashMicro], key: `outcome:${live.deployment.registry}:${uid}:${outcome.createdAt}:${e.agentId}` });
      done.push({ ...base, tx: txHash });
    } catch (err) {
      done.push({ ...base, error: String((err as Error).message).slice(0, 160) });
    }
  }
  await updateOutcomeEffects(db, outcome.id, done);
  return { ...outcome, effects: done };
}

export { listOutcomes };

// ---- Vendors (the real ledger) ----

export interface VendorView extends Omit<VendorRow, 'onchain'> {
  onchain: Record<string, unknown>;
  /** What the contract says about this wallet right now. */
  chain: { arc: { eligibleAt: number; blocked: boolean } | null; remote: Record<string, { eligibleAt: number; blocked: boolean }> } | null;
}

export async function listVendorViews(): Promise<VendorView[]> {
  const db = await getDb();
  const live = await getLive(db);
  const vendors = await listVendors(db);
  return Promise.all(vendors.map(async (v): Promise<VendorView> => {
    if (!live) return { ...v, chain: null };
    try {
      const [eligibleAt, blocked] = await live.policy.payees(v.wallet);
      const remote: Record<string, { eligibleAt: number; blocked: boolean }> = {};
      for (const c of v.chains) {
        const d = chainDomain(c);
        if (d !== null && d !== ARC_DOMAIN) { const [e2, b2] = await live.policy.remotePayees(d, v.wallet); remote[c] = { eligibleAt: Number(e2), blocked: !!b2 }; }
      }
      return { ...v, chain: { arc: { eligibleAt: Number(eligibleAt), blocked: !!blocked }, remote } };
    } catch { return { ...v, chain: null }; }
  }));
}

export interface NewVendorInput {
  name: string; emailDomain: string; wallet: string; category: string; chains: string[];
  agreement?: { ref: string; description?: string; lines: { match: string; rateUsdc: string }[]; remainingUsdc?: string };
}

const microFrom = (s: string): bigint => {
  const m = /^(\d+)(?:\.(\d{1,6}))?$/.exec(s.trim());
  if (!m) throw httpError(400, `"${s}" is not an amount`);
  return BigInt(m[1]) * 1_000_000n + BigInt((m[2] ?? '').padEnd(6, '0'));
};

/** Add a vendor to the ledger and allowlist its wallet on-chain through the screener wallet (a cooling-off applies). */
export async function addVendor(input: NewVendorInput, actor: Session | null): Promise<VendorView> {
  if (!can.manageVendors(actor)) throw httpError(403, 'only admins can add vendors');
  const { db, live } = await runtime();
  if (!CATEGORIES.includes(input.category.toLowerCase() as (typeof CATEGORIES)[number])) throw httpError(400, `category must be one of: ${CATEGORIES.join(', ')}`);
  const chains = [...new Set(input.chains.map((c) => c.trim().toLowerCase()).filter(Boolean))];
  if (!chains.length) chains.push('arc');
  for (const c of chains) if (chainDomain(c) === null) throw httpError(400, `unsupported chain "${c}"`);
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(input.emailDomain.trim())) throw httpError(400, 'email domain looks wrong (for example acme.com)');
  if (input.name.trim().length < 2) throw httpError(400, 'name is required');

  const vendor = await createVendor(db, { name: input.name, emailDomain: input.emailDomain, wallet: input.wallet, category: input.category, chains, createdBy: actor!.address.toLowerCase() });
  if (input.agreement?.ref) {
    await upsertAgreement(db, {
      ref: input.agreement.ref.trim(), vendorId: vendor.id, description: input.agreement.description ?? '',
      lines: input.agreement.lines.filter((l) => l.match.trim()).map((l) => ({ match: l.match.trim(), rateMicro: microFrom(l.rateUsdc) })),
      remainingMicro: input.agreement.remainingUsdc ? microFrom(input.agreement.remainingUsdc) : null,
    });
  }
  if (live) await registerVendorOnchain(db, live, vendor.id);
  return (await listVendorViews()).find((v) => v.id === vendor.id)!;
}

export async function registerVendorOnchain(db: Db, live: Live, vendorId: string): Promise<void> {
  const vendor = (await listVendors(db)).find((v) => v.id === vendorId);
  if (!vendor) throw httpError(404, 'unknown vendor');
  const txs: Record<string, string> = {};
  try {
    const policy = live.deployment.policy;
    const [eligibleAt] = await live.policy.payees(vendor.wallet);
    if (Number(eligibleAt) === 0 && vendor.chains.includes('arc')) {
      txs.arc = (await live.call('SCREENER', { contract: policy, signature: 'registerPayee(address,bool)', params: [vendor.wallet, false], key: `payee:${policy}:arc:${vendor.wallet}` })).txHash;
    }
    for (const c of vendor.chains) {
      const d = chainDomain(c);
      if (d === null || d === ARC_DOMAIN) continue;
      const [e2] = await live.policy.remotePayees(d, vendor.wallet);
      if (Number(e2) === 0) txs[c] = (await live.call('SCREENER', { contract: policy, signature: 'registerRemotePayee(uint32,address,bool)', params: [d, vendor.wallet, false], key: `payee:${policy}:${d}:${vendor.wallet}` })).txHash;
    }
    await setVendorOnchain(db, vendor.id, { registered: true, registerTxs: txs, error: null, registeredAt: new Date().toISOString() });
  } catch (e) {
    await setVendorOnchain(db, vendor.id, { registered: false, registerTxs: txs, error: String((e as Error).message).slice(0, 200) });
    throw httpError(502, `The vendor was saved but its on-chain registration failed: ${(e as Error).message.slice(0, 160)}. Use "Retry registration".`);
  }
}

export async function retryVendorRegistration(vendorId: string, actor: Session | null): Promise<VendorView> {
  if (!can.manageVendors(actor)) throw httpError(403, 'only admins can change vendors');
  const { db, live } = await runtime();
  if (!live) throw httpError(503, 'No chain is connected.');
  await registerVendorOnchain(db, live, vendorId);
  return (await listVendorViews()).find((v) => v.id === vendorId)!;
}


/** Run the same invoice text through the agents again (for example after the signatures expired, or a vendor was added). */
export async function rerunInvoice(uid: string, actor: Session | null): Promise<Invoice> {
  const db = await getDb();
  const row = await visibleRow(db, uid, actor);
  if (row.status === 'released') throw httpError(409, 'this invoice was already paid');
  if (!row.sourceText) throw httpError(409, 'the original text is not stored for this invoice');
  return submitInvoice(row.sourceText, actor);
}

// ---- Aggregate numbers for the dashboard (counts and volumes only: no vendor names, no invoice contents) ----

export interface Stats {
  invoices: number;
  paid: number;
  paidUsdc: number;
  crossChainPaid: number;
  crossChainMinted: number;
  waitingOnHuman: number;
  heldOrEscalated: number;
  duplicatesCaught: number;
  vendors: number;
  outcomesReported: number;
  recentPayments: { tx: string; amountUsdc: number; chain: string; at: string }[];
  recentOutcomes: { kind: string; at: string; effects: { role: string; scoreDelta: number; slashMicro: string; tx?: string }[] }[];
}

export async function getStats(): Promise<Stats> {
  const db = await getDb();
  const one = async (sql: string, p: unknown[] = []) => Number((await db.query<{ n: string }>(sql, p))[0]?.n ?? 0);
  const paidRows = await db.query<{ view: { tx?: string; chain?: string; settlement?: { state?: string } }; amount_micro: string; updated_at: string; destination_domain: number }>(
    "select view, amount_micro, updated_at, destination_domain from invoices where status = 'released' order by updated_at desc");
  const outcomes = await listOutcomes(db);
  return {
    invoices: await one('select count(*)::int as n from invoices'),
    paid: paidRows.length,
    paidUsdc: paidRows.reduce((s, r) => s + Number(r.amount_micro) / 1e6, 0),
    crossChainPaid: paidRows.filter((r) => r.destination_domain !== ARC_DOMAIN).length,
    crossChainMinted: paidRows.filter((r) => r.destination_domain !== ARC_DOMAIN && r.view.settlement?.state === 'MINTED').length,
    waitingOnHuman: await one("select count(*)::int as n from invoices where status = 'escalated'"),
    heldOrEscalated: await one("select count(*)::int as n from invoices where status in ('held','escalated')"),
    duplicatesCaught: await one("select count(*)::int as n from invoices where view::text ilike '%duplicate of%' or view::text ilike '%Exact duplicate%'"),
    vendors: await one('select count(*)::int as n from vendors'),
    outcomesReported: outcomes.length,
    recentPayments: paidRows.slice(0, 6).filter((r) => r.view.tx).map((r) => ({ tx: r.view.tx!, amountUsdc: Number(r.amount_micro) / 1e6, chain: r.view.chain ?? 'Arc', at: new Date(r.updated_at).toISOString() })),
    recentOutcomes: outcomes.slice(0, 5).map((o) => ({ kind: o.kind, at: o.createdAt, effects: (o.effects as { role: string; scoreDelta: number; slashMicro: string; tx?: string }[]).map((e) => ({ role: e.role, scoreDelta: e.scoreDelta, slashMicro: e.slashMicro, tx: e.tx })) })),
  };
}

// ---- Email intake ----

/** The identity under which emailed invoices are stored: visible to operators and admins, never able to pay anything. */
const EMAIL_ACTOR: Session = { address: 'email-intake', role: 'operator', expiresAt: '' };

export type IngestResult =
  | { status: 'duplicate' }
  | { status: 'processed'; invoiceUid: string; decision: string | undefined }
  | { status: 'needs_review'; intakeId: number; reason: string }
  | { status: 'failed'; intakeId: number | null; error: string };

/**
 * Turn an inbound email into an invoice. Text PDFs and body text go straight through the agents. Anything that needed OCR
 * (an image, a scanned PDF) is NOT run automatically: it waits in the inbox for a person to check the text first.
 * Nothing here pays: an operator still has to open the invoice and press Pay.
 */
export async function ingestEmail(msg: InboundMessage): Promise<IngestResult> {
  const db = await getDb();
  const from = msg.fromEmail;
  const texts: string[] = [];
  let ocrUsed = false;
  try {
    for (const a of msg.attachments) {
      if (looksLikePdf(a.bytes)) {
        try { texts.push(await pdfToText(a.bytes)); }
        catch (e) { if (!(e instanceof PdfNoTextError)) throw e; texts.push(await ocrFile(a.bytes)); ocrUsed = true; }
      } else if (looksLikeImage(a.bytes)) { texts.push(await ocrFile(a.bytes)); ocrUsed = true; }
      // Other attachment types (spreadsheets, signatures, logos) are ignored: only invoices can be read.
    }
    if (!texts.length && msg.text.trim().length < 20) throw new InboundError('the email has no invoice text and no readable attachment');
    const text = composeInvoiceText(msg, texts);

    if (ocrUsed) {
      const item = await addIntake(db, { channel: 'email', messageId: msg.messageId, fromAddr: from, subject: msg.subject, text, ocr: true, status: 'new' });
      return item ? { status: 'needs_review', intakeId: item.id, reason: 'an attachment was read by OCR, so a person must check the text before the agents run' } : { status: 'duplicate' };
    }
    // Record first, so a provider retry of the same message cannot create a second invoice.
    const item = await addIntake(db, { channel: 'email', messageId: msg.messageId, fromAddr: from, subject: msg.subject, text, ocr: false, status: 'new' });
    if (!item) return { status: 'duplicate' };
    // Email never pays on its own, even with automatic payment on: a person must press Pay for anything that arrived by email.
    const inv = await submitInvoice(text, EMAIL_ACTOR, { autoPay: false, meta: { intake: { channel: 'email', from, subject: msg.subject } } });
    await setIntakeStatus(db, item.id, 'processed', inv.uid);
    return { status: 'processed', invoiceUid: inv.uid, decision: inv.decision };
  } catch (e) {
    const error = e instanceof Error ? e.message.slice(0, 200) : 'could not process the email';
    const item = await addIntake(db, { channel: 'email', messageId: msg.messageId ? `${msg.messageId}#failed` : null, fromAddr: from, subject: msg.subject, text: msg.text.slice(0, 20_000), ocr: false, status: 'failed', error }).catch(() => null);
    return { status: 'failed', intakeId: item?.id ?? null, error };
  }
}

export async function listIntakeItems(actor: Session | null) {
  if (!can.seeAllInvoices(actor)) throw httpError(403, 'only operators and admins can see the inbox');
  return listIntake(await getDb());
}

/** Dismiss an inbox item, or mark one processed after a person ran its (checked) text through the agents. */
export async function updateIntakeItem(id: number, action: 'dismiss' | 'processed', invoiceUid: string | null, actor: Session | null): Promise<void> {
  if (!can.seeAllInvoices(actor)) throw httpError(403, 'only operators and admins can change the inbox');
  const ok = await setIntakeStatus(await getDb(), id, action === 'dismiss' ? 'dismissed' : 'processed', invoiceUid);
  if (!ok) throw httpError(404, 'unknown inbox item');
}
