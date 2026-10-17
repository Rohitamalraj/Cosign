import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { autoPayEnabled, shouldAutoPay, type AutoPayInput } from '../src/server/autopay';

const E = (o: Record<string, string> = {}) => o as unknown as NodeJS.ProcessEnv;
const cleared: AutoPayInput = { enabled: true, allowed: true, canRelease: true, live: true, status: 'ready', hasPackage: true };

describe('automatic payment', () => {
  it('is on by default and can be switched off', () => {
    assert.equal(autoPayEnabled(E()), true);
    assert.equal(autoPayEnabled(E({ COSIGN_AUTO_PAY: '1' })), true);
    for (const off of ['0', 'false', 'off', 'no', ' FALSE ']) assert.equal(autoPayEnabled(E({ COSIGN_AUTO_PAY: off })), false, off);
  });

  it('pays an invoice the contract has cleared', () => {
    assert.equal(shouldAutoPay(cleared), true);
  });

  it('never pays anything the contract has not cleared', () => {
    // held (an agent signed doubt), over the limit (waits for the approver), or already paid
    for (const status of ['held', 'escalated', 'released']) assert.equal(shouldAutoPay({ ...cleared, status }), false, status);
  });

  it('needs a signed-in operator or admin, a connected chain and a payment to send', () => {
    assert.equal(shouldAutoPay({ ...cleared, canRelease: false }), false);
    assert.equal(shouldAutoPay({ ...cleared, live: false }), false);
    assert.equal(shouldAutoPay({ ...cleared, hasPackage: false }), false);
  });

  it('can be disabled for the whole server, and for callers that must never pay (inbound email)', () => {
    assert.equal(shouldAutoPay({ ...cleared, enabled: false }), false);
    assert.equal(shouldAutoPay({ ...cleared, allowed: false }), false);
  });
});
