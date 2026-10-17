/**
 * Data access: vendors, agreements, payment history, invoices, settings, and the Executor's durable stores.
 * Pure functions over a `Db`, so the same code runs against Postgres in production and PGlite in tests.
 */
import type { Db } from './db';
import type { Agreement, HistoryInvoice, Ledger, Vendor } from '../../../agents/src/ledger';
import type { Store } from '../../../executor/src/store';
import type { SettlementStore, Settlement } from '../../../executor/src/cctp';
import type { Receipt } from '../../../executor/src/receipt';
import type { ReleaseRecord } from '../../../executor/src/types';

const big = (v: unknown): bigint => BigInt(String(v ?? '0').split('.')[0]);
const bigOrNull = (v: unknown): bigint | null => (v === null || v === undefined ? null : big(v));

// ---- Settings ----

export async function getSetting<T>(db: Db, key: string, fallback: T): Promise<T> {
  const rows = await db.query<{ value: T }>('select value from settings where key = $1', [key]);
  return rows.length ? rows[0].value : fallback;
}

export async function setSetting(db: Db, key: string, value: unknown): Promise<void> {
  await db.query('insert into settings(key, value) values ($1, $2::jsonb) on conflict (key) do update set value = excluded.value', [key, JSON.stringify(value)]);
}

// ---- Vendors and agreements ----

export interface VendorRow extends Vendor {
  chains: string[];
  onchain: Record<string, unknown>;
  createdAt: string;
}

const toVendor = (r: Record<string, unknown>): VendorRow => ({
  id: String(r.id),
  name: String(r.name),
  aliases: (r.aliases as string[]) ?? [],
  emailDomain: String(r.email_domain),
  wallet: String(r.wallet).toLowerCase(),
  walletSinceDays: Math.max(0, Math.floor((Date.now() - new Date(String(r.wallet_since)).getTime()) / 86_400_000)),
  category: String(r.category),
  paidCount: Number(r.paid_count),
  chains: (r.chains as string[]) ?? ['arc'],
  onchain: (r.onchain as Record<string, unknown>) ?? {},
  createdAt: new Date(String(r.created_at)).toISOString(),
});

export async function listVendors(db: Db): Promise<VendorRow[]> {
  return (await db.query('select * from vendors order by created_at')).map(toVendor);
}

export async function getVendor(db: Db, id: string): Promise<VendorRow | null> {
  const rows = await db.query('select * from vendors where id = $1', [id]);
  return rows.length ? toVendor(rows[0]) : null;
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'vendor';

export interface NewVendor {
  name: string;
  aliases?: string[];
  emailDomain: string;
  wallet: string;
  category: string;
  chains?: string[];
  createdBy?: string;
}

export async function createVendor(db: Db, v: NewVendor): Promise<VendorRow> {
  const wallet = v.wallet.toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(wallet)) throw Object.assign(new Error('wallet must be a 0x address'), { status: 400 });
  const dupWallet = await db.query('select id from vendors where wallet = $1', [wallet]);
  if (dupWallet.length) throw Object.assign(new Error('another vendor already uses this wallet'), { status: 400 });
  let id = slug(v.name);
  for (let n = 2; (await db.query('select 1 from vendors where id = $1', [id])).length; n++) id = `${slug(v.name)}-${n}`;
  await db.query(
    'insert into vendors(id, name, aliases, email_domain, wallet, category, chains, created_by) values ($1,$2,$3::jsonb,$4,$5,$6,$7::jsonb,$8)',
    [id, v.name.trim(), JSON.stringify(v.aliases ?? []), v.emailDomain.trim().toLowerCase(), wallet, v.category.toLowerCase(), JSON.stringify((v.chains ?? ['arc']).map((c) => c.toLowerCase())), v.createdBy ?? null],
  );
  return (await getVendor(db, id))!;
}

export async function setVendorOnchain(db: Db, id: string, patch: Record<string, unknown>): Promise<void> {
  await db.query("update vendors set onchain = onchain || $2::jsonb where id = $1", [id, JSON.stringify(patch)]);
}

export interface NewAgreement {
  ref: string;
  vendorId: string;
  description?: string;
  lines: { match: string; rateMicro: bigint }[];
  expectedTotalMicro?: bigint | null;
  remainingMicro?: bigint | null;
}

