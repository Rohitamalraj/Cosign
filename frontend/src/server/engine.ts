import 'server-only';
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Invoice, RuleState } from '@/lib/data';

/**
 * Server-side engine: runs the REAL agent pipeline from ../agents and holds the demo ledger.
 * Nothing here moves money. "Released" means recorded as paid in the demo ledger only, until the Executor is
 * pointed at a deployed contract.
 */

// Point the agents at their data folder before they are used (bundlers rewrite __dirname).
process.env.COSIGN_AGENTS_DATA ??= resolve(process.cwd(), '..', 'agents', 'data');

import {
  DEMO_CASES, loadAgentKeys, llmConfigFromEnv, loadDemoLedger, processInvoice, readDemoInvoice, recordPaid, ROLE_ORDER,
  type Ledger, type ProcessResult, type RoleName,
} from '../../../agents/src';
import { findVendorByDomain, findVendorByName } from '../../../agents/src/ledger';
import { pdfToText } from '../../../agents/src/pdf';

const num = (n: bigint) => Number(n) / 1_000_000;
const short = (s: string, a = 6, b = 4) => (s.length > a + b + 1 ? `${s.slice(0, a)}…${s.slice(-b)}` : s);
const fmtDate = (iso: string | null) => (iso ? new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }) : '—');

const AGENT_IDS: Record<RoleName, number> = { READER: 1, VERIFIER: 2, MATCHER: 3, SENTINEL: 4, TREASURER: 5 };
const STATE_FILE = process.env.COSIGN_STATE_FILE ?? join(process.cwd(), '.data', 'state.json');
const DEMO_NOW = process.env.COSIGN_DEMO_NOW; // pin the clock so the five demo cases are reproducible

interface HistoryJson { number: string; vendorId: string; total: string; issued: string; payee: string; lineSignature: string; hash: string | null; status: 'paid' | 'held' | 'open' }
interface Persisted { invoices: Invoice[]; paid: HistoryJson[]; committed: string }

export interface Engine {
  ledger: Ledger;
  invoices: Invoice[];
  /** Full agent output kept in memory only, for release packages later. */
  results: Map<string, ProcessResult>;
}

const g = globalThis as unknown as { __cosignEngine?: Promise<Engine> };

function persist(e: Engine): void {
  try {
    mkdirSync(join(STATE_FILE, '..'), { recursive: true });
    const paid: HistoryJson[] = e.ledger.history
      .filter((h) => h.status === 'paid' && h.hash && e.invoices.some((i) => i.hashFull === h.hash && i.simulated))
      .map((h) => ({ number: h.number, vendorId: h.vendorId, total: h.totalMicro.toString(), issued: h.issued, payee: h.payee, lineSignature: h.lineSignature, hash: h.hash, status: h.status }));
    const data: Persisted = { invoices: e.invoices, paid, committed: e.ledger.treasury.committedMicro.toString() };
    const tmp = `${STATE_FILE}.tmp`;
    writeFileSync(tmp, JSON.stringify(data));
    renameSync(tmp, STATE_FILE);
  } catch (err) {
    console.error('could not persist demo state:', err instanceof Error ? err.message : err);
  }
}

const cfg = () => ({
  chainId: Number(process.env.CHAIN_ID ?? 31337),
  policyAddress: process.env.POLICY_ADDRESS ?? '0x0000000000000000000000000000000000000001',
  agentIds: AGENT_IDS,
  llm: llmConfigFromEnv(),
  now: () => (DEMO_NOW ? new Date(DEMO_NOW) : new Date()),
});

/** Approximate what the contract would say. The deployed contract is the real gate; this is a preview. */
export function previewRules(r: ProcessResult, ledger: Ledger): Partial<Record<number, RuleState>> {
  const o: Partial<Record<number, RuleState>> = {};
  if (!r.package) { o[1] = 'fail'; return o; }
  if (ROLE_ORDER.some((role) => r.results[role]!.verdict !== 'PASS')) o[4] = 'fail';
  const known = ledger.vendors.some((v) => v.wallet === r.parsed.payee);
  if (!known || (r.parsed.payee && ledger.sanctioned.includes(r.parsed.payee))) o[5] = 'fail';
  if (r.parsed.totalMicro !== null && r.parsed.totalMicro > ledger.perTxLimitMicro) o[6] = 'wait';
  if (r.invoiceHash && ledger.history.some((h) => h.hash === r.invoiceHash && h.status === 'paid')) o[7] = 'fail';
  return o;
}

