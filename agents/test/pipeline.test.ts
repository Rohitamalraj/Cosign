import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { isAddress } from 'ethers';
import { canonicalJson, keccak } from '../src/hash';
import { deepFreeze, parseInvoice } from '../src/parse';
import { fmtMicro, parseMicro } from '../src/money';
import { recoverAttestationSigner, domainFor } from '../src/eip712';
import { processInvoice, type ProcessResult } from '../src/pipeline';
import { recordPaid } from '../src/ledger';
import { ROLE_ORDER, VERDICT_CODE } from '../src/types';
import { baseCfg, freshLedger, invoiceText, keys } from './helpers';

/** Run a demo case. `paidBefore` lists earlier cases to mark as paid first (so B can see A in history). */
async function run(id: 'A' | 'B' | 'C' | 'D' | 'E', over = {}, ledger = freshLedger()): Promise<ProcessResult> {
  return processInvoice(invoiceText(id), ledger, baseCfg(over), keys);
}

describe('fixtures', () => {
  it('every wallet in the demo data is a valid 20-byte address', () => {
    const l = freshLedger();
    for (const v of l.vendors) assert.ok(isAddress(v.wallet), v.wallet);
    for (const id of ['A', 'B', 'C', 'D', 'E'] as const) {
      for (const a of parseInvoice(invoiceText(id)).bodyAddresses) assert.ok(isAddress(a), a);
    }
  });
});

describe('money', () => {
  it('parses plain amounts into micro-units', () => {
    assert.equal(parseMicro('1250.00'), 1_250_000_000n);
    assert.equal(parseMicro('1,250.5'), 1_250_500_000n);
    assert.equal(parseMicro('0.000001'), 1n);
    assert.equal(fmtMicro(1_237_500_000n), '1,237.50');
  });
  it('rejects negatives, too many decimals, junk and bad thousands grouping', () => {
    for (const bad of ['-5', '1.2345678', 'abc', '1,25.00', '', '1e6', '$5', '1..0']) assert.equal(parseMicro(bad), null, bad);
  });
});

describe('the five demo cases (deterministic mode, no model)', () => {
  it('A: clean invoice is READY and every agent passes', async () => {
    const r = await run('A');
    assert.equal(r.decision, 'READY');
    for (const role of ROLE_ORDER) assert.equal(r.results[role]!.verdict, 'PASS', role);
  });

  it('B: re-sent invoice with a new number and amount is held by the Sentinel alone', async () => {
    const ledger = freshLedger();
    const a = await run('A', {}, ledger);
    recordPaid(ledger, a.parsed, a.invoiceHash!, 'northwind');
    const b = await run('B', {}, ledger);
    assert.equal(b.decision, 'HOLD');
    assert.equal(b.results.SENTINEL!.verdict, 'FAIL');
    assert.match(b.results.SENTINEL!.note, /Near-duplicate of INV-1041/);
    for (const role of ['READER', 'VERIFIER', 'MATCHER', 'TREASURER'] as const) assert.equal(b.results[role]!.verdict, 'PASS', role);
    assert.notEqual(a.invoiceHash, b.invoiceHash); // the contract's paid set alone would NOT catch this
  });

  it('B without INV-1041 in history passes the Sentinel: detection depends on the ledger', async () => {
    const b = await run('B');
    assert.equal(b.results.SENTINEL!.verdict, 'PASS');
  });

  it('C: wallet change from the vendor domain is ESCALATE with a cooling-off action', async () => {
    const c = await run('C');
    assert.equal(c.decision, 'HOLD');
    assert.equal(c.results.VERIFIER!.verdict, 'ESCALATE');
    const actions = (c.results.VERIFIER!.extra as any).actions as { type: string }[];
    assert.equal(actions[0].type, 'open_cooling_off_and_challenge');
    assert.equal(c.results.SENTINEL!.verdict, 'PASS', 'a normal "please send payment to" email is not an injection');
  });

  it('C: a wallet change from the WRONG domain is FAIL, not ESCALATE', async () => {
    const text = invoiceText('C').replace('From: accounts@lumencloud.example', 'From: accounts@lumencloud-billing.example');
    const r = await processInvoice(text, freshLedger(), baseCfg(), keys);
    assert.equal(r.results.VERIFIER!.verdict, 'FAIL');
  });

  it('D: injected instructions are recorded, never followed', async () => {
    const d = await run('D');
    assert.equal(d.decision, 'HOLD');
    assert.equal(d.results.READER!.verdict, 'PASS');
    assert.ok(d.parsed.injectionFlags.length >= 3);
    assert.equal(d.parsed.payee, '0x5d1200000000000000000000000000000000ab40', 'payee stays the registered wallet');
    assert.notEqual(d.package!.req.payee.toLowerCase(), '0xdead00000000000000000000000000000000beef');
    assert.equal(d.results.VERIFIER!.verdict, 'FAIL');
    assert.equal(d.results.SENTINEL!.verdict, 'FAIL');
  });

  it('E: valid invoice above the limit needs a human, with every agent PASS', async () => {
    const e = await run('E');
    assert.equal(e.decision, 'NEEDS_HUMAN');
    for (const role of ROLE_ORDER) assert.equal(e.results[role]!.verdict, 'PASS', role);
  });
});