export async function upsertAgreement(db: Db, a: NewAgreement): Promise<void> {
  await db.query(
    `insert into agreements(ref, vendor_id, description, lines, expected_total_micro, remaining_micro) values ($1,$2,$3,$4::jsonb,$5,$6)
     on conflict (ref) do update set vendor_id = excluded.vendor_id, description = excluded.description, lines = excluded.lines,
       expected_total_micro = excluded.expected_total_micro, remaining_micro = excluded.remaining_micro`,
    [a.ref, a.vendorId, a.description ?? '', JSON.stringify(a.lines.map((l) => ({ match: l.match.toLowerCase(), rate: l.rateMicro.toString() }))), a.expectedTotalMicro?.toString() ?? null, a.remainingMicro?.toString() ?? null],
  );
}

export async function listAgreements(db: Db): Promise<Agreement[]> {
  return (await db.query('select * from agreements order by ref')).map((r) => ({
    ref: String(r.ref),
    vendorId: String(r.vendor_id),
    description: String(r.description),
    lines: ((r.lines as { match: string; rate: string }[]) ?? []).map((l) => ({ match: l.match.toLowerCase(), rateMicro: big(l.rate) })),
    expectedTotalMicro: bigOrNull(r.expected_total_micro),
    remainingMicro: bigOrNull(r.remaining_micro),
  }));
}

// ---- Payment history (what the Sentinel compares against) ----

export async function listHistory(db: Db): Promise<HistoryInvoice[]> {
  return (await db.query('select * from payments order by id')).map((r) => ({
    number: String(r.number), vendorId: String(r.vendor_id), totalMicro: big(r.total_micro), issued: String(r.issued),
    payee: String(r.payee).toLowerCase(), lineSignature: String(r.line_signature), hash: r.hash ? String(r.hash) : null, status: r.status as HistoryInvoice['status'],
  }));
}

/** Record a payment (or hold). A repeated hash is a no-op, so retries cannot double count. */
export async function recordPayment(db: Db, p: HistoryInvoice): Promise<boolean> {
  const rows = await db.query(
    `insert into payments(number, vendor_id, total_micro, issued, payee, line_signature, hash, status) values ($1,$2,$3,$4,$5,$6,$7,$8)
     on conflict do nothing returning id`,
    [p.number, p.vendorId, p.totalMicro.toString(), p.issued, p.payee, p.lineSignature, p.hash, p.status],
  );
  if (rows.length && p.status === 'paid') await db.query('update vendors set paid_count = paid_count + 1 where id = $1', [p.vendorId]);
  return rows.length > 0;
}

/** Chain facts the ledger needs but the database must not invent. */
export interface ChainFacts {
  balanceMicro: bigint;
  perTxLimitMicro: bigint;
  reserveMicro: bigint;
}

export async function loadLedger(db: Db, chain: ChainFacts): Promise<Ledger> {
  const [vendors, agreements, history, sanctioned] = await Promise.all([
    listVendors(db), listAgreements(db), listHistory(db), getSetting<string[]>(db, 'sanctioned', []),
  ]);
  return {
    vendors: vendors.map(({ onchain: _o, createdAt: _c, ...v }) => v),
    agreements,
    history,
    treasury: { balanceMicro: chain.balanceMicro, reserveMicro: chain.reserveMicro, committedMicro: 0n },
    sanctioned: sanctioned.map((s) => s.toLowerCase()),
    perTxLimitMicro: chain.perTxLimitMicro,
  };
}

// ---- Invoices (the UI view of every run, plus the release package) ----

export interface InvoiceRow {
  uid: string;
  hash: string | null;
  status: string;
  decision: string | null;
  vendor: string | null;
  amountMicro: bigint | null;
  payee: string | null;
  destinationDomain: number;
  createdBy: string | null;
  view: Record<string, unknown>;
  package: unknown;
  /** The full invoice text the agents read (kept so attestations can be re-signed when they expire). */
  sourceText: string | null;
  /** The payment-history entry to record once this invoice is actually paid. */
  history: Omit<HistoryInvoice, 'status'> & { totalMicro: bigint } | null;
  createdAt: string;
  updatedAt: string;
}