export function toInvoice(r: ProcessResult, text: string, ledger: Ledger, caseId?: Invoice['caseId']): Invoice {
  const p = r.parsed;
  const vendor = findVendorByName(ledger, p.vendorName) ?? findVendorByDomain(ledger, p.senderEmail);
  const uid = r.invoiceHash ?? `unparsed-${p.sourceSha256.slice(0, 16)}`;
  const anyEscalate = ROLE_ORDER.some((role) => r.results[role]?.verdict === 'ESCALATE');
  const status: Invoice['status'] = r.decision === 'READY' ? 'ready' : r.decision === 'NEEDS_HUMAN' ? 'escalated' : anyEscalate ? 'escalated' : 'held';
  const limit = num(ledger.perTxLimitMicro);

  const headline =
    r.decision === 'READY' ? 'All five agents signed PASS. Ready for the Executor to release.'
    : r.decision === 'NEEDS_HUMAN' ? `All five agents signed PASS, but ${num(p.totalMicro ?? 0n).toLocaleString('en-US')} USDC is above the ${limit.toLocaleString('en-US')} USDC limit. A human must sign.`
    : r.reasons[0] ?? 'Held for review.';

  const checks: Invoice['checks'] = {};
  const llm: Invoice['llm'] = {};
  for (const role of ROLE_ORDER) {
    const res = r.results[role];
    if (!res) continue;
    checks[role] = res.checks;
    if (res.llm) llm[role] = { model: res.llm.model, used: res.llm.used, error: res.llm.error };
  }

  return {
    uid,
    id: p.invoiceNumber ?? 'UNPARSED',
    caseId,
    vendor: p.vendorName ?? 'Unknown vendor',
    amount: p.totalMicro === null ? 0 : num(p.totalMicro),
    category: vendor ? vendor.category[0].toUpperCase() + vendor.category.slice(1) : 'Uncategorized',
    received: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    due: fmtDate(p.due),
    payee: p.payee ? short(p.payee) : '—',
    payeeFull: p.payee ?? undefined,
    hash: r.invoiceHash ? short(r.invoiceHash) : '—',
    hashFull: r.invoiceHash ?? undefined,
    status,
    decision: r.decision,
    headline,
    flags: p.injectionFlags,
    simulated: false,
    source: text.slice(0, 4_000),
    processedAt: new Date().toISOString(),
    attestations: ROLE_ORDER.filter((role) => r.results[role]).map((role) => {
      const res = r.results[role]!;
      const ev = r.evidence[role];
      return { role, verdict: res.verdict, confidence: res.confidence, agentId: AGENT_IDS[role], note: res.note, cid: ev ? short(ev.hash, 8, 4) : '—' };
    }),
    ruleOverrides: previewRules(r, ledger),
    injectedText: p.injectionFlags.length ? text.split(/\r?\n/).filter((l) => /system note|ignore|agent/i.test(l)).join(' ').slice(0, 300) || undefined : undefined,
  };
}

async function seed(e: Engine): Promise<void> {
  // Run the five demo cases through the real agents, in order. Case A is recorded as paid (simulated)
  // so that the Sentinel can catch case B against it.
  for (const c of DEMO_CASES) {
    const text = readDemoInvoice(c.file);
    const r = await processInvoice(text, e.ledger, cfg(), loadAgentKeys());
    const inv = toInvoice(r, text, e.ledger, c.id);
    e.results.set(inv.uid, r);
    if (r.decision === 'READY' && c.id === 'A' && r.invoiceHash) {
      recordPaid(e.ledger, r.parsed, r.invoiceHash, findVendorByName(e.ledger, r.parsed.vendorName)!.id);
      inv.status = 'released'; inv.simulated = true;
    }
    e.invoices.push(inv);
  }
}

