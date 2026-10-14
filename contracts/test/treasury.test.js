const { expect } = require('chai');
const { ethers } = require('hardhat');
const { time, loadFixture } = require('@nomicfoundation/hardhat-toolbox/network-helpers');
const { deployAll, usdc } = require('./fixture');

const ACTION = { INVEST: 0, REDEEM: 1 };
const ORDER_TYPES = {
  TreasuryOrder: [
    { name: 'action', type: 'uint8' },
    { name: 'amount', type: 'uint256' },
    { name: 'agentId', type: 'uint256' },
    { name: 'expiry', type: 'uint64' },
    { name: 'nonce', type: 'uint256' },
  ],
};
const TREASURER = 4; // wallets[4] / agentIds[4]

async function setup() {
  const f = await deployAll();
  const { token, registry, owner, executor, policy } = f;
  const usycToken = await (await ethers.getContractFactory('MockUsyc')).deploy();
  const teller = await (await ethers.getContractFactory('MockUsycTeller')).deploy(token.target, usycToken.target);
  await usycToken.setTeller(teller.target);
  const treasury = await (await ethers.getContractFactory('CosignTreasury')).deploy(token.target, usycToken.target, teller.target, registry.target);
  await treasury.setOperator(executor.address);
  await treasury.setPayoutPolicy(policy.target);
  await treasury.setLimits(7_000, usdc(300)); // at most 70% invested, 300 USDC always liquid
  await token.mint(owner.address, usdc(1_000));
  await token.approve(treasury.target, usdc(1_000));
  await treasury.deposit(usdc(1_000));
  await token.mint(teller.target, usdc(10_000)); // liquidity so the mock can pay yield

  const { chainId } = await ethers.provider.getNetwork();
  const domain = { name: 'CosignTreasury', version: '1', chainId, verifyingContract: treasury.target };
  let n = 0;
  async function order(action, amount, opts = {}) {
    n += 1;
    const o = {
      action,
      amount,
      agentId: opts.agentId ?? f.agentIds[TREASURER],
      expiry: (await time.latest()) + (opts.expiryOffset ?? 3_600),
      nonce: opts.nonce ?? 9_000 + n,
    };
    const key = opts.signer ?? f.wallets[TREASURER];
    return { o, sig: await key.signTypedData(domain, ORDER_TYPES, o) };
  }
  return { ...f, usycToken, teller, treasury, order };
}