const toInvoice = (r: Record<string, unknown>): InvoiceRow => ({
  uid: String(r.uid), hash: r.hash ? String(r.hash) : null, status: String(r.status), decision: r.decision ? String(r.decision) : null,
  vendor: r.vendor ? String(r.vendor) : null, amountMicro: bigOrNull(r.amount_micro), payee: r.payee ? String(r.payee) : null,
  destinationDomain: Number(r.destination_domain), createdBy: r.created_by ? String(r.created_by) : null,
  view: r.view as Record<string, unknown>, package: r.package ?? null,
  sourceText: r.source_text ? String(r.source_text) : null,
  history: r.history ? { ...(r.history as object), totalMicro: big((r.history as { totalMicro: string }).totalMicro) } as InvoiceRow['history'] : null,
  createdAt: new Date(String(r.created_at)).toISOString(), updatedAt: new Date(String(r.updated_at)).toISOString(),
});

export async function saveInvoice(db: Db, i: Omit<InvoiceRow, 'createdAt' | 'updatedAt'>): Promise<void> {
  await db.query(
    `insert into invoices(uid, hash, status, decision, vendor, amount_micro, payee, destination_domain, created_by, view, package, source_text, history)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb,$12,$13::jsonb)
     on conflict (uid) do update set hash = excluded.hash, status = excluded.status, decision = excluded.decision, vendor = excluded.vendor,
       amount_micro = excluded.amount_micro, payee = excluded.payee, destination_domain = excluded.destination_domain,
       view = excluded.view, package = excluded.package, source_text = excluded.source_text, history = excluded.history, updated_at = now()`,
    [i.uid, i.hash, i.status, i.decision, i.vendor, i.amountMicro?.toString() ?? null, i.payee, i.destinationDomain, i.createdBy, JSON.stringify(i.view), i.package === null ? null : JSON.stringify(i.package), i.sourceText, i.history ? JSON.stringify({ ...i.history, totalMicro: i.history.totalMicro.toString() }) : null],
  );
}

export async function getInvoice(db: Db, uid: string): Promise<InvoiceRow | null> {
  const rows = await db.query('select * from invoices where uid = $1', [uid]);
  return rows.length ? toInvoice(rows[0]) : null;
}

export async function listInvoices(db: Db, limit = 200): Promise<InvoiceRow[]> {
  return (await db.query('select * from invoices order by created_at desc limit $1', [limit])).map(toInvoice);
}

export async function updateInvoiceStatus(db: Db, uid: string, status: string, viewPatch: Record<string, unknown> = {}): Promise<void> {
  await db.query('update invoices set status = $2, view = view || $3::jsonb, updated_at = now() where uid = $1', [uid, status, JSON.stringify({ ...viewPatch, status })]);
}

// ---- Outcomes (what the Auditor learns from) ----

export interface OutcomeRow {
  id: number;
  invoiceUid: string;
  invoiceHash: string | null;
  kind: string;
  note: string;
  reporter: string;
  effects: unknown[];
  createdAt: string;
}

export async function addOutcome(db: Db, o: Omit<OutcomeRow, 'id' | 'createdAt'>): Promise<OutcomeRow> {
  const rows = await db.query(
    'insert into outcomes(invoice_uid, invoice_hash, kind, note, reporter, effects) values ($1,$2,$3,$4,$5,$6::jsonb) returning id, created_at',
    [o.invoiceUid, o.invoiceHash, o.kind, o.note, o.reporter, JSON.stringify(o.effects)],
  );
  return { ...o, id: Number(rows[0].id), createdAt: new Date(String(rows[0].created_at)).toISOString() };
}

export async function updateOutcomeEffects(db: Db, id: number, effects: unknown[]): Promise<void> {
  await db.query('update outcomes set effects = $2::jsonb where id = $1', [id, JSON.stringify(effects)]);
}

export async function listOutcomes(db: Db, invoiceUid?: string): Promise<OutcomeRow[]> {
  const rows = invoiceUid
    ? await db.query('select * from outcomes where invoice_uid = $1 order by id desc', [invoiceUid])
    : await db.query('select * from outcomes order by id desc limit 200');
  return rows.map((r) => ({
    id: Number(r.id), invoiceUid: String(r.invoice_uid), invoiceHash: r.invoice_hash ? String(r.invoice_hash) : null, kind: String(r.kind),
    note: String(r.note), reporter: String(r.reporter), effects: (r.effects as unknown[]) ?? [], createdAt: new Date(String(r.created_at)).toISOString(),
  }));
}