function restore(e: Engine, saved: Persisted): void {
  e.invoices = saved.invoices;
  for (const h of saved.paid) {
    e.ledger.history.push({ number: h.number, vendorId: h.vendorId, totalMicro: BigInt(h.total), issued: h.issued, payee: h.payee, lineSignature: h.lineSignature, hash: h.hash, status: 'paid' });
  }
  e.ledger.treasury.committedMicro = BigInt(saved.committed);
}

export function getEngine(): Promise<Engine> {
  g.__cosignEngine ??= (async () => {
    const e: Engine = { ledger: loadDemoLedger(), invoices: [], results: new Map() };
    if (existsSync(STATE_FILE)) {
      try { restore(e, JSON.parse(readFileSync(STATE_FILE, 'utf8')) as Persisted); return e; }
      catch (err) { console.error('ignoring unreadable demo state:', err instanceof Error ? err.message : err); }
    }
    await seed(e);
    persist(e);
    return e;
  })();
  return g.__cosignEngine;
}

export async function resetEngine(): Promise<void> {
  g.__cosignEngine = undefined;
  if (existsSync(STATE_FILE)) rmSync(STATE_FILE);
  await getEngine();
}

/**
 * Run an invoice through all five agents.
 * Re-submitting an unpaid invoice replaces its row (the agents are re-run against the current ledger).
 * Re-submitting one that was already paid is a NEW row, so the Sentinel's duplicate catch is visible.
 */
export async function submit(text: string): Promise<Invoice> {
  const e = await getEngine();
  const r = await processInvoice(text, e.ledger, cfg(), loadAgentKeys());
  let uid = r.invoiceHash ?? `unparsed-${r.parsed.sourceSha256.slice(0, 16)}`;
  const existing = e.invoices.find((i) => i.uid === uid);
  if (existing?.simulated) {
    let n = 2;
    while (e.invoices.some((i) => i.uid === `${uid}#${n}`)) n++;
    uid = `${uid}#${n}`;
  }
  const sample = DEMO_CASES.find((c) => readDemoInvoice(c.file) === text)?.id;
  const inv = { ...toInvoice(r, text, e.ledger, sample), uid };
  e.results.set(uid, r);
  const idx = e.invoices.findIndex((i) => i.uid === uid);
  if (idx >= 0) e.invoices[idx] = inv; else e.invoices.unshift(inv);
  persist(e);
  return inv;
}

/** A text PDF goes through the same path as pasted text. Throws PdfError with a readable message when it cannot be read. */
export async function submitPdf(bytes: Uint8Array): Promise<Invoice> {
  return submit(await pdfToText(bytes));
}

/** Record a payment in the demo ledger. No chain transaction exists; the receipt is marked simulated. */
export async function releaseSimulated(uid: string, approve: boolean): Promise<Invoice | null> {
  const e = await getEngine();
  const inv = e.invoices.find((i) => i.uid === uid);
  if (!inv) return null;
  if (!approve) { inv.status = 'held'; inv.humanSig = undefined; persist(e); return inv; }

  // The preview must agree: only the limit rule may be outstanding for a human approval to release.
  const blocking = Object.entries(inv.ruleOverrides).filter(([n, s]) => Number(n) !== 6 && s !== 'pass');
  if (blocking.length || inv.decision === 'HOLD') return inv;
  if (inv.status === 'released') return inv;

  const r = e.results.get(uid);
  const vendor = r && (findVendorByName(e.ledger, r.parsed.vendorName) ?? findVendorByDomain(e.ledger, r.parsed.senderEmail));
  if (r && vendor && inv.hashFull) recordPaid(e.ledger, r.parsed, inv.hashFull, vendor.id);
  const needsHuman = inv.ruleOverrides[6] === 'wait';
  delete inv.ruleOverrides[6];
  inv.status = 'released';
  inv.simulated = true;
  inv.humanSig = needsHuman ? 'approver (simulated)' : undefined;
  persist(e);
  return inv;
}
