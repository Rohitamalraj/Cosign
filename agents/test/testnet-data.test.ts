import assert from 'node:assert/strict';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { isAddress } from 'ethers';
import { DEMO_CASES, loadDemoLedger, readDemoInvoice } from '../src';
import { processInvoice, type ProcessResult } from '../src/pipeline';
import { recordPaid } from '../src/ledger';
import { ROLE_ORDER } from '../src/types';
import { baseCfg, keys } from './helpers';

/** The testnet-scale data (amounts / 1000, fresh wallets) must produce exactly the same five outcomes. */
describe('testnet-scale demo data', () => {
  const prev = process.env.COSIGN_AGENTS_DATA;
  before(() => { process.env.COSIGN_AGENTS_DATA = join(__dirname, '..', 'data-testnet'); });
  after(() => { if (prev === undefined) delete process.env.COSIGN_AGENTS_DATA; else process.env.COSIGN_AGENTS_DATA = prev; });

  it('keeps the same verdicts as the full-scale data, with the limit at 5 USDC', async () => {
    const ledger = loadDemoLedger();
    assert.equal(ledger.perTxLimitMicro, 5_000_000n);
    for (const v of ledger.vendors) assert.ok(isAddress(v.wallet), v.wallet);

    const out: Record<string, ProcessResult> = {};
    for (const c of DEMO_CASES) {
      out[c.id] = await processInvoice(readDemoInvoice(c.file), ledger, baseCfg(), keys);
      if (c.id === 'A') recordPaid(ledger, out.A.parsed, out.A.invoiceHash!, 'northwind');
    }

    assert.equal(out.A.decision, 'READY');
    assert.equal(out.A.package!.req.amount, 1_250_000n, '1.25 USDC');
    assert.equal(out.B.results.SENTINEL!.verdict, 'FAIL');
    assert.equal(out.C.results.VERIFIER!.verdict, 'ESCALATE');
    assert.equal(out.D.results.VERIFIER!.verdict, 'FAIL');
    assert.equal(out.D.results.SENTINEL!.verdict, 'FAIL');
    assert.equal(out.E.decision, 'NEEDS_HUMAN');
    assert.equal(out.E.package!.req.amount, 9_800_000n, '9.80 USDC, above the 5 USDC limit');
    for (const role of ROLE_ORDER) assert.equal(out.E.results[role]!.verdict, 'PASS', role);
    assert.notEqual(out.D.package!.req.payee, out.D.parsed.bodyAddresses.find((a) => a !== out.D.parsed.payee), 'never pays the injected address');
  });
});