describe('Reader', () => {
  it('ESCALATEs when line items do not add up to the total', async () => {
    const text = invoiceText('A').replace('Total: 1250.00 USDC', 'Total: 1300.00 USDC');
    const r = await processInvoice(text, freshLedger(), baseCfg(), keys);
    assert.equal(r.results.READER!.verdict, 'ESCALATE');
    assert.equal(r.decision, 'HOLD');
  });

  it('with no payee wallet it signs nothing and holds', async () => {
    const text = invoiceText('A').replace(/^Pay to wallet:.*$/m, '');
    const r = await processInvoice(text, freshLedger(), baseCfg(), keys);
    assert.equal(r.decision, 'HOLD');
    assert.equal(r.package, null);
  });

  it('rejects a non-USD currency and an impossible date', () => {
    assert.equal(parseInvoice(invoiceText('A').replace('Issued: 2026-10-13', 'Issued: 2026-13-45')).issued, null);
  });

  it('a negative or garbled total is not parsed as money', () => {
    assert.equal(parseInvoice(invoiceText('A').replace('Total: 1250.00 USDC', 'Total: -1250.00 USDC')).totalMicro, null);
  });
});

describe('Verifier, Sentinel and Treasurer edge cases', () => {
  it('unknown vendor is ESCALATE: onboarding is required before first payment', async () => {
    const text = invoiceText('A').replace('Northwind Design Co. <billing@northwinddesign.example>', 'Brand New Vendor <hi@brandnew.example>');
    const r = await processInvoice(text, freshLedger(), baseCfg(), keys);
    assert.equal(r.results.VERIFIER!.verdict, 'ESCALATE');
  });

  it('a sanctioned payee is FAIL', async () => {
    const l = freshLedger();
    l.sanctioned.push('0x71c4000000000000000000000000000000009ae2');
    const r = await processInvoice(invoiceText('A'), l, baseCfg(), keys);
    assert.equal(r.results.VERIFIER!.verdict, 'FAIL');
  });

  it('a look-alike vendor name is FAIL at the Sentinel', async () => {
    const text = invoiceText('A').replace('Northwind Design Co.', 'Northwlnd Design Co.');
    const r = await processInvoice(text, freshLedger(), baseCfg(), keys);
    assert.equal(r.results.SENTINEL!.verdict, 'FAIL');
    assert.match(r.results.SENTINEL!.note, /looks like registered vendor/);
  });

  it('a recurring same-amount invoice a month later is not a duplicate', async () => {
    const r = await run('C');
    assert.equal(r.results.SENTINEL!.verdict, 'PASS');
  });

  it('a large amount versus vendor history is ESCALATE', async () => {
    const l = freshLedger();
    for (const n of ['INV-0001', 'INV-0002', 'INV-0003']) {
      l.history.push({ number: n, vendorId: 'northwind', totalMicro: 100_000_000n, issued: '2026-05-01', payee: '0x71c4000000000000000000000000000000009ae2', lineSignature: 'other#1', hash: null, status: 'paid' });
    }
    l.history = l.history.filter((h) => !['INV-1020', 'INV-1031'].includes(h.number));
    const r = await processInvoice(invoiceText('A'), l, baseCfg(), keys);
    assert.equal(r.results.SENTINEL!.verdict, 'ESCALATE');
  });

  it('Matcher: variance above 1% escalates and above 5% fails', async () => {
    const mid = invoiceText('A').replace('125.00', '121.00').replace('1250.00', '1210.00').replace('Total: 1250.00', 'Total: 1210.00'); // -3.2%
    assert.equal((await processInvoice(mid, freshLedger(), baseCfg(), keys)).results.MATCHER!.verdict, 'ESCALATE');
    const big = invoiceText('A').replace('125.00', '200.00').replace('1250.00', '2000.00').replace('Total: 1250.00', 'Total: 2000.00');
    assert.equal((await processInvoice(big, freshLedger(), baseCfg(), keys)).results.MATCHER!.verdict, 'FAIL');
  });

  it('Matcher: an agreement that belongs to another vendor is FAIL', async () => {
    const text = invoiceText('A').replace('Agreement: SOW-22', 'Agreement: PO-318');
    assert.equal((await processInvoice(text, freshLedger(), baseCfg(), keys)).results.MATCHER!.verdict, 'FAIL');
  });

  it('Matcher: no agreement on file is ESCALATE', async () => {
    const text = invoiceText('A').replace('Agreement: SOW-22', 'Agreement: NOPE-1');
    assert.equal((await processInvoice(text, freshLedger(), baseCfg(), keys)).results.MATCHER!.verdict, 'ESCALATE');
  });

  it('Treasurer: insufficient liquid cash is ESCALATE', async () => {
    const l = freshLedger();
    l.treasury.balanceMicro = 5_500_000_000n; // 5,500 balance - 5,000 reserve = 500 liquid
    assert.equal((await processInvoice(invoiceText('A'), l, baseCfg(), keys)).results.TREASURER!.verdict, 'ESCALATE');
  });

  it('Treasurer: takes an early-pay discount when cash allows', async () => {
    const text = invoiceText('A').replace('Terms: Net 7', 'Terms: 2% discount if paid within 10 days');
    const r = await processInvoice(text, freshLedger(), baseCfg(), keys);
    const plan = (r.results.TREASURER!.extra as any).plan;
    assert.equal(plan.action, 'TAKE_DISCOUNT');
  });
});