// ---- The Executor's durable memory, in the database ----

const HASH_RE = /^0x[0-9a-f]{64}$/;
const key = (h: string): string => {
  const x = h.toLowerCase();
  if (!HASH_RE.test(x)) throw new Error('invalid invoice hash');
  return x;
};

/** Implements the Executor's Store on Postgres: records are written before any transaction is sent, so a crash is recoverable. */
export class PgStore implements Store {
  constructor(private readonly db: Db) {}
  async getRecord(h: string) { const r = await this.db.query<{ data: ReleaseRecord }>('select data from release_records where invoice_hash = $1', [key(h)]); return r[0]?.data ?? null; }
  async putRecord(rec: ReleaseRecord) {
    await this.db.query('insert into release_records(invoice_hash, data) values ($1,$2::jsonb) on conflict (invoice_hash) do update set data = excluded.data, updated_at = now()', [key(rec.invoiceHash), JSON.stringify(rec)]);
  }
  async getReceipt(h: string) { const r = await this.db.query<{ data: Receipt }>('select data from receipts where invoice_hash = $1', [key(h)]); return r[0]?.data ?? null; }
  async putReceipt(h: string, receipt: Receipt) {
    await this.db.query('insert into receipts(invoice_hash, data) values ($1,$2::jsonb) on conflict (invoice_hash) do update set data = excluded.data', [key(h), JSON.stringify(receipt)]);
  }
}

export class PgSettlementStore implements SettlementStore {
  constructor(private readonly db: Db) {}
  async get(h: string) { const r = await this.db.query<{ data: Settlement }>('select data from settlements where invoice_hash = $1', [key(h)]); return r[0]?.data ?? null; }
  async put(s: Settlement) {
    await this.db.query('insert into settlements(invoice_hash, data) values ($1,$2::jsonb) on conflict (invoice_hash) do update set data = excluded.data', [key(s.invoiceHash), JSON.stringify(s)]);
  }
}

// ---- Intake (invoices that arrive by email) ----

export interface IntakeItem {
  id: number;
  channel: string;
  messageId: string | null;
  fromAddr: string;
  subject: string;
  text: string;
  ocr: boolean;
  status: 'new' | 'processed' | 'dismissed' | 'failed';
  invoiceUid: string | null;
  error: string | null;
  createdAt: string;
}

const toIntake = (r: Record<string, unknown>): IntakeItem => ({
  id: Number(r.id), channel: String(r.channel), messageId: r.message_id ? String(r.message_id) : null, fromAddr: String(r.from_addr), subject: String(r.subject),
  text: String(r.text), ocr: !!r.ocr, status: r.status as IntakeItem['status'], invoiceUid: r.invoice_uid ? String(r.invoice_uid) : null,
  error: r.error ? String(r.error) : null, createdAt: new Date(String(r.created_at)).toISOString(),
});

/** Returns null when this message id was already received (a provider retry), so nothing is processed twice. */
export async function addIntake(db: Db, i: Pick<IntakeItem, 'channel' | 'messageId' | 'fromAddr' | 'subject' | 'text' | 'ocr' | 'status'> & { invoiceUid?: string | null; error?: string | null }): Promise<IntakeItem | null> {
  const rows = await db.query(
    `insert into intake_items(channel, message_id, from_addr, subject, text, ocr, status, invoice_uid, error) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     on conflict do nothing returning *`,
    [i.channel, i.messageId, i.fromAddr, i.subject, i.text, i.ocr, i.status, i.invoiceUid ?? null, i.error ?? null],
  );
  return rows.length ? toIntake(rows[0]) : null;
}

export async function listIntake(db: Db, limit = 100): Promise<IntakeItem[]> {
  return (await db.query('select * from intake_items order by created_at desc limit $1', [limit])).map(toIntake);
}

export async function setIntakeStatus(db: Db, id: number, status: IntakeItem['status'], invoiceUid?: string | null): Promise<boolean> {
  const rows = await db.query('update intake_items set status = $2, invoice_uid = coalesce($3, invoice_uid) where id = $1 returning id', [id, status, invoiceUid ?? null]);
  return rows.length > 0;
}
