import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { CctpSettler, FileSettlementStore, MemorySettlementStore, fetchAttestation, waitForAttestation, type Transmitter } from '../src/cctp';

const H = '0x' + 'ab'.repeat(32);
const BURN = '0x' + 'cd'.repeat(32);
const PAYEE = '0x' + '11'.repeat(20);
const MSG = { message: '0xaa', attestation: '0xbb', eventNonce: '0x' + '01'.repeat(32), status: 'complete' };

const reply = (status: number, body: unknown = {}) => async () => ({ ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) });
const noSleep = async () => undefined;

describe('Circle attestation polling', () => {
  it('returns null while Iris has not indexed the burn (404) or it is pending', async () => {
    assert.equal(await fetchAttestation(BURN, { fetch: reply(404) }), null);
    assert.equal(await fetchAttestation(BURN, { fetch: reply(200, { messages: [{ ...MSG, status: 'pending_confirmations', attestation: 'PENDING' }] }) }), null);
  });

  it('returns the message once it is complete', async () => {
    const m = await fetchAttestation(BURN, { fetch: reply(200, { messages: [MSG] }) });
    assert.equal(m?.attestation, '0xbb');
  });

  it('surfaces a server error instead of treating it as "not ready"', async () => {
    await assert.rejects(fetchAttestation(BURN, { fetch: reply(500, { error: 'boom' }) }), /Iris returned 500/);
  });

  it('keeps polling, then gives up at the deadline with a clear message', async () => {
    let t = 0;
    await assert.rejects(
      waitForAttestation(BURN, { fetch: reply(404), timeoutMs: 100, intervalMs: 40, sleep: async (ms) => { t += ms; }, now: () => t }),
      /has not attested burn/,
    );
  });

  it('succeeds on a later poll', async () => {
    let n = 0;
    const f = async () => { n++; return n < 3 ? { ok: false, status: 404, json: async () => ({}), text: async () => '' } : { ok: true, status: 200, json: async () => ({ messages: [MSG] }), text: async () => '' }; };
    const m = await waitForAttestation(BURN, { fetch: f, sleep: noSleep });
    assert.equal(m.message, '0xaa');
    assert.equal(n, 3);
  });
});

function fakeTransmitter(opts: { used?: boolean; failFirst?: boolean } = {}) {
  const calls: string[] = [];
  let first = true;
  const t: Transmitter = {
    usedNonces: async () => (opts.used ? 1n : 0n),
    receiveMessage: async (m) => {
      calls.push(m);
      if (opts.failFirst && first) { first = false; throw new Error('insufficient funds for gas'); }
      return { hash: '0x' + 'ee'.repeat(32), wait: async () => ({ blockNumber: 42 }) };
    },
  };
  return { t, calls };
}

const args = { invoiceHash: H, burnTx: BURN, destinationDomain: 6, payee: PAYEE, amount: 750_000n };
const base = { fetch: reply(200, { messages: [MSG] }), sleep: noSleep, intervalMs: 1 };

describe('CctpSettler (burn -> attestation -> mint)', () => {
  it('mints once and records every step', async () => {
    const { t, calls } = fakeTransmitter();
    const store = new MemorySettlementStore();
    const s = await new CctpSettler(store, { ...base, transmitterFor: () => t }).settle(args);
    assert.equal(s.state, 'MINTED');
    assert.equal(s.mintBlock, 42);
    assert.equal(s.destinationChain, 'Base Sepolia');
    assert.equal(calls.length, 1);
    assert.equal((await store.get(H))?.state, 'MINTED');
  });

  it('is idempotent: settling again sends nothing', async () => {
    const { t, calls } = fakeTransmitter();
    const settler = new CctpSettler(new MemorySettlementStore(), { ...base, transmitterFor: () => t });
    await settler.settle(args);
    await settler.settle(args);
    assert.equal(calls.length, 1);
  });

  it('does not mint again when the nonce is already used (someone else relayed it)', async () => {
    const { t, calls } = fakeTransmitter({ used: true });
    const s = await new CctpSettler(new MemorySettlementStore(), { ...base, transmitterFor: () => t }).settle(args);
    assert.equal(s.state, 'MINTED');
    assert.equal(calls.length, 0);
  });

  it('keeps the attestation when the mint fails (no gas) and resumes without asking Circle again', async () => {
    const { t, calls } = fakeTransmitter({ failFirst: true });
    const store = new MemorySettlementStore();
    let irisCalls = 0;
    const counting = async () => { irisCalls++; return { ok: true, status: 200, json: async () => ({ messages: [MSG] }), text: async () => '' }; };
    const settler = new CctpSettler(store, { ...base, fetch: counting, transmitterFor: () => t });
    await assert.rejects(settler.settle(args), /insufficient funds/);
    const stuck = await store.get(H);
    assert.equal(stuck?.state, 'ATTESTED');
    assert.match(stuck?.error ?? '', /insufficient funds/);
    const done = await settler.settle(args);
    assert.equal(done.state, 'MINTED');
    assert.equal(irisCalls, 1, 'the saved attestation was reused');
    assert.equal(calls.length, 2);
  });

  it('refuses a different burn transaction for the same invoice', async () => {
    const { t } = fakeTransmitter();
    const settler = new CctpSettler(new MemorySettlementStore(), { ...base, transmitterFor: () => t });
    await settler.settle(args);
    await assert.rejects(settler.settle({ ...args, burnTx: '0x' + '99'.repeat(32) }), /different burn transaction/);
  });

  it('rejects a destination it has no configuration for', async () => {
    const { t } = fakeTransmitter();
    await assert.rejects(new CctpSettler(new MemorySettlementStore(), { ...base, transmitterFor: () => t }).settle({ ...args, destinationDomain: 3 }), /no CCTP destination/);
  });

  it('persists to disk and rejects a bad invoice hash (path traversal)', async () => {
    const store = new FileSettlementStore(mkdtempSync(join(tmpdir(), 'cosign-cctp-')));
    const { t } = fakeTransmitter();
    await new CctpSettler(store, { ...base, transmitterFor: () => t }).settle(args);
    assert.equal((await store.get(H))?.state, 'MINTED');
    await assert.rejects(store.get('../../etc/passwd'), /invalid invoice hash/);
  });
});
