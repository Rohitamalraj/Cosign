const { expect } = require('chai');
const { ethers } = require('hardhat');
const { loadFixture } = require('@nomicfoundation/hardhat-toolbox/network-helpers');
const { deployAll, VERDICT, ROLE_NAMES, usdc } = require('./fixture');

/**
 * Property tests: hundreds of randomly mutated release packages against the real contract. A seeded generator makes
 * every failure reproducible. The invariants are the safety claims the product makes:
 *   I1  a package that breaks any rule never moves money;
 *   I2  an invoice is paid at most once, on any chain;
 *   I3  the policy's USDC only ever leaves through a successful release, and exactly by the released amount;
 *   I4  money never leaves for an address or chain the screener did not allow;
 *   I5  only the Executor can release.
 */
function prng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const BASE = 6;

async function setup() {
  const f = await deployAll();
  const messenger = await (await ethers.getContractFactory('MockTokenMessenger')).deploy();
  await f.policy.setTokenMessenger(messenger.target);
  await f.policy.connect(f.screener).registerRemotePayee(BASE, f.payee.address, true);
  return { ...f, messenger };
}

// Each mutation is either INVALID (the contract must reject it) or VALID (a well-formed package).
const MUTATIONS = [
  { name: 'valid', valid: true, opts: () => ({}) },
  { name: 'valid-remote', valid: true, opts: () => ({ destinationDomain: BASE }) },
  { name: 'drop-role', opts: (r) => ({ drop: ROLE_NAMES[Math.floor(r() * 5)] }) },
  { name: 'fail-verdict', opts: (r) => ({ verdicts: { [ROLE_NAMES[Math.floor(r() * 5)]]: VERDICT.FAIL } }) },
  { name: 'escalate-verdict', opts: (r) => ({ verdicts: { [ROLE_NAMES[Math.floor(r() * 5)]]: VERDICT.ESCALATE } }) },
  { name: 'none-verdict', opts: (r) => ({ verdicts: { [ROLE_NAMES[Math.floor(r() * 5)]]: VERDICT.NONE } }) },
  { name: 'bad-signer', opts: (r) => ({ badSigner: ROLE_NAMES[Math.floor(r() * 5)] }) },
  { name: 'expired', opts: () => ({ expiryOffset: -10 }) },
  { name: 'unlisted-payee', opts: () => ({ payee: ethers.Wallet.createRandom().address }) },
  { name: 'unlisted-chain', opts: () => ({ destinationDomain: 3 }) },
  { name: 'over-budget', opts: () => ({ amount: usdc(200_000) }) },
  { name: 'over-limit-no-human', opts: () => ({ amount: usdc(6_000) }) },
  { name: 'one-agent-signs-other-amount', opts: (r) => { const i = Math.floor(r() * 5); return { edit: (a, k) => { if (k === i) a.amount = a.amount + 1n; } }; } },
  { name: 'one-agent-signs-other-chain', opts: (r) => { const i = Math.floor(r() * 5); return { edit: (a, k) => { if (k === i) a.destinationDomain = 3; } }; } },
  { name: 'one-agent-signs-other-payee', opts: (r) => { const i = Math.floor(r() * 5); return { edit: (a, k) => { if (k === i) a.payee = ethers.Wallet.createRandom().address; } }; } },
  { name: 'one-agent-signs-other-invoice', opts: (r) => { const i = Math.floor(r() * 5); return { edit: (a, k) => { if (k === i) a.invoiceHash = ethers.id(`other-${r()}`); } }; } },
  { name: 'unregistered-agent-id', opts: (r) => { const i = Math.floor(r() * 5); return { edit: (a, k) => { if (k === i) a.agentId = 99; } }; } },
  { name: 'role-id-mismatch', opts: () => ({ edit: (a, k) => { if (k === 0) a.agentId = 2; } }) },
];

describe('policy invariants (randomized, seeded)', () => {
  it('I1-I4: across 240 random packages, nothing invalid ever moves money and nothing is paid twice', async () => {
    const f = await loadFixture(setup);
    const { policy, token, payee, build, release, messenger } = f;
    const rnd = prng(20261014);
    const paidHashes = new Set();
    let released = 0;
    let expectedOut = 0n;

    for (let n = 0; n < 240; n++) {
      const m = MUTATIONS[Math.floor(rnd() * MUTATIONS.length)];
      const opts = { ...m.opts(rnd) };
      // 1 in 6 valid packages reuse an already-paid invoice hash: a duplicate, which must be rejected (I2).
      let duplicate = false;
      if (m.valid && paidHashes.size && rnd() < 1 / 6) {
        opts.invoiceHash = [...paidHashes][Math.floor(rnd() * paidHashes.size)];
        duplicate = true;
      }
      if (m.valid && !opts.amount) opts.amount = usdc(1 + Math.floor(rnd() * 400));

      const p = await build(opts);
      const before = await token.balanceOf(policy.target);
      const payeeBefore = await token.balanceOf(payee.address);
      const burnsBefore = await messenger.burnCount();
      let ok = true;
      try { await release(p); } catch { ok = false; }

      const after = await token.balanceOf(policy.target);
      if (m.valid && !duplicate) {
        expect(ok, `valid package rejected (${m.name}, n=${n})`).to.equal(true);
        expect(before - after).to.equal(p.req.amount);
        paidHashes.add(p.req.invoiceHash);
        released++;
        expectedOut += p.req.amount;
        if (p.req.destinationDomain === BASE) {
          expect(await messenger.burnCount()).to.equal(burnsBefore + 1n);
          expect(await token.balanceOf(payee.address)).to.equal(payeeBefore); // burned, not paid on Arc
        } else {
          expect(await token.balanceOf(payee.address)).to.equal(payeeBefore + p.req.amount);
        }
      } else {
        expect(ok, `INVALID package was released (${m.name}${duplicate ? ' + duplicate' : ''}, n=${n})`).to.equal(false);
        expect(after).to.equal(before); // I1: nothing moved
        expect(await messenger.burnCount()).to.equal(burnsBefore);
      }
    }

    // I3: conservation. Everything that left the policy is exactly the sum of successful releases.
    const start = usdc(1_000_000);
    expect(start - (await token.balanceOf(policy.target))).to.equal(expectedOut);
    expect(released).to.be.greaterThan(10); // the run really exercised the valid path
    for (const h of paidHashes) expect(await policy.paid(h)).to.equal(true); // I2 on-chain state agrees
  });

  it('I5: nobody but the Executor can release, whatever the package', async () => {
    const { policy, owner, screener, operator, approver, stranger, build, release, token } = await loadFixture(setup);
    const p = await build();
    const before = await token.balanceOf(policy.target);
    for (const who of [owner, screener, operator, approver, stranger]) {
      await expect(release(p, who)).to.be.revertedWithCustomError(policy, 'NotExecutor');
    }
    expect(await token.balanceOf(policy.target)).to.equal(before);
  });

  it('a valid package evaluates to (0,0) and an invalid one never does, for every mutation kind', async () => {
    const { evaluate, build } = await loadFixture(setup);
    const rnd = prng(7);
    for (const m of MUTATIONS) {
      const p = await build({ ...m.opts(rnd) });
      const [rule] = await evaluate(p);
      if (m.valid) expect(rule, m.name).to.equal(0n);
      else expect(rule, m.name).to.not.equal(0n);
    }
  });
});
