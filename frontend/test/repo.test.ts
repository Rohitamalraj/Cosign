import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { openDb, migrate, type Db } from '../src/server/db';
import { PgSettlementStore, PgStore, addIntake, listIntake, setIntakeStatus, addOutcome, createVendor, getSetting, listHistory, listOutcomes, listVendors, loadLedger, recordPayment, saveInvoice, getInvoice, setSetting, upsertAgreement, listInvoices, updateInvoiceStatus } from '../src/server/repo';
import { processInvoice } from '../../agents/src/pipeline';
import { loadAgentKeys } from '../../agents/src/keys';

const H = '0x' + 'ab'.repeat(32);
const WALLET = '0x' + '11'.repeat(20);
let db: Db;
beforeEach(async () => { db = await openDb({}); });
afterEach(async () => { await db.close(); });

describe('database', () => {
  it('migrations are idempotent', async () => {
    await migrate(db);
    await migrate(db);
    assert.equal((await db.query('select count(*)::int as n from schema_migrations'))[0].n, 3);
  });

  it('a failed transaction rolls everything back', async () => {
    await assert.rejects(db.tx(async (t) => { await setSetting(t, 'a', 1); throw new Error('boom'); }), /boom/);
    assert.equal(await getSetting(db, 'a', 'none'), 'none');
  });

  it('settings round-trip JSON', async () => {
    await setSetting(db, 'sanctioned', ['0xabc']);
    assert.deepEqual(await getSetting(db, 'sanctioned', []), ['0xabc']);
    await setSetting(db, 'sanctioned', []);
    assert.deepEqual(await getSetting(db, 'sanctioned', ['x']), []);
  });
});

describe('vendors, agreements, history', () => {
  it('creates a vendor, normalises it and refuses a duplicate wallet or a bad address', async () => {
    const v = await createVendor(db, { name: 'Acme Design Co.', emailDomain: 'Acme.Example', wallet: WALLET, category: 'Design', chains: ['Arc', 'Base Sepolia'] });
    assert.equal(v.id, 'acme-design-co');
    assert.equal(v.wallet, WALLET);
    assert.equal(v.emailDomain, 'acme.example');
    assert.deepEqual(v.chains, ['arc', 'base sepolia']);
    await assert.rejects(createVendor(db, { name: 'Other', emailDomain: 'o.example', wallet: WALLET, category: 'design' }), /already uses this wallet/);
    await assert.rejects(createVendor(db, { name: 'Bad', emailDomain: 'b.example', wallet: '0x123', category: 'design' }), /0x address/);
    const v2 = await createVendor(db, { name: 'Acme Design Co.', emailDomain: 'a2.example', wallet: '0x' + '22'.repeat(20), category: 'design' });
    assert.equal(v2.id, 'acme-design-co-2');
  });

  it('agreement amounts survive as bigint', async () => {
    const v = await createVendor(db, { name: 'V', emailDomain: 'v.example', wallet: WALLET, category: 'design' });
    await upsertAgreement(db, { ref: 'SOW-1', vendorId: v.id, lines: [{ match: 'Design Hours', rateMicro: 125_000_000n }], remainingMicro: 20_000_000_000n });
    const l = await loadLedger(db, { balanceMicro: 5n, perTxLimitMicro: 5_000_000n, reserveMicro: 1n });
    assert.equal(l.agreements[0].lines[0].rateMicro, 125_000_000n);
    assert.equal(l.agreements[0].lines[0].match, 'design hours');
    assert.equal(l.agreements[0].remainingMicro, 20_000_000_000n);
    assert.equal(l.agreements[0].expectedTotalMicro, null);
  });

  it('recording a payment twice counts once', async () => {
    const v = await createVendor(db, { name: 'V', emailDomain: 'v.example', wallet: WALLET, category: 'design' });
    const p = { number: 'INV-1', vendorId: v.id, totalMicro: 1_250_000n, issued: '2026-10-13', payee: WALLET, lineSignature: 'x#1', hash: H, status: 'paid' as const };
    assert.equal(await recordPayment(db, p), true);
    assert.equal(await recordPayment(db, p), false);
    assert.equal((await listHistory(db)).length, 1);
    assert.equal((await listVendors(db))[0].paidCount, 1);
  });

  it('the ledger takes treasury and limit from chain facts, not from the database', async () => {
    const l = await loadLedger(db, { balanceMicro: 11_500_000n, perTxLimitMicro: 5_000_000n, reserveMicro: 1_000_000n });
    assert.equal(l.treasury.balanceMicro, 11_500_000n);
    assert.equal(l.perTxLimitMicro, 5_000_000n);
  });

  it('real agents accept a ledger built from the database: a registered vendor passes, an unknown one is held', async () => {
    const v = await createVendor(db, { name: 'Northwind Design Co.', emailDomain: 'northwinddesign.example', wallet: '0x71c4000000000000000000000000000000009ae2', category: 'design' });
    await upsertAgreement(db, { ref: 'SOW-22', vendorId: v.id, description: 'retainer', lines: [{ match: 'design hours', rateMicro: 125_000_000n }], remainingMicro: 20_000_000_000n });
    const ledger = await loadLedger(db, { balanceMicro: 50_000_000_000n, perTxLimitMicro: 5_000_000_000n, reserveMicro: 5_000_000_000n });
    const text = 'INVOICE INV-9001\nFrom: Northwind Design Co. <billing@northwinddesign.example>\nTo: Acme\nIssued: 2026-10-13\nDue: 2026-10-20\nAgreement: SOW-22\nCurrency: USDC\nPay to wallet: 0x71c4000000000000000000000000000000009ae2\n\nDescription | Qty | Rate | Amount\nDesign hours - sprint | 10 | 125.00 | 1250.00\n\nTotal: 1250.00 USDC\nTerms: Net 7\n';
    const cfg = { chainId: 5042002, policyAddress: '0x' + '33'.repeat(20), agentIds: { READER: 1, VERIFIER: 2, MATCHER: 3, SENTINEL: 4, TREASURER: 5 }, now: () => new Date('2026-10-15T12:00:00Z') };
    const ok = await processInvoice(text, ledger, cfg, loadAgentKeys({}));
    assert.equal(ok.decision, 'READY', ok.reasons.join(' | '));
    const unknown = await processInvoice(text.replace('Northwind Design Co.', 'Mystery Corp').replace('northwinddesign.example', 'mystery.example').replace(/INV-9001/, 'INV-9002'), ledger, cfg, loadAgentKeys({}));
    assert.equal(unknown.decision, 'HOLD');
  });
});