describe('CosignTreasury (USYC reserve)', () => {
  it('invests within the cap and redeems into the policy contract, never elsewhere', async () => {
    const { executor, token, usycToken, treasury, policy, order } = await loadFixture(setup);
    const inv = await order(ACTION.INVEST, usdc(400));
    await expect(treasury.connect(executor).invest(inv.o, inv.sig)).to.emit(treasury, 'Invested');
    expect(await usycToken.balanceOf(treasury.target)).to.equal(usdc(400));
    expect(await treasury.investedPrincipal()).to.equal(usdc(400));
    expect(await token.balanceOf(treasury.target)).to.equal(usdc(600));

    const before = await token.balanceOf(policy.target);
    const red = await order(ACTION.REDEEM, usdc(150));
    await treasury.connect(executor).redeem(red.o, red.sig);
    expect((await token.balanceOf(policy.target)) - before).to.equal(usdc(150));
    expect(await treasury.investedPrincipal()).to.equal(usdc(250));
    expect(await usycToken.balanceOf(treasury.target)).to.equal(usdc(250));
  });

  it('sends the yield to the policy and clears principal when redeeming at a higher price', async () => {
    const { executor, token, teller, treasury, policy, order } = await loadFixture(setup);
    const inv = await order(ACTION.INVEST, usdc(500));
    await treasury.connect(executor).invest(inv.o, inv.sig);
    await teller.setPrice(1_050_000); // +5%
    const before = await token.balanceOf(policy.target);
    const red = await order(ACTION.REDEEM, usdc(500));
    await treasury.connect(executor).redeem(red.o, red.sig);
    expect((await token.balanceOf(policy.target)) - before).to.equal(usdc(525));
    expect(await treasury.investedPrincipal()).to.equal(0n);
  });

  it('rejects an invest above the cap', async () => {
    const { executor, treasury, order } = await loadFixture(setup);
    const inv = await order(ACTION.INVEST, usdc(701)); // cap is 70% of 1000
    await expect(treasury.connect(executor).invest(inv.o, inv.sig)).to.be.revertedWithCustomError(treasury, 'ExceedsInvestCap');
  });

  it('keeps the operating floor liquid', async () => {
    const { executor, treasury, order } = await loadFixture(setup);
    await treasury.setLimits(10_000, usdc(300)); // cap off; floor on
    const inv = await order(ACTION.INVEST, usdc(701));
    await expect(treasury.connect(executor).invest(inv.o, inv.sig)).to.be.revertedWithCustomError(treasury, 'BelowOperatingFloor');
    const ok = await order(ACTION.INVEST, usdc(700));
    await expect(treasury.connect(executor).invest(ok.o, ok.sig)).to.emit(treasury, 'Invested');
  });

  it('only the operator can submit orders', async () => {
    const { stranger, treasury, order } = await loadFixture(setup);
    const inv = await order(ACTION.INVEST, usdc(100));
    await expect(treasury.connect(stranger).invest(inv.o, inv.sig)).to.be.revertedWithCustomError(treasury, 'NotOperator');
  });

  it('rejects an order not signed by the Treasurer agent key', async () => {
    const { executor, treasury, order } = await loadFixture(setup);
    const inv = await order(ACTION.INVEST, usdc(100), { signer: ethers.Wallet.createRandom() });
    await expect(treasury.connect(executor).invest(inv.o, inv.sig)).to.be.revertedWithCustomError(treasury, 'BadSignature');
  });

  it('rejects an order signed by a different role, even with a valid signature', async () => {
    const { executor, treasury, order, wallets, agentIds } = await loadFixture(setup);
    // The Reader (role 0) signs with its own registered key, but only the Treasurer role may place orders.
    const inv = await order(ACTION.INVEST, usdc(100), { agentId: agentIds[0], signer: wallets[0] });
    await expect(treasury.connect(executor).invest(inv.o, inv.sig)).to.be.revertedWithCustomError(treasury, 'NotTreasurer');
  });

  it('rejects an expired order and a replayed nonce', async () => {
    const { executor, treasury, order } = await loadFixture(setup);
    const stale = await order(ACTION.INVEST, usdc(100), { expiryOffset: 60 });
    await time.increase(120);
    await expect(treasury.connect(executor).invest(stale.o, stale.sig)).to.be.revertedWithCustomError(treasury, 'Expired');

    const a = await order(ACTION.INVEST, usdc(100), { nonce: 77 });
    await treasury.connect(executor).invest(a.o, a.sig);
    const b = await order(ACTION.INVEST, usdc(100), { nonce: 77 });
    await expect(treasury.connect(executor).invest(b.o, b.sig)).to.be.revertedWithCustomError(treasury, 'NonceReused');
  });

  it('an invest order cannot be replayed as a redeem', async () => {
    const { executor, treasury, order } = await loadFixture(setup);
    const inv = await order(ACTION.INVEST, usdc(100));
    await treasury.connect(executor).invest(inv.o, inv.sig);
    await expect(treasury.connect(executor).redeem(inv.o, inv.sig)).to.be.revertedWithCustomError(treasury, 'BadSignature');
  });

  it('a tampered amount invalidates the signature', async () => {
    const { executor, treasury, order } = await loadFixture(setup);
    const inv = await order(ACTION.INVEST, usdc(100));
    await expect(treasury.connect(executor).invest({ ...inv.o, amount: usdc(600) }, inv.sig)).to.be.revertedWithCustomError(treasury, 'BadSignature');
  });

  it('refuses to place orders once the Treasurer agent is below the reputation threshold', async () => {
    const { executor, auditor, registry, treasury, order, agentIds } = await loadFixture(setup);
    await registry.connect(auditor).recordOutcome(agentIds[TREASURER], -30, 0); // 50 - 30 = 20 < minScore 40
    const inv = await order(ACTION.INVEST, usdc(100));
    await expect(treasury.connect(executor).invest(inv.o, inv.sig)).to.be.revertedWithCustomError(treasury, 'NotTreasurer');
  });

  it('the owner can recover idle USDC but not USYC', async () => {
    const { owner, stranger, token, treasury } = await loadFixture(setup);
    await treasury.withdrawUsdc(owner.address, usdc(10));
    expect(await token.balanceOf(owner.address)).to.equal(usdc(10));
    await expect(treasury.connect(stranger).withdrawUsdc(stranger.address, usdc(1))).to.be.revertedWithCustomError(treasury, 'OwnableUnauthorizedAccount');
    expect(treasury.interface.getFunction('withdrawUsyc')).to.equal(null);
  });
});