describe('signing and evidence', () => {
  it('every attestation is bound to the same invoice, payee and amount, and recovers to its role key', async () => {
    const r = await run('A', { policyAddress: '0x00000000000000000000000000000000000000aa', chainId: 4242 });
    const pkg = r.package!;
    assert.equal(pkg.atts.length, 5);
    const domain = domainFor(4242, '0x00000000000000000000000000000000000000aa');
    pkg.atts.forEach((a, i) => {
      const role = ROLE_ORDER[i];
      assert.equal(a.role, i);
      assert.equal(a.invoiceHash, pkg.req.invoiceHash);
      assert.equal(a.payee, pkg.req.payee);
      assert.equal(a.amount, pkg.req.amount);
      assert.equal(a.verdict, VERDICT_CODE.PASS);
      assert.equal(recoverAttestationSigner(domain, a, pkg.sigs[i]), keys[role].address);
    });
    assert.equal(new Set(pkg.atts.map((a) => a.nonce)).size, 5, 'nonces are unique');
  });

  it('a signature does not verify under a different policy address (no cross-contract replay)', async () => {
    const r = await run('A', { policyAddress: '0x00000000000000000000000000000000000000aa' });
    const other = domainFor(31337, '0x00000000000000000000000000000000000000bb');
    assert.notEqual(recoverAttestationSigner(other, r.package!.atts[0], r.package!.sigs[0]), keys.READER.address);
  });

  it('FAIL and ESCALATE verdicts are signed as such, never as PASS', async () => {
    const d = await run('D');
    assert.equal(d.package!.atts[1].verdict, VERDICT_CODE.FAIL);
    assert.equal(d.package!.atts[3].verdict, VERDICT_CODE.FAIL);
    const c = await run('C');
    assert.equal(c.package!.atts[1].verdict, VERDICT_CODE.ESCALATE);
  });

  it('evidence hash matches the stored bundle', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cosign-ev-'));
    const r = await run('A', { evidenceDir: dir });
    for (const role of ROLE_ORDER) {
      const { hash } = r.evidence[role]!;
      const stored = readFileSync(join(dir, `${hash}.json`), 'utf8');
      assert.equal(keccak(stored), hash);
      assert.equal(JSON.parse(stored).role, role);
    }
  });

  it('the evidence bundle never contains the raw document text', async () => {
    const d = await run('D');
    assert.ok(!canonicalJson(d.evidence.SENTINEL!.bundle).includes('SYSTEM NOTE TO AI AGENT'));
  });

  it('identical invoice text always produces the same invoiceHash', async () => {
    assert.equal((await run('A')).invoiceHash, (await run('A')).invoiceHash);
  });
});

describe('independence', () => {
  it('deepFreeze makes parsed data immutable', () => {
    const p = deepFreeze(parseInvoice(invoiceText('A')));
    assert.ok(Object.isFrozen(p) && Object.isFrozen(p.lineItems) && Object.isFrozen(p.lineItems[0]));
    assert.throws(() => { (p as any).payee = '0xdead'; }, TypeError);
  });
});