describe('invoices and outcomes', () => {
  it('saves, updates and lists invoices', async () => {
    await saveInvoice(db, { uid: H, hash: H, status: 'ready', decision: 'READY', vendor: 'V', amountMicro: 1_250_000n, payee: WALLET, destinationDomain: 26, createdBy: '0xabc', view: { id: 'INV-1' }, package: { req: {} }, sourceText: 'INVOICE INV-1', history: { number: 'INV-1', vendorId: 'v', totalMicro: 1_250_000n, issued: '2026-10-13', payee: WALLET, lineSignature: 'x#1', hash: H } });
    await updateInvoiceStatus(db, H, 'released', { tx: '0xdead' });
    const got = await getInvoice(db, H);
    assert.equal(got?.status, 'released');
    assert.equal(got?.view.tx, '0xdead');
    assert.equal(got?.view.id, 'INV-1');
    assert.equal(got?.amountMicro, 1_250_000n);
    assert.equal(got?.sourceText, 'INVOICE INV-1');
    assert.equal(got?.history?.totalMicro, 1_250_000n);
    assert.equal((await listInvoices(db)).length, 1);
  });

  it('records outcomes with their effects', async () => {
    const o = await addOutcome(db, { invoiceUid: H, invoiceHash: H, kind: 'duplicate', note: 'seen twice', reporter: '0xabc', effects: [] });
    assert.ok(o.id > 0);
    assert.equal((await listOutcomes(db, H))[0].kind, 'duplicate');
  });
});

describe('the Executor stores on Postgres', () => {
  it('round-trips records, receipts and settlements, and rejects a bad hash', async () => {
    const s = new PgStore(db);
    const rec = { invoiceHash: H, state: 'CONFIRMED' as const, attempts: 1, txHash: '0xfeed', updatedAt: new Date().toISOString() };
    await s.putRecord(rec);
    assert.deepEqual(await s.getRecord(H), rec);
    await s.putRecord({ ...rec, state: 'REVERTED' });
    assert.equal((await s.getRecord(H))?.state, 'REVERTED');
    assert.equal(await s.getRecord('0x' + 'cd'.repeat(32)), null);
    await assert.rejects(s.getRecord("0x1'; drop table receipts;--"), /invalid invoice hash/);
    const st = new PgSettlementStore(db);
    await st.put({ invoiceHash: H, destinationDomain: 6, destinationChain: 'Base Sepolia', payee: WALLET, amount: '750000', burnTx: '0x1', state: 'MINTED', updatedAt: '' });
    assert.equal((await st.get(H))?.state, 'MINTED');
  });
});

describe('email inbox', () => {
  it('stores a message once: a provider retry of the same message id is ignored', async () => {
    const m = { channel: 'email', messageId: 'm-1', fromAddr: 'a@b.example', subject: 's', text: 'INVOICE', ocr: false, status: 'new' as const };
    assert.ok(await addIntake(db, m));
    assert.equal(await addIntake(db, m), null);
    assert.ok(await addIntake(db, { ...m, messageId: 'm-2' }));
    assert.equal((await listIntake(db)).length, 2);
  });

  it('messages without an id are all kept, and an item can be marked processed or dismissed', async () => {
    const base = { channel: 'email', messageId: null, fromAddr: 'a@b.example', subject: '', text: 'x', ocr: true, status: 'new' as const };
    const one = await addIntake(db, base);
    await addIntake(db, base);
    assert.equal((await listIntake(db)).length, 2);
    assert.equal(await setIntakeStatus(db, one!.id, 'processed', '0xabc'), true);
    assert.equal((await listIntake(db)).find((i) => i.id === one!.id)?.invoiceUid, '0xabc');
    assert.equal(await setIntakeStatus(db, 9999, 'dismissed'), false);
  });
});
