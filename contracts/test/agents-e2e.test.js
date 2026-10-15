/**
 * End to end: the real agent pipeline (../agents) produces signed attestations, and the real CosignPolicy
 * contract decides whether USDC moves. Proves the EIP-712 types in TypeScript match the Solidity.
 */
require('tsx/cjs/api').register();

const { time } = require('@nomicfoundation/hardhat-toolbox/network-helpers');
const { expect } = require('chai');
const { ethers } = require('hardhat');
const { anyValue } = require('@nomicfoundation/hardhat-chai-matchers/withArgs');
const agents = require('../../agents/src');

const usdc = (n) => ethers.parseUnits(String(n), 6);
const { ROLE_ORDER } = agents;

describe('agents -> contract (end to end)', function () {
  this.timeout(60_000);

  let owner, executor, auditor, operator, approver, screener, pool;
  let token, registry, policy, keys, ledger, cfg, domain;

  const run = async (id, ledgerOverride = ledger) => {
    const now = await time.latest();
    return agents.processInvoice(
      agents.readDemoInvoice(agents.DEMO_CASES.find((c) => c.id === id).file),
      ledgerOverride,
      { ...cfg, now: () => new Date(now * 1000) },
      keys,
    );
  };

  /** A clean Northwind invoice that is clearly NOT a duplicate of INV-1041: new number, hours, amount and dates. */
  const distinctInvoice = async (number, hours, issued, due) => {
    const text = agents.readDemoInvoice('case-a-clean.txt')
      .replace('INV-1041', number)
      .replace('Issued: 2026-10-13', `Issued: ${issued}`)
      .replace('Due: 2026-10-20', `Due: ${due}`)
      .replace('Design hours - October sprint | 10 | 125.00 | 1250.00', `Design hours - ${number} work | ${hours} | 125.00 | ${hours * 125}.00`)
      .replace('Total: 1250.00', `Total: ${hours * 125}.00`);
    const now = await time.latest();
    return agents.processInvoice(text, ledger, { ...cfg, now: () => new Date(now * 1000) }, keys);
  };
  const evaluate = (r, humanSig = '0x') => policy.evaluate(r.package.req, r.package.atts, r.package.sigs, humanSig);
  const release = (r, humanSig = '0x') => policy.connect(executor).release(r.package.req, r.package.atts, r.package.sigs, humanSig);

  before(async () => {
    [owner, executor, auditor, operator, approver, screener, pool] = await ethers.getSigners();
    token = await (await ethers.getContractFactory('MockUSDC')).deploy();
    registry = await (await ethers.getContractFactory('AgentRegistry')).deploy(token.target, pool.address);
    await registry.setAuditor(auditor.address);

    // Register the SAME keys the agent workers sign with.
    keys = agents.loadAgentKeys({});
    await token.mint(operator.address, usdc(10_000));
    await token.connect(operator).approve(registry.target, usdc(10_000));
    const agentIds = {};
    for (let i = 0; i < ROLE_ORDER.length; i++) {
      await registry.connect(operator).register(i, keys[ROLE_ORDER[i]].address, usdc(500));
      agentIds[ROLE_ORDER[i]] = i + 1;
    }

    policy = await (await ethers.getContractFactory('CosignPolicy')).deploy(token.target, registry.target, usdc(5_000));
    await policy.setExecutor(executor.address);
    await policy.setHumanApprover(approver.address);
    await policy.setScreener(screener.address);
    await token.mint(policy.target, usdc(1_000_000));

    ledger = agents.loadDemoLedger();
    for (const v of ledger.vendors) {
      await policy.connect(screener).registerPayee(v.wallet, true); // verified vendors, long-standing wallets
      await policy.setBudget(ethers.id(v.category), usdc(100_000));
    }

    const { chainId } = await ethers.provider.getNetwork();
    domain = agents.domainFor(chainId, policy.target);
    cfg = { chainId, policyAddress: policy.target, agentIds };
  });

  it('A: the agents agree, the contract releases, and USDC arrives', async () => {
    const r = await run('A');
    expect(r.decision).to.equal('READY');
    expect(await evaluate(r)).to.deep.equal([0n, 0n]);

    const vendor = r.package.req.payee;
    const before = await token.balanceOf(vendor);
    await expect(release(r)).to.emit(policy, 'Released');
    expect(await token.balanceOf(vendor)).to.equal(before + usdc(1250));
    expect(await policy.paid(r.package.req.invoiceHash)).to.equal(true);

    agents.recordPaid(ledger, r.parsed, r.invoiceHash, 'northwind'); // Auditor/ledger now knows INV-1041 was paid
  });

  it('A again: the Sentinel catches the replay first (layer 1)', async () => {
    const r = await run('A'); // ledger now has INV-1041
    expect(r.results.SENTINEL.verdict).to.equal('FAIL');
    expect(await evaluate(r)).to.deep.equal([4n, 3n]);
  });

  it('A again: with the off-chain history lost, the on-chain paid set still rejects it (layer 2, rule 7)', async () => {
    const r = await run('A', agents.loadDemoLedger()); // agents have no memory of the payment, so they all PASS
    expect(r.decision).to.equal('READY');
    const [rule, detail] = await evaluate(r);
    expect([rule, detail]).to.deep.equal([7n, 0n]);
    await expect(release(r)).to.be.revertedWithCustomError(policy, 'RuleFailed').withArgs(7, 0);
  });

  it('B: the Sentinel signs FAIL, so the contract holds on rule 4 (detail = Sentinel index)', async () => {
    const r = await run('B');
    expect(r.decision).to.equal('HOLD');
    expect(r.results.SENTINEL.verdict).to.equal('FAIL');
    expect(await evaluate(r)).to.deep.equal([4n, 3n]);
    await expect(release(r)).to.be.revertedWithCustomError(policy, 'RuleFailed').withArgs(4, 3);
  });

  it('C: the Verifier signs ESCALATE and opens a challenge, so nothing moves', async () => {
    const r = await run('C');
    expect(r.results.VERIFIER.verdict).to.equal('ESCALATE');
    expect(await evaluate(r)).to.deep.equal([4n, 1n]);
    await expect(release(r)).to.be.reverted;

    // The Verifier's recommended action is applied on-chain: the new wallet enters a 48h cooling-off.
    await policy.connect(screener).registerPayee(r.package.req.payee, false);
    const stillHeld = await run('C');
    expect((await evaluate(stillHeld))[0]).to.equal(4n); // verdict still ESCALATE: a human must clear it
  });

  it('C: even when every agent PASSes the new wallet, the contract still enforces the cooling-off', async () => {
    // Suppose the off-chain registry was updated to the new wallet (so the Verifier passes) but the policy
    // contract's cooling-off was just started. The contract is the backstop.
    const newWallet = '0xb90d0000000000000000000000000000000077c1';
    await policy.connect(screener).registerPayee(newWallet, false); // opens the 48h window
    const updated = structuredClone(ledger);
    updated.vendors.find((v) => v.id === 'lumen').wallet = newWallet;

    const now = await time.latest();
    const r = await agents.processInvoice(
      agents.readDemoInvoice('case-c-wallet-change.txt'), updated, { ...cfg, now: () => new Date(now * 1000) }, keys,
    );
    expect(r.decision).to.equal('READY'); // all five agents say PASS
    expect(await evaluate(r)).to.deep.equal([5n, 2n]); // but rule 5: still cooling off
    await expect(release(r)).to.be.revertedWithCustomError(policy, 'RuleFailed').withArgs(5, 2);

    await time.increase(48 * 3600 + 60);
    const later = await time.latest();
    const after = await agents.processInvoice(
      agents.readDemoInvoice('case-c-wallet-change.txt'), updated, { ...cfg, now: () => new Date(later * 1000) }, keys,
    );
    expect(await evaluate(after)).to.deep.equal([0n, 0n]); // cooling-off over, fresh attestations
  });

  it('D: injected instructions never reach the contract as a payment', async () => {
    const r = await run('D');
    expect(r.decision).to.equal('HOLD');
    expect(r.package.req.payee.toLowerCase()).to.not.equal('0xdead00000000000000000000000000000000beef');
    expect(await evaluate(r)).to.deep.equal([4n, 1n]);
    await expect(release(r)).to.be.revertedWithCustomError(policy, 'RuleFailed');
  });

  it('E: all agents PASS but the amount is over the limit, so the contract needs a human signature', async () => {
    const r = await run('E');
    expect(r.decision).to.equal('NEEDS_HUMAN');
    expect(await evaluate(r)).to.deep.equal([6n, 0n]);

    const exp = (await time.latest()) + 3600;
    const sig = await approver.signTypedData(
      domain,
      { HumanApproval: [
        { name: 'invoiceHash', type: 'bytes32' }, { name: 'payee', type: 'address' },
        { name: 'amount', type: 'uint256' }, { name: 'destinationDomain', type: 'uint32' }, { name: 'expiry', type: 'uint64' },
      ] },
      { invoiceHash: r.package.req.invoiceHash, payee: r.package.req.payee, amount: r.package.req.amount, destinationDomain: r.package.req.destinationDomain, expiry: exp },
    );
    const humanSig = ethers.concat([ethers.toBeHex(exp, 8), sig]);
    expect(await evaluate(r, humanSig)).to.deep.equal([0n, 0n]);

    const before = await token.balanceOf(r.package.req.payee);
    await expect(release(r, humanSig)).to.emit(policy, 'Released').withArgs(r.package.req.invoiceHash, ethers.getAddress(r.package.req.payee), usdc(9800), anyValue, true, 26);
    expect(await token.balanceOf(r.package.req.payee)).to.equal(before + usdc(9800));
  });

  it('tampering after signing is caught: redirecting the payee breaks the quorum', async () => {
    const fresh = await distinctInvoice('INV-7001', 11, '2026-11-20', '2026-11-27');
    expect(fresh.decision).to.equal('READY');
    expect(await evaluate(fresh)).to.deep.equal([0n, 0n]);

    const attacker = ethers.Wallet.createRandom().address;
    const tampered = { ...fresh.package.req, payee: attacker };
    const [rule] = await policy.evaluate(tampered, fresh.package.atts, fresh.package.sigs, '0x');
    expect(rule).to.equal(3n);
  });

  it('a slashed agent stops counting: the same honest package is then held on rule 2', async () => {
    const fresh = await distinctInvoice('INV-7002', 9, '2026-12-04', '2026-12-11');
    expect(await evaluate(fresh)).to.deep.equal([0n, 0n]);

    await registry.connect(auditor).recordOutcome(4, -30, usdc(450)); // Sentinel proven wrong: score and bond collapse
    expect(await evaluate(fresh)).to.deep.equal([2n, 3n]);
  });
});
