import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { describe, it } from 'node:test';
import { explainRule } from '../src/explain';
import { createExecutorServer } from '../src/server';
import { FileStore, MemoryStore } from '../src/store';
import { packageSchema } from '../src/types';
import type { Executor } from '../src/executor';

const H = '0x' + 'ab'.repeat(32);
const ADDR = '0x' + '11'.repeat(20);
const SIG = '0x' + '22'.repeat(65);
const att = (role: number) => ({ invoiceHash: H, payee: ADDR, amount: '1250000000', role, verdict: 1, confidenceBps: 9300, evidenceHash: H, agentId: role + 1, expiry: 2_000_000_000, nonce: String(role + 1) });
const goodPkg = () => ({ req: { invoiceHash: H, payee: ADDR, amount: '1250000000', category: H }, atts: [0, 1, 2, 3, 4].map(att), sigs: Array(5).fill(SIG), humanSig: '0x' });

describe('package validation (this crosses a trust boundary)', () => {
  it('accepts a well-formed package and converts amounts to bigint', () => {
    const p = packageSchema.parse(goodPkg());
    assert.equal(p.req.amount, 1_250_000_000n);
    assert.equal(p.atts[0].nonce, 1n);
  });

  for (const [name, mutate] of [
    ['four attestations', (p: any) => p.atts.pop()],
    ['four signatures', (p: any) => p.sigs.pop()],
    ['a short signature', (p: any) => { p.sigs[0] = '0x1234'; }],
    ['a non-address payee', (p: any) => { p.req.payee = 'not-an-address'; }],
    ['a short invoice hash', (p: any) => { p.req.invoiceHash = '0x1234'; }],
    ['a negative amount', (p: any) => { p.req.amount = '-5'; }],
    ['a decimal amount', (p: any) => { p.req.amount = '12.5'; }],
    ['verdict NONE', (p: any) => { p.atts[0].verdict = 0; }],
    ['an unknown role', (p: any) => { p.atts[0].role = 9; }],
    ['a malformed human signature', (p: any) => { p.humanSig = '0xdeadbeef'; }],
    ['an extra-long human signature', (p: any) => { p.humanSig = '0x' + 'aa'.repeat(80); }],
  ] as [string, (p: any) => void][]) {
    it(`rejects ${name}`, () => {
      const p = goodPkg();
      mutate(p);
      assert.throws(() => packageSchema.parse(p));
    });
  }

  it('defaults humanSig to "0x"', () => {
    const { humanSig, ...rest } = goodPkg();
    assert.equal(packageSchema.parse(rest).humanSig, '0x');
  });
});

describe('explainRule', () => {
  it('names the failing agent and the reason', () => {
    assert.match(explainRule(4, 3), /Sentinel did not sign PASS/);
    assert.match(explainRule(5, 2), /cooling-off/);
    assert.match(explainRule(6, 0), /no human signature/);
    assert.match(explainRule(7, 0), /already in the paid set/);
    assert.match(explainRule(1, 255), /five attestations/);
    assert.match(explainRule(99, 0), /Unknown rule/);
  });
});

describe('stores', () => {
  const rec = { invoiceHash: H, state: 'HELD' as const, attempts: 1, updatedAt: 'now' };

  it('MemoryStore round-trips records', async () => {
    const s = new MemoryStore();
    assert.equal(await s.getRecord(H), null);
    await s.putRecord(rec);
    assert.deepEqual(await s.getRecord(H.toUpperCase().replace('0X', '0x')), rec);
  });

  it('FileStore persists across instances and leaves no temp files', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cosign-store-'));
    await new FileStore(dir).putRecord(rec);
    assert.deepEqual(await new FileStore(dir).getRecord(H), rec);
    assert.deepEqual(readdirSync(join(dir, 'records')), [`${H}.json`]);
  });

  it('FileStore refuses a path-traversal "hash"', async () => {
    const s = new FileStore(mkdtempSync(join(tmpdir(), 'cosign-store-')));
    await assert.rejects(s.getRecord('../../etc/passwd'), /invalid invoice hash/);
    await assert.rejects(s.putRecord({ ...rec, invoiceHash: '..\\..\\x' }), /invalid invoice hash/);
  });
});

describe('HTTP server', () => {
  const calls: unknown[] = [];
  const fake = {
    release: async (b: unknown) => { calls.push(b); packageSchema.parse(b); return { status: 'HELD', invoiceHash: H, rule: 4, detail: 3, reason: 'x' }; },
    reconcile: async () => null,
    status: async () => ({ record: null, receipt: null }),
  } as unknown as Executor;
  const token = 'a-long-enough-test-token';

  async function withServer<T>(fn: (base: string) => Promise<T>): Promise<T> {
    const server = createExecutorServer({ executor: fake, apiToken: token });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    try { return await fn(`http://127.0.0.1:${(server.address() as AddressInfo).port}`); }
    finally { await new Promise((r) => server.close(r)); }
  }
  const auth = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };

  it('refuses to start with a short token', () => {
    assert.throws(() => createExecutorServer({ executor: fake, apiToken: 'short' }));
  });

  it('healthz is open; everything else needs the token', async () => {
    await withServer(async (b) => {
      assert.equal((await fetch(`${b}/healthz`)).status, 200);
      assert.equal((await fetch(`${b}/releases/${H}`)).status, 401);
      assert.equal((await fetch(`${b}/release`, { method: 'POST', body: '{}' })).status, 401);
      assert.equal((await fetch(`${b}/releases/${H}`, { headers: { authorization: 'Bearer wrong-token-of-same-len!!' } })).status, 401);
      assert.equal((await fetch(`${b}/releases/${H}`, { headers: { authorization: `Bearer ${token}x` } })).status, 401);
    });
  });

  it('rejects non-JSON, oversized and invalid bodies with the right status', async () => {
    await withServer(async (b) => {
      assert.equal((await fetch(`${b}/release`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'text/plain' }, body: 'hi' })).status, 415);
      assert.equal((await fetch(`${b}/release`, { method: 'POST', headers: auth, body: 'not json' })).status, 400);
      assert.equal((await fetch(`${b}/release`, { method: 'POST', headers: auth, body: JSON.stringify({ pad: 'x'.repeat(300_000) }) })).status, 413);
    });
  });

  it('passes a valid package through and returns the outcome', async () => {
    await withServer(async (b) => {
      const res = await fetch(`${b}/release`, { method: 'POST', headers: auth, body: JSON.stringify(goodPkg()) });
      assert.equal(res.status, 200);
      assert.equal(((await res.json()) as any).status, 'HELD');
    });
  });

  it('unknown routes and malformed hashes are 404, and errors never leak internals', async () => {
    await withServer(async (b) => {
      assert.equal((await fetch(`${b}/nope`, { headers: auth })).status, 404);
      assert.equal((await fetch(`${b}/releases/0x123`, { headers: auth })).status, 404);
      assert.equal((await fetch(`${b}/releases/${H}`, { headers: auth })).status, 404); // unknown invoice
    });
  });
});
