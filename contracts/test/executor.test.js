/**
 * The Executor against the real contract: agents sign, the Executor submits, the contract is the gate.
 * Covers idempotency, crash recovery, stuck transactions, receipts and the HTTP API.
 */
require('tsx/cjs/api').register();

const fs = require('node:fs');
const path = require('node:path');
const { time } = require('@nomicfoundation/hardhat-toolbox/network-helpers');
const { expect } = require('chai');
const hre = require('hardhat');
const { ethers } = hre;
const agents = require('../../agents/src');
const ex = require('../../executor/src');

const usdc = (n) => ethers.parseUnits(String(n), 6);
const { ROLE_ORDER } = agents;

describe('Executor (against the real contract)', function () {
  this.timeout(120_000);

  let owner, executorSigner, auditor, operator, approver, screener, pool, stranger;
  let token, registry, policy, keys, ledger, cfg, executor, store, registryRead;

  /** Run the agents on a demo case, with attestation times taken from the chain. */
  const run = async (id, over = {}) => {
    const now = await time.latest();
    return agents.processInvoice(
      agents.readDemoInvoice(agents.DEMO_CASES.find((c) => c.id === id).file),
      over.ledger ?? ledger, { ...cfg, ...over, now: () => new Date(now * 1000) }, keys,
    );
  };

  /** A clean Northwind invoice that is clearly not a duplicate of anything else in these tests. */
  const distinct = async (number, hours, issued, due, over = {}) => {
    const text = agents.readDemoInvoice('case-a-clean.txt')
      .replace('INV-1041', number)
      .replace('Issued: 2026-10-13', `Issued: ${issued}`)
      .replace('Due: 2026-10-20', `Due: ${due}`)
      .replace('Design hours - October sprint | 10 | 125.00 | 1250.00', `Design hours - ${number} work | ${hours} | 125.00 | ${hours * 125}.00`)
      .replace('Total: 1250.00', `Total: ${hours * 125}.00`);
    const now = await time.latest();
    return agents.processInvoice(text, ledger, { ...cfg, ...over, now: () => new Date(now * 1000) }, keys);
  };

  const makeExecutor = (opts = {}) =>
    new ex.Executor({
      policy: new ethers.Contract(policy.target, ex.POLICY_ABI, opts.signer ?? executorSigner),
      store: opts.store ?? new ex.MemoryStore(),
      receiptTimeoutMs: 5_000,
      ...opts,
    });

  const txCount = () => ethers.provider.getTransactionCount(executorSigner.address);

  before(async () => {
    [owner, executorSigner, auditor, operator, approver, screener, pool, stranger] = await ethers.getSigners();
    token = await (await ethers.getContractFactory('MockUSDC')).deploy();
    registry = await (await ethers.getContractFactory('AgentRegistry')).deploy(token.target, pool.address);
    await registry.setAuditor(auditor.address);

    keys = agents.loadAgentKeys({});
    await token.mint(operator.address, usdc(10_000));
    await token.connect(operator).approve(registry.target, usdc(10_000));
    const agentIds = {};
    for (let i = 0; i < ROLE_ORDER.length; i++) {
      await registry.connect(operator).register(i, keys[ROLE_ORDER[i]].address, usdc(500));
      agentIds[ROLE_ORDER[i]] = i + 1;
    }

    policy = await (await ethers.getContractFactory('CosignPolicy')).deploy(token.target, registry.target, usdc(5_000));
    await policy.setExecutor(executorSigner.address);
    await policy.setHumanApprover(approver.address);
    await policy.setScreener(screener.address);
    await token.mint(policy.target, usdc(1_000_000));

    ledger = agents.loadDemoLedger();
    for (const v of ledger.vendors) {
      await policy.connect(screener).registerPayee(v.wallet, true);
      await policy.setBudget(ethers.id(v.category), usdc(100_000));
    }

    const { chainId } = await ethers.provider.getNetwork();
    cfg = { chainId, policyAddress: policy.target, agentIds };
    store = new ex.MemoryStore();
    executor = makeExecutor({ store });
    registryRead = new ethers.Contract(registry.target, ex.REGISTRY_ABI, ethers.provider);
  });

  it('the Executor ABI matches the compiled contract', () => {
    const artifact = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'artifacts/contracts/CosignPolicy.sol/CosignPolicy.json'), 'utf8'));
    const real = new ethers.Interface(artifact.abi);
    const mine = new ethers.Interface(ex.POLICY_ABI);
    for (const f of ['release', 'evaluate', 'paid', 'POLICY_VERSION']) expect(mine.getFunction(f).selector, f).to.equal(real.getFunction(f).selector);
    expect(mine.getError('RuleFailed').selector).to.equal(real.getError('RuleFailed').selector);
    expect(mine.getError('NotExecutor').selector).to.equal(real.getError('NotExecutor').selector);
    expect(mine.getEvent('Released').topicHash).to.equal(real.getEvent('Released').topicHash);
  });

  describe('happy path and receipts', () => {
    let released;

    it('A: sends the payment and writes a receipt', async () => {
      const a = await run('A');
      const before = await token.balanceOf(a.package.req.payee);
      released = await executor.release(a.package);

      expect(released.status).to.equal('RELEASED');
      expect(await token.balanceOf(a.package.req.payee)).to.equal(before + usdc(1250));
      expect(released.receipt.policyVersion).to.equal('policy-v0.1.0');
      expect(released.receipt.attestations).to.have.length(5);
      expect((await store.getRecord(a.invoiceHash)).state).to.equal('CONFIRMED');
      agents.recordPaid(ledger, a.parsed, a.invoiceHash, 'northwind');
    });

    it('the receipt replays from scratch, including the registry check', async () => {
      const out = await ex.replayReceipt(released.receipt, { registry: registryRead });
      expect(out.checks.filter((c) => !c.ok)).to.deep.equal([]);
      expect(out.ok).to.equal(true);
    });

    it('a tampered receipt fails replay', async () => {
      const mutate = (f) => { const r = structuredClone(released.receipt); f(r); return r; };
      const bad = [
        ['amount', mutate((r) => { r.amount = '9999000000'; })],
        ['a verdict flipped', mutate((r) => { r.attestations[3].attestation.verdict = 2; })],
        ['the receipt hash', mutate((r) => { r.onChainReceiptHash = ethers.id('forged'); })],
        ['attestation order', mutate((r) => { r.attestations.reverse(); })],
        ['the payee', mutate((r) => { r.payee = stranger.address; })],
        ['a missing attestation', mutate((r) => { r.attestations.pop(); })],
      ];
      for (const [name, r] of bad) expect((await ex.replayReceipt(r)).ok, name).to.equal(false);
    });

    it('replay with the wrong registry mapping fails the signer check', async () => {
      const r = structuredClone(released.receipt);
      r.attestations[0].attestation.agentId = 2; // claims the Verifier's agent id signed the Reader attestation
      const out = await ex.replayReceipt(r, { registry: registryRead });
      expect(out.ok).to.equal(false);
    });
  });

  describe('idempotency', () => {
    it('submitting a released package again returns ALREADY_RELEASED and sends nothing', async () => {
      const p = await distinct('INV-8001', 12, '2026-11-02', '2026-11-09');
      const first = await executor.release(p.package);
      const txs = await txCount();
      const balance = await token.balanceOf(p.package.req.payee);

      const again = await executor.release(p.package);
      expect(again.status).to.equal('ALREADY_RELEASED');
      expect(again.txHash).to.equal(first.txHash);
      expect(again.receipt.onChainReceiptHash).to.equal(first.receipt.onChainReceiptHash);
      expect(await txCount()).to.equal(txs);
      expect(await token.balanceOf(p.package.req.payee)).to.equal(balance);
    });

    it('two concurrent submissions send exactly one payment', async () => {
      const p = await distinct('INV-8002', 8, '2026-11-03', '2026-11-10');
      const txs = await txCount();
      const balance = await token.balanceOf(p.package.req.payee);

      const [a, b] = await Promise.all([executor.release(p.package), executor.release(p.package)]);
      expect([a.status, b.status].sort()).to.deep.equal(['ALREADY_RELEASED', 'RELEASED']);
      expect(await token.balanceOf(p.package.req.payee)).to.equal(balance + usdc(1000));
      expect(await txCount()).to.equal(txs + 1);
    });

    it('a fresh Executor with an empty store still cannot pay twice: the contract is the backstop', async () => {
      const p = await distinct('INV-8003', 7, '2026-11-04', '2026-11-11');
      await executor.release(p.package);
      const txs = await txCount();

      const amnesiac = makeExecutor({ store: new ex.MemoryStore() });
      const out = await amnesiac.release(p.package);
      expect(out.status).to.equal('ALREADY_RELEASED');
      expect(out.receipt, 'rebuilt from chain only if the package provably matches').to.not.equal(null);
      expect((await ex.replayReceipt(out.receipt)).ok).to.equal(true);
      expect(await txCount()).to.equal(txs);
    });

    it('an amnesiac Executor given DIFFERENT attestations for a paid invoice reports it paid but invents no receipt', async () => {
      const p = await distinct('INV-8004', 6, '2026-11-05', '2026-11-12');
      await executor.release(p.package);

      const other = { ...p.package, atts: p.package.atts.map((a) => ({ ...a, nonce: a.nonce + 1000n })) }; // re-signed elsewhere
      const out = await makeExecutor({ store: new ex.MemoryStore() }).release(other);
      expect(out.status).to.equal('ALREADY_RELEASED');
      expect(out.receipt).to.equal(null);
    });
  });

  describe('crash recovery', () => {
    it('crashed after the transaction landed but before the record was updated: finds it on-chain, pays nothing twice', async () => {
      const p = await distinct('INV-8101', 5, '2026-11-06', '2026-11-13');
      const s = new ex.MemoryStore();
      await s.putRecord({ invoiceHash: p.invoiceHash, state: 'SENDING', attempts: 1, package: ex.toJson(p.package), updatedAt: 'then' });
      // The transaction the crashed process had sent:
      await policy.connect(executorSigner).release(p.package.req, p.package.atts, p.package.sigs, '0x');
      const txs = await txCount();

      const out = await makeExecutor({ store: s }).release(p.package);
      expect(out.status).to.equal('ALREADY_RELEASED');
      expect(out.receipt).to.not.equal(null);
      expect((await s.getRecord(p.invoiceHash)).state).to.equal('CONFIRMED');
      expect(await txCount()).to.equal(txs);
    });

    it('crashed before sending anything: retries and pays exactly once', async () => {
      const p = await distinct('INV-8102', 4, '2026-11-07', '2026-11-14');
      const s = new ex.MemoryStore();
      await s.putRecord({ invoiceHash: p.invoiceHash, state: 'SENDING', attempts: 1, package: ex.toJson(p.package), updatedAt: 'then' });
      const balance = await token.balanceOf(p.package.req.payee);

      const out = await makeExecutor({ store: s }).release(p.package);
      expect(out.status).to.equal('RELEASED');
      expect(await token.balanceOf(p.package.req.payee)).to.equal(balance + usdc(500));
    });

    it('a transaction stuck in the mempool stays PENDING, is never re-sent, and settles on reconcile', async () => {
      const p = await distinct('INV-8103', 3, '2026-11-08', '2026-11-15');
      const balance = await token.balanceOf(p.package.req.payee);
      const s = new ex.MemoryStore();
      const slow = makeExecutor({ store: s, receiptTimeoutMs: 300 });

      await hre.network.provider.send('evm_setAutomine', [false]);
      try {
        const sent = await slow.release(p.package);
        expect(sent.status).to.equal('PENDING');
        const txs = await txCount(); // counts mined only
        const second = await slow.release(p.package);
        expect(second.status).to.equal('PENDING');
        expect(second.txHash).to.equal(sent.txHash);
        await hre.network.provider.send('evm_mine');
        expect(await txCount()).to.equal(txs + 1); // exactly one tx was ever sent
      } finally {
        await hre.network.provider.send('evm_setAutomine', [true]);
      }

      const settled = await slow.reconcile(p.invoiceHash);
      expect(settled.status).to.equal('RELEASED');
      expect(settled.receipt).to.not.equal(null);
      expect(await token.balanceOf(p.package.req.payee)).to.equal(balance + usdc(375));
    });
  });

  describe('the Executor holds whatever the contract holds', () => {
    const assertNoTxSent = async (fn) => { const n = await txCount(); const out = await fn(); expect(await txCount(), 'no transaction').to.equal(n); return out; };

    it('B: near-duplicate is HELD on rule 4 with a readable reason, and nothing is sent', async () => {
      const b = await run('B');
      const out = await assertNoTxSent(() => executor.release(b.package));
      expect(out).to.include({ status: 'HELD', rule: 4, detail: 3 });
      expect(out.reason).to.match(/Sentinel did not sign PASS/);
      expect((await store.getRecord(b.invoiceHash)).state).to.equal('HELD');
    });

    it('C and D are HELD too', async () => {
      for (const [id, detail] of [['C', 1], ['D', 1]]) {
        const r = await run(id);
        const out = await assertNoTxSent(() => executor.release(r.package));
        expect(out).to.include({ status: 'HELD', rule: 4, detail });
      }
    });

    it('does not trust the pipeline: a forged "all PASS" decision cannot move money', async () => {
      const b = await run('B');
      const forged = { ...b, decision: 'READY', reasons: [] }; // what a compromised caller might claim
      expect(forged.decision).to.equal('READY');
      const out = await assertNoTxSent(() => executor.release(forged.package));
      expect(out.status).to.equal('HELD');
    });

    it('a flipped verdict breaks the signature, so the Executor holds on rule 2', async () => {
      const b = await run('B');
      const atts = b.package.atts.map((a, i) => (i === 3 ? { ...a, verdict: 1 } : a)); // Sentinel FAIL -> PASS after signing
      const out = await assertNoTxSent(() => executor.release({ ...b.package, atts }));
      expect(out).to.include({ status: 'HELD', rule: 2, detail: 3 });
    });

    it('a redirected payee is HELD on rule 3', async () => {
      const a = await distinct('INV-8201', 2, '2026-11-09', '2026-11-16');
      const out = await assertNoTxSent(() => executor.release({ ...a.package, req: { ...a.package.req, payee: stranger.address } }));
      expect(out).to.include({ status: 'HELD', rule: 3 });
    });

    it('attestations that would expire within two minutes are HELD (rule 8) before sending', async () => {
      const a = await distinct('INV-8202', 2, '2026-11-10', '2026-11-17', { ttlSeconds: 60 });
      const out = await assertNoTxSent(() => executor.release(a.package));
      expect(out).to.include({ status: 'HELD', rule: 8 });
      expect(out.reason).to.match(/expired/);
    });

    it('E: over the limit is HELD for a human; with the approver\'s signature it is released and replays', async () => {
      const e = await run('E');
      const held = await assertNoTxSent(() => executor.release(e.package));
      expect(held).to.include({ status: 'HELD', rule: 6, detail: 0 });

      const expiry = (await time.latest()) + 3600;
      const td = ex.humanApprovalTypedData({ chainId: cfg.chainId, policyAddress: policy.target, invoiceHash: e.package.req.invoiceHash, payee: e.package.req.payee, amount: e.package.req.amount, expiry });
      const humanSig = ex.packHumanSig(expiry, await approver.signTypedData(td.domain, td.types, td.value));

      const out = await executor.release({ ...e.package, humanSig });
      expect(out.status).to.equal('RELEASED');
      expect(out.receipt.humanSigned).to.equal(true);
      const replay = await ex.replayReceipt(out.receipt, { registry: registryRead, approver: approver.address });
      expect(replay.checks.filter((c) => !c.ok)).to.deep.equal([]);

      // And a receipt claiming a human signature that was swapped for a stranger's does not replay.
      const forgedExpiry = (await time.latest()) + 3600;
      const ftd = ex.humanApprovalTypedData({ chainId: cfg.chainId, policyAddress: policy.target, invoiceHash: e.package.req.invoiceHash, payee: e.package.req.payee, amount: e.package.req.amount, expiry: forgedExpiry });
      const forged = structuredClone(out.receipt);
      forged.humanSig = ex.packHumanSig(forgedExpiry, await stranger.signTypedData(ftd.domain, ftd.types, ftd.value));
      expect((await ex.replayReceipt(forged, { approver: approver.address })).ok).to.equal(false);
    });

    it('rejects malformed input before touching the chain', async () => {
      const a = await run('A');
      await assertNoTxSent(async () => {
        let threw = false;
        try { await executor.release({ ...a.package, sigs: a.package.sigs.slice(0, 4) }); } catch { threw = true; }
        expect(threw).to.equal(true);
      });
    });

    it('an Executor that is not the contract\'s executor key cannot release, and records the failure', async () => {
      const p = await distinct('INV-8301', 2, '2026-11-11', '2026-11-18');
      const s = new ex.MemoryStore();
      const impostor = makeExecutor({ store: s, signer: stranger });
      let msg = '';
      try { await impostor.release(p.package); } catch (e) { msg = String(e.message ?? e); }
      expect(msg).to.not.equal('');
      expect((await s.getRecord(p.invoiceHash)).state).to.equal('REVERTED');
      expect(await policy.paid(p.invoiceHash)).to.equal(false);
    });
  });

  describe('HTTP API', () => {
    it('releases over HTTP, is idempotent, and serves a replayable receipt', async () => {
      const token = 'an-adequately-long-test-token';
      const server = ex.createExecutorServer({ executor: makeExecutor(), apiToken: token });
      await new Promise((r) => server.listen(0, '127.0.0.1', r));
      const base = `http://127.0.0.1:${server.address().port}`;
      const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
      try {
        const p = await distinct('INV-8401', 10, '2026-11-12', '2026-11-19');
        const body = JSON.stringify(ex.toJson(p.package));

        const first = await (await fetch(`${base}/release`, { method: 'POST', headers, body })).json();
        expect(first.status).to.equal('RELEASED');
        const second = await (await fetch(`${base}/release`, { method: 'POST', headers, body })).json();
        expect(second.status).to.equal('ALREADY_RELEASED');

        const receipt = await (await fetch(`${base}/receipts/${p.invoiceHash}`, { headers })).json();
        expect((await ex.replayReceipt(receipt, { registry: registryRead })).ok).to.equal(true);

        const bad = await fetch(`${base}/release`, { method: 'POST', headers, body: JSON.stringify({ ...ex.toJson(p.package), sigs: [] }) });
        expect(bad.status).to.equal(400);
        expect((await fetch(`${base}/release`, { method: 'POST', body })).status).to.equal(401);
      } finally {
        await new Promise((r) => server.close(r));
      }
    });
  });
});
