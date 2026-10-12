const { loadFixture, time } = require('@nomicfoundation/hardhat-toolbox/network-helpers');
const { expect } = require('chai');
const { ethers } = require('hardhat');
const { deployAll, ROLES, VERDICT, usdc, CATEGORY } = require('./fixture');

const fails = (ctx, p, rule, detail) =>
  expect(ctx.release(p)).to.be.revertedWithCustomError(ctx.policy, 'RuleFailed').withArgs(rule, detail);

describe('CosignPolicy', () => {
  let ctx;
  beforeEach(async () => {
    ctx = await loadFixture(deployAll);
  });

  describe('happy path', () => {
    it('releases USDC when every rule passes', async () => {
      const p = await ctx.build({ amount: usdc(1_250) });
      expect(await ctx.evaluate(p)).to.deep.equal([0n, 0n]);

      const before = await ctx.token.balanceOf(ctx.payee.address);
      await expect(ctx.release(p)).to.emit(ctx.policy, 'Released');

      expect(await ctx.token.balanceOf(ctx.payee.address)).to.equal(before + usdc(1_250));
      expect(await ctx.policy.paid(p.req.invoiceHash)).to.equal(true);
      expect(await ctx.policy.categoryBudget(CATEGORY)).to.equal(usdc(100_000) - usdc(1_250));
    });

    it('only the executor can call release', async () => {
      const p = await ctx.build();
      await expect(ctx.release(p, ctx.stranger)).to.be.revertedWithCustomError(ctx.policy, 'NotExecutor');
      await expect(ctx.release(p, ctx.owner)).to.be.revertedWithCustomError(ctx.policy, 'NotExecutor');
    });

    it('a failed release moves nothing and changes no state', async () => {
      const p = await ctx.build({ verdicts: { SENTINEL: VERDICT.FAIL } });
      const before = await ctx.token.balanceOf(ctx.payee.address);
      await expect(ctx.release(p)).to.be.reverted;
      expect(await ctx.token.balanceOf(ctx.payee.address)).to.equal(before);
      expect(await ctx.policy.paid(p.req.invoiceHash)).to.equal(false);
    });
  });

  describe('rule 1: every required role attested', () => {
    it('holds when a role is missing', async () => {
      const p = await ctx.build({ drop: 'MATCHER' });
      expect(await ctx.evaluate(p)).to.deep.equal([1n, 255n]);
      await fails(ctx, p, 1, 255);
    });

    it('holds when one role signs twice and another is absent', async () => {
      // Two MATCHER attestations, no SENTINEL.
      const p = await ctx.build({ edit: (a, i) => { if (i === 3) { a.role = ROLES.MATCHER; a.agentId = ctx.agentIds[2]; } } });
      expect(await ctx.evaluate(p)).to.deep.equal([1n, 3n]);
    });
  });

  describe('rule 2: signers are registered, accountable agents', () => {
    it('rejects an unregistered agent id', async () => {
      const p = await ctx.build({ edit: (a, i) => { if (i === 2) a.agentId = 99; } });
      expect(await ctx.evaluate(p)).to.deep.equal([2n, 2n]);
    });

    it('rejects an attestation signed by the wrong key', async () => {
      const p = await ctx.build({ badSigner: 'VERIFIER' });
      expect(await ctx.evaluate(p)).to.deep.equal([2n, 1n]);
    });

    it('rejects a tampered attestation (signature no longer matches)', async () => {
      const p = await ctx.build();
      p.atts[0] = { ...p.atts[0], confidenceBps: 1 };
      expect(await ctx.evaluate(p)).to.deep.equal([2n, 0n]);
    });

    it('rejects an agent whose id belongs to a different role', async () => {
      const p = await ctx.build({ edit: (a, i) => { if (i === 4) a.agentId = ctx.agentIds[0]; } });
      expect(await ctx.evaluate(p)).to.deep.equal([2n, 4n]);
    });

    it('rejects an agent whose reputation fell below the threshold', async () => {
      await ctx.registry.connect(ctx.auditor).recordOutcome(ctx.agentIds[3], -20, 0); // 50 -> 30 < 40
      const p = await ctx.build();
      expect(await ctx.evaluate(p)).to.deep.equal([2n, 3n]);
    });

    it('rejects an agent whose bond was slashed below the minimum', async () => {
      await ctx.registry.connect(ctx.auditor).recordOutcome(ctx.agentIds[1], 0, usdc(450)); // 500 -> 50 < 100
      const p = await ctx.build();
      expect(await ctx.evaluate(p)).to.deep.equal([2n, 1n]);
    });

    it('rejects a deactivated agent', async () => {
      await ctx.registry.connect(ctx.operator).deactivate(ctx.agentIds[2]);
      const p = await ctx.build();
      expect(await ctx.evaluate(p)).to.deep.equal([2n, 2n]);
    });
  });

  describe('rule 3: attestations match on invoiceHash, payee and amount', () => {
    it('rejects a mismatched payee (mix-and-match)', async () => {
      const p = await ctx.build({ edit: (a, i) => { if (i === 1) a.payee = ctx.stranger.address; } });
      expect(await ctx.evaluate(p)).to.deep.equal([3n, 1n]);
    });

    it('rejects a mismatched amount', async () => {
      const p = await ctx.build({ edit: (a, i) => { if (i === 2) a.amount = usdc(1_251); } });
      expect(await ctx.evaluate(p)).to.deep.equal([3n, 2n]);
    });

    it('rejects a mismatched invoice hash', async () => {
      const p = await ctx.build({ edit: (a, i) => { if (i === 0) a.invoiceHash = ethers.id('other'); } });
      expect(await ctx.evaluate(p)).to.deep.equal([3n, 0n]);
    });

    it('rejects attestations that do not match the release request', async () => {
      const p = await ctx.build();
      p.req = { ...p.req, payee: ctx.stranger.address }; // attacker redirects the payment
      expect(await ctx.evaluate(p)).to.deep.equal([3n, 0n]);
    });
  });

  describe('rule 4: every verdict is PASS', () => {
    for (const [name, role] of [['FAIL', VERDICT.FAIL], ['ESCALATE', VERDICT.ESCALATE], ['NONE', VERDICT.NONE]]) {
      it(`holds on a ${name} verdict`, async () => {
        const p = await ctx.build({ verdicts: { SENTINEL: role } });
        expect(await ctx.evaluate(p)).to.deep.equal([4n, 3n]);
        await fails(ctx, p, 4, 3);
      });
    }

    it('four PASS and one FAIL is not a majority vote', async () => {
      const p = await ctx.build({ verdicts: { READER: VERDICT.FAIL } });
      expect(await ctx.evaluate(p)).to.deep.equal([4n, 0n]);
    });
  });

  describe('rule 5: payee allowlist, challenge and cooling-off', () => {
    it('holds for a payee that was never allowlisted', async () => {
      const p = await ctx.build({ payee: ctx.stranger.address });
      expect(await ctx.evaluate(p)).to.deep.equal([5n, 0n]);
    });

    it('holds for a challenged payee until cleared', async () => {
      await ctx.policy.connect(ctx.screener).challengePayee(ctx.payee.address);
      const p = await ctx.build();
      expect(await ctx.evaluate(p)).to.deep.equal([5n, 1n]);

      await ctx.policy.connect(ctx.screener).clearPayee(ctx.payee.address);
      expect(await ctx.evaluate(await ctx.build())).to.deep.equal([0n, 0n]);
    });

    it('holds a changed wallet through the 48h cooling-off, then releases', async () => {
      await ctx.policy.connect(ctx.screener).registerPayee(ctx.stranger.address, false);
      const p = await ctx.build({ payee: ctx.stranger.address });
      expect(await ctx.evaluate(p)).to.deep.equal([5n, 2n]);

      await time.increase(48 * 3_600 + 1);
      const later = await ctx.build({ payee: ctx.stranger.address });
      expect(await ctx.evaluate(later)).to.deep.equal([0n, 0n]);
    });

    it('only the screener or owner can allowlist a payee', async () => {
      await expect(ctx.policy.connect(ctx.stranger).registerPayee(ctx.stranger.address, true)).to.be.revertedWithCustomError(
        ctx.policy,
        'NotScreener',
      );
    });
  });

  describe('rule 6: limit, human signature and category budget', () => {
    it('holds an amount above the limit with no human signature', async () => {
      const p = await ctx.build({ amount: usdc(9_800) });
      expect(await ctx.evaluate(p)).to.deep.equal([6n, 0n]);
    });

    it('releases an over-limit amount with a valid human signature', async () => {
      const p = await ctx.build({ amount: usdc(9_800) });
      p.humanSig = await ctx.humanApproval(p.req);
      await expect(ctx.release(p)).to.emit(ctx.policy, 'Released');
    });

    it('rejects a human signature from the wrong key', async () => {
      const p = await ctx.build({ amount: usdc(9_800) });
      p.humanSig = await ctx.humanApproval(p.req, { signer: ctx.stranger });
      expect(await ctx.evaluate(p)).to.deep.equal([6n, 1n]);
    });

    it('rejects a human signature for a different amount', async () => {
      const p = await ctx.build({ amount: usdc(9_800) });
      p.humanSig = await ctx.humanApproval(p.req, { amount: usdc(5_001) });
      expect(await ctx.evaluate(p)).to.deep.equal([6n, 1n]);
    });

    it('rejects an expired human signature', async () => {
      const p = await ctx.build({ amount: usdc(9_800) });
      p.humanSig = await ctx.humanApproval(p.req, { expiryOffset: -5 });
      expect(await ctx.evaluate(p)).to.deep.equal([6n, 1n]);
    });

    it('does not need a human signature at exactly the limit', async () => {
      const p = await ctx.build({ amount: usdc(5_000) });
      expect(await ctx.evaluate(p)).to.deep.equal([0n, 0n]);
    });

    it('holds when the category budget is exhausted', async () => {
      await ctx.policy.setBudget(CATEGORY, usdc(1_000));
      const p = await ctx.build({ amount: usdc(1_250) });
      expect(await ctx.evaluate(p)).to.deep.equal([6n, 2n]);
    });

    it('a human signature does not bypass the category budget', async () => {
      await ctx.policy.setBudget(CATEGORY, usdc(1_000));
      const p = await ctx.build({ amount: usdc(9_800) });
      p.humanSig = await ctx.humanApproval(p.req);
      expect(await ctx.evaluate(p)).to.deep.equal([6n, 2n]);
    });
  });

  describe('rule 7: never paid before, no replay', () => {
    it('rejects a second payment of the same invoice (fresh attestations)', async () => {
      const first = await ctx.build({ invoiceHash: ethers.id('INV-1041') });
      await ctx.release(first);

      const retry = await ctx.build({ invoiceHash: ethers.id('INV-1041') });
      expect(await ctx.evaluate(retry)).to.deep.equal([7n, 0n]);
      await fails(ctx, retry, 7, 0);
    });

    it('rejects replaying the exact same signed package', async () => {
      const p = await ctx.build();
      await ctx.release(p);
      await expect(ctx.release(p)).to.be.revertedWithCustomError(ctx.policy, 'RuleFailed').withArgs(7, 0);
    });

    it('rejects reusing an attestation nonce on a different invoice', async () => {
      const first = await ctx.build({ nonceBase: 7_000 });
      await ctx.release(first);

      const second = await ctx.build({ nonceBase: 7_000 }); // new invoice hash, same agent nonces
      expect(await ctx.evaluate(second)).to.deep.equal([7n, 1n]);
    });

    it('a near-duplicate with a new hash passes the contract: that is the Sentinel’s job (rule 4)', async () => {
      await ctx.release(await ctx.build({ invoiceHash: ethers.id('INV-1041'), amount: usdc(1_250) }));
      const variant = await ctx.build({ invoiceHash: ethers.id('INV-1042'), amount: usdc(1_237.5), verdicts: { SENTINEL: VERDICT.FAIL } });
      expect(await ctx.evaluate(variant)).to.deep.equal([4n, 3n]);
    });
  });

  describe('rule 8: attestations are fresh', () => {
    it('rejects an expired attestation', async () => {
      const p = await ctx.build({ expiryOffset: -10 });
      expect(await ctx.evaluate(p)).to.deep.equal([8n, 0n]);
    });

    it('rejects one stale attestation among fresh ones', async () => {
      const p = await ctx.build({ edit: (a, i) => { if (i === 4) a.expiry = a.expiry - 7_200; } });
      expect(await ctx.evaluate(p)).to.deep.equal([8n, 4n]);
    });

    it('attestations go stale as time passes (never pay on timeout)', async () => {
      const p = await ctx.build({ expiryOffset: 600 });
      expect(await ctx.evaluate(p)).to.deep.equal([0n, 0n]);
      await time.increase(601);
      expect(await ctx.evaluate(p)).to.deep.equal([8n, 0n]);
    });
  });

  describe('configuration', () => {
    it('only the owner can change the limit and budgets', async () => {
      await expect(ctx.policy.connect(ctx.stranger).setPerTxLimit(1)).to.be.reverted;
      await expect(ctx.policy.connect(ctx.stranger).setBudget(CATEGORY, 1)).to.be.reverted;
    });

    it('lowering the limit forces a human signature', async () => {
      await ctx.policy.setPerTxLimit(usdc(1_000));
      const p = await ctx.build({ amount: usdc(1_250) });
      expect(await ctx.evaluate(p)).to.deep.equal([6n, 0n]);
    });
  });
});

