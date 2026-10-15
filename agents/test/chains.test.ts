import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ARC_DOMAIN, DEMO_CASES, chainDomain, loadDemoLedger, readDemoInvoice } from '../src';
import { processInvoice } from '../src/pipeline';
import { baseCfg, keys } from './helpers';

const file = (id: string) => DEMO_CASES.find((c) => c.id === id)!.file;

describe('settlement chain (CCTP destination)', () => {
  it('maps chain names to CCTP domains and rejects unknown chains', () => {
    assert.equal(chainDomain('Base Sepolia'), 6);
    assert.equal(chainDomain('  base   sepolia '), 6);
    assert.equal(chainDomain('Arc'), ARC_DOMAIN);
    assert.equal(chainDomain('Solana'), null);
    assert.equal(chainDomain(null), null);
  });

  it('an invoice with no chain settles on Arc (domain 26) and the signed attestations say so', async () => {
    const r = await processInvoice(readDemoInvoice(file('A')), loadDemoLedger(), baseCfg(), keys);
    assert.equal(r.package!.req.destinationDomain, 26);
    for (const a of r.package!.atts) assert.equal(a.destinationDomain, 26);
  });

  it('case F: a vendor registered on Base Sepolia is READY, and every agent signs domain 6', async () => {
    const r = await processInvoice(readDemoInvoice(file('F')), loadDemoLedger(), baseCfg(), keys);
    assert.equal(r.decision, 'READY');
    assert.equal(r.results.VERIFIER!.checks.find((c) => c.name === 'chain')!.status, 'pass');
    assert.equal(r.package!.req.destinationDomain, 6);
    for (const a of r.package!.atts) assert.equal(a.destinationDomain, 6);
  });

  it('case G: a vendor registered for Arc only that asks for Base Sepolia is held by the Verifier', async () => {
    const r = await processInvoice(readDemoInvoice(file('G')), loadDemoLedger(), baseCfg(), keys);
    assert.equal(r.decision, 'HOLD');
    assert.equal(r.results.VERIFIER!.verdict, 'FAIL');
    assert.match(r.results.VERIFIER!.checks.find((c) => c.name === 'chain')!.detail, /registered for arc only/);
  });

  it('an unsupported chain cannot be signed at all, so nothing can be released', async () => {
    const text = readDemoInvoice(file('F')).replace('Base Sepolia', 'Solana');
    const r = await processInvoice(text, loadDemoLedger(), baseCfg(), keys);
    assert.equal(r.decision, 'HOLD');
    assert.equal(r.package, null);
    assert.ok(r.reasons.some((x) => /Unsupported settlement chain/.test(x)));
  });

  it('the destination chain changes the invoice hash only through the source document', async () => {
    const a = await processInvoice(readDemoInvoice(file('F')), loadDemoLedger(), baseCfg(), keys);
    const b = await processInvoice(readDemoInvoice(file('F')).replace('Base Sepolia', 'Ethereum Sepolia'), loadDemoLedger(), baseCfg(), keys);
    assert.notEqual(a.invoiceHash, b.invoiceHash);
  });
});
