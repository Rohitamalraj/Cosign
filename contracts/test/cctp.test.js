const { expect } = require('chai');
const { ethers } = require('hardhat');
const { loadFixture } = require('@nomicfoundation/hardhat-toolbox/network-helpers');
const { deployAll, usdc } = require('./fixture');

const BASE = 6; // Base Sepolia CCTP domain
const ETH = 0;

async function setup() {
  const f = await deployAll();
  const messenger = await (await ethers.getContractFactory('MockTokenMessenger')).deploy();
  await f.policy.setTokenMessenger(messenger.target);
  await f.policy.connect(f.screener).registerRemotePayee(BASE, f.payee.address, true);
  return { ...f, messenger };
}

describe('CCTP cross-chain release (policy v0.2)', () => {
  it('burns through the TokenMessenger for a destination other than Arc, and moves no USDC to the payee on Arc', async () => {
    const { policy, token, messenger, payee, build, release } = await loadFixture(setup);
    const p = await build({ destinationDomain: BASE, amount: usdc(1_250) });
    const before = await token.balanceOf(payee.address);
    await expect(release(p)).to.emit(policy, 'Released').withArgs(p.req.invoiceHash, payee.address, usdc(1_250), (h) => h !== ethers.ZeroHash, false, BASE);
    expect(await messenger.burnCount()).to.equal(1n);
    const b = await messenger.burns(0);
    expect(b.amount).to.equal(usdc(1_250));
    expect(b.destinationDomain).to.equal(BASE);
    expect(b.mintRecipient).to.equal(ethers.zeroPadValue(payee.address, 32)); // recipient is the signed payee, left-padded
    expect(b.burnToken).to.equal(token.target);
    expect(b.destinationCaller).to.equal(ethers.ZeroHash); // anyone can relay the mint
    expect(b.maxFee).to.equal(0n);
    expect(b.minFinalityThreshold).to.equal(2000n); // Standard: the only mode Arc offers as a source
    expect(await token.balanceOf(payee.address)).to.equal(before); // nothing arrived on Arc
    expect(await policy.paid(p.req.invoiceHash)).to.equal(true);
  });

  it('a payee allowlisted on Arc is NOT allowed on another chain (rule 5)', async () => {
    const { evaluate, build } = await loadFixture(setup);
    const p = await build({ destinationDomain: ETH });
    expect(await evaluate(p)).to.deep.equal([5n, 0n]);
  });

  it('a payee allowlisted only on Base is not allowed on Arc', async () => {
    const { policy, screener, evaluate, build } = await loadFixture(setup);
    const only = ethers.Wallet.createRandom().address;
    await policy.connect(screener).registerRemotePayee(BASE, only, true);
    const p = await build({ payee: only, destinationDomain: 26 });
    expect(await evaluate(p)).to.deep.equal([5n, 0n]);
  });

  it('a remote payee honours the cooling-off period', async () => {
    const { policy, screener, evaluate, build } = await loadFixture(setup);
    const fresh = ethers.Wallet.createRandom().address;
    await policy.connect(screener).registerRemotePayee(BASE, fresh, false);
    const p = await build({ payee: fresh, destinationDomain: BASE });
    expect(await evaluate(p)).to.deep.equal([5n, 2n]);
  });

  it('a sanctions block on the address stops it on every chain', async () => {
    const { policy, screener, evaluate, build, payee } = await loadFixture(setup);
    await policy.connect(screener).challengePayee(payee.address);
    const p = await build({ destinationDomain: BASE });
    expect(await evaluate(p)).to.deep.equal([5n, 1n]);
  });

  it('no cross-chain route configured means nothing can be sent off Arc', async () => {
    const { policy, evaluate, build } = await loadFixture(setup);
    await policy.setTokenMessenger(ethers.ZeroAddress);
    const p = await build({ destinationDomain: BASE });
    expect(await evaluate(p)).to.deep.equal([5n, 3n]);
  });

  it('the destination is signed: changing it after signing breaks the quorum (rule 3)', async () => {
    const { evaluate, build, policy, screener, payee } = await loadFixture(setup);
    await policy.connect(screener).registerRemotePayee(ETH, payee.address, true);
    const p = await build({ destinationDomain: BASE });
    p.req.destinationDomain = ETH; // a hostile relayer tries to redirect the money to another chain
    expect(await evaluate(p)).to.deep.equal([3n, 0n]);
  });

  it('an agent that signed a different destination is caught', async () => {
    const { evaluate, build } = await loadFixture(setup);
    // The Sentinel (index 3) signs Arc while the others sign Base.
    const p = await build({ destinationDomain: BASE, edit: (a, i) => { if (i === 3) a.destinationDomain = 26; } });
    expect(await evaluate(p)).to.deep.equal([3n, 3n]);
  });

  it('a human approval for Arc cannot be reused for the same amount on another chain', async () => {
    const { evaluate, build, humanApproval } = await loadFixture(setup);
    const arc = await build({ amount: usdc(9_000), destinationDomain: 26 });
    const approval = await humanApproval(arc.req);
    const remote = await build({ amount: usdc(9_000), destinationDomain: BASE, payee: arc.req.payee });
    remote.humanSig = approval; // wrong destination inside the signed payload
    const [rule, detail] = await evaluate(remote);
    expect([rule, detail]).to.deep.equal([6n, 1n]);
  });

  it('over the limit, a human approval for the right chain releases cross-chain', async () => {
    const { release, build, humanApproval, messenger } = await loadFixture(setup);
    const p = await build({ amount: usdc(9_000), destinationDomain: BASE });
    p.humanSig = await humanApproval(p.req);
    await release(p);
    expect(await messenger.burnCount()).to.equal(1n);
  });

  it('if the messenger reverts (for example a fee is required), the release reverts and nothing is marked paid', async () => {
    const { policy, messenger, build, release, token } = await loadFixture(setup);
    await messenger.setFailNext(true);
    const p = await build({ destinationDomain: BASE });
    const bal = await token.balanceOf(policy.target);
    await expect(release(p)).to.be.reverted;
    expect(await policy.paid(p.req.invoiceHash)).to.equal(false);
    expect(await token.balanceOf(policy.target)).to.equal(bal);
    await messenger.setFailNext(false);
    await release(p); // and it can be retried
    expect(await policy.paid(p.req.invoiceHash)).to.equal(true);
  });

  it('a cross-chain invoice cannot be paid twice, on any chain', async () => {
    const { policy, screener, payee, build, release, evaluate } = await loadFixture(setup);
    await policy.connect(screener).registerRemotePayee(ETH, payee.address, true);
    const first = await build({ destinationDomain: BASE });
    await release(first);
    const again = await build({ destinationDomain: ETH, invoiceHash: first.req.invoiceHash });
    expect(await evaluate(again)).to.deep.equal([7n, 0n]);
  });

  it('cannot register a remote payee for Arc itself', async () => {
    const { policy, screener, payee } = await loadFixture(setup);
    await expect(policy.connect(screener).registerRemotePayee(26, payee.address, true)).to.be.revertedWithCustomError(policy, 'RuleFailed');
  });

  it('only the screener can register remote payees', async () => {
    const { policy, stranger, payee } = await loadFixture(setup);
    await expect(policy.connect(stranger).registerRemotePayee(BASE, payee.address, true)).to.be.revertedWithCustomError(policy, 'NotScreener');
  });
});