describe('AgentRegistry', () => {
  let ctx;
  beforeEach(async () => {
    ctx = await loadFixture(deployAll);
  });

  it('only the auditor can write outcomes (no agent-to-agent ratings)', async () => {
    await expect(ctx.registry.connect(ctx.stranger).recordOutcome(1, 10, 0)).to.be.revertedWithCustomError(ctx.registry, 'NotAuditor');
    await expect(ctx.registry.connect(ctx.operator).recordOutcome(1, 10, 0)).to.be.revertedWithCustomError(ctx.registry, 'NotAuditor');
  });

  it('a confirmed catch raises the score', async () => {
    await ctx.registry.connect(ctx.auditor).recordOutcome(ctx.agentIds[3], 6, 0);
    expect((await ctx.registry.getAgent(ctx.agentIds[3])).score).to.equal(56);
  });

  it('a proven bad approval lowers the score and slashes the bond into the recovery pool', async () => {
    const poolBefore = await ctx.token.balanceOf(ctx.pool.address);
    await ctx.registry.connect(ctx.auditor).recordOutcome(ctx.agentIds[3], -23, usdc(100));
    const a = await ctx.registry.getAgent(ctx.agentIds[3]);
    expect(a.score).to.equal(27);
    expect(a.bond).to.equal(usdc(400));
    expect(await ctx.token.balanceOf(ctx.pool.address)).to.equal(poolBefore + usdc(100));
  });

  it('clamps scores to 0..100 and never slashes more than the bond', async () => {
    await ctx.registry.connect(ctx.auditor).recordOutcome(1, 500, 0);
    expect((await ctx.registry.getAgent(1)).score).to.equal(100);
    await ctx.registry.connect(ctx.auditor).recordOutcome(1, -500, usdc(9_999));
    const a = await ctx.registry.getAgent(1);
    expect(a.score).to.equal(0);
    expect(a.bond).to.equal(0);
  });

  it('scores are per agent and role: slashing one does not touch another', async () => {
    await ctx.registry.connect(ctx.auditor).recordOutcome(ctx.agentIds[3], -30, usdc(100));
    expect((await ctx.registry.getAgent(ctx.agentIds[2])).score).to.equal(50);
  });

  it('registration requires the minimum bond', async () => {
    await expect(ctx.registry.connect(ctx.operator).register(0, ctx.stranger.address, usdc(99))).to.be.revertedWithCustomError(
      ctx.registry,
      'BondTooLow',
    );
  });

  it('an operator can top up a slashed bond to restore eligibility', async () => {
    await ctx.registry.connect(ctx.auditor).recordOutcome(ctx.agentIds[1], 0, usdc(450));
    expect(await ctx.registry.isEligible(ctx.agentIds[1], 1)).to.equal(false);
    await ctx.registry.connect(ctx.operator).topUpBond(ctx.agentIds[1], usdc(200));
    expect(await ctx.registry.isEligible(ctx.agentIds[1], 1)).to.equal(true);
  });

  it('only the operator can top up a bond', async () => {
    await expect(ctx.registry.connect(ctx.stranger).topUpBond(1, usdc(1))).to.be.revertedWithCustomError(ctx.registry, 'NotOperator');
  });
});
