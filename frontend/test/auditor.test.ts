import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { OutcomeError, effectsFor, SLASH_MICRO, type Verdict } from '../src/server/auditor';
import type { RoleName } from '../../agents/src/types';

const ids = { READER: 1, VERIFIER: 2, MATCHER: 3, SENTINEL: 4, TREASURER: 5 } as Record<RoleName, number>;
const allPass = { READER: 'PASS', VERIFIER: 'PASS', MATCHER: 'PASS', SENTINEL: 'PASS', TREASURER: 'PASS' } as Record<RoleName, Verdict>;
const by = (e: ReturnType<typeof effectsFor>) => Object.fromEntries(e.map((x) => [x.role, x]));

describe('Auditor outcomes', () => {
  it('a confirmed-correct payment gives every signer +1 and never a slash', () => {
    const e = effectsFor('confirmed_correct', { verdicts: allPass, paid: true, agentIds: ids });
    assert.equal(e.length, 5);
    assert.ok(e.every((x) => x.scoreDelta === 1 && x.slashMicro === 0n));
  });

  it('a reported duplicate blames the Sentinel most, with a slash, and the others a little', () => {
    const e = by(effectsFor('duplicate', { verdicts: allPass, paid: true, agentIds: ids }));
    assert.equal(e.SENTINEL.scoreDelta, -10);
    assert.equal(e.SENTINEL.slashMicro, SLASH_MICRO);
    assert.equal(e.SENTINEL.agentId, 4);
    for (const r of ['READER', 'VERIFIER', 'MATCHER', 'TREASURER']) { assert.equal(e[r].scoreDelta, -2); assert.equal(e[r].slashMicro, 0n); }
  });

  it('wrong wallet blames the Verifier and wrong amount blames the Matcher', () => {
    assert.equal(by(effectsFor('wrong_wallet', { verdicts: allPass, paid: true, agentIds: ids })).VERIFIER.slashMicro, SLASH_MICRO);
    assert.equal(by(effectsFor('wrong_amount', { verdicts: allPass, paid: true, agentIds: ids })).MATCHER.slashMicro, SLASH_MICRO);
  });

  it('an agent that already flagged the invoice is not blamed for a payment that was made anyway', () => {
    const v = { ...allPass, SENTINEL: 'FAIL' as Verdict };
    const e = by(effectsFor('duplicate', { verdicts: v, paid: true, agentIds: ids }));
    assert.equal(e.SENTINEL, undefined);
    assert.equal(e.READER.scoreDelta, -2);
  });

  it('confirming a held invoice was bad rewards the agents that flagged it and docks the ones that passed it', () => {
    const v = { ...allPass, SENTINEL: 'FAIL' as Verdict, VERIFIER: 'ESCALATE' as Verdict };
    const e = by(effectsFor('rejected_bad', { verdicts: v, paid: false, agentIds: ids }));
    assert.equal(e.SENTINEL.scoreDelta, 3);
    assert.equal(e.VERIFIER.scoreDelta, 3);
    assert.equal(e.READER.scoreDelta, -2);
    assert.ok(Object.values(e).every((x) => x.slashMicro === 0n), 'nothing was paid, so nothing is slashed');
  });

  it('overturning a hold docks the agents that flagged it', () => {
    const v = { ...allPass, MATCHER: 'ESCALATE' as Verdict };
    const e = effectsFor('blocked_wrongly', { verdicts: v, paid: false, agentIds: ids });
    assert.deepEqual(e.map((x) => [x.role, x.scoreDelta]), [['MATCHER', -2]]);
  });

  it('refuses an outcome that does not fit the facts', () => {
    assert.throws(() => effectsFor('duplicate', { verdicts: allPass, paid: false, agentIds: ids }), OutcomeError);
    assert.throws(() => effectsFor('rejected_bad', { verdicts: allPass, paid: true, agentIds: ids }), /was not paid|only applies/);
    assert.throws(() => effectsFor('rejected_bad', { verdicts: allPass, paid: false, agentIds: ids }), /nothing to confirm/);
    assert.throws(() => effectsFor('blocked_wrongly', { verdicts: allPass, paid: false, agentIds: ids }), /nothing to overturn/);
    assert.throws(() => effectsFor('nonsense' as never, { verdicts: allPass, paid: true, agentIds: ids }), /unknown outcome/);
  });
});
