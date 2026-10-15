const { time } = require('@nomicfoundation/hardhat-toolbox/network-helpers');
const { ethers } = require('hardhat');

const ROLES = { READER: 0, VERIFIER: 1, MATCHER: 2, SENTINEL: 3, TREASURER: 4 };
const ROLE_NAMES = Object.keys(ROLES);
const VERDICT = { NONE: 0, PASS: 1, FAIL: 2, ESCALATE: 3 };
const usdc = (n) => ethers.parseUnits(String(n), 6);
const CATEGORY = ethers.id('design');

const ATTESTATION_TYPES = {
  Attestation: [
    { name: 'invoiceHash', type: 'bytes32' },
    { name: 'payee', type: 'address' },
    { name: 'amount', type: 'uint256' },
    { name: 'role', type: 'uint8' },
    { name: 'verdict', type: 'uint8' },
    { name: 'confidenceBps', type: 'uint16' },
    { name: 'evidenceHash', type: 'bytes32' },
    { name: 'agentId', type: 'uint256' },
    { name: 'expiry', type: 'uint64' },
    { name: 'nonce', type: 'uint256' },
    { name: 'destinationDomain', type: 'uint32' },
  ],
};
const HUMAN_TYPES = {
  HumanApproval: [
    { name: 'invoiceHash', type: 'bytes32' },
    { name: 'payee', type: 'address' },
    { name: 'amount', type: 'uint256' },
    { name: 'destinationDomain', type: 'uint32' },
    { name: 'expiry', type: 'uint64' },
  ],
};

async function deployAll() {
  const [owner, executor, auditor, operator, approver, screener, pool, payee, stranger] = await ethers.getSigners();

  const token = await (await ethers.getContractFactory('MockUSDC')).deploy();
  const registry = await (await ethers.getContractFactory('AgentRegistry')).deploy(token.target, pool.address);
  await registry.setAuditor(auditor.address);

  // One signing key per role; the operator posts a 500 USDC bond for each.
  const wallets = ROLE_NAMES.map(() => ethers.Wallet.createRandom());
  await token.mint(operator.address, usdc(10_000));
  await token.connect(operator).approve(registry.target, usdc(10_000));
  const agentIds = [];
  for (let i = 0; i < ROLE_NAMES.length; i++) {
    await registry.connect(operator).register(i, wallets[i].address, usdc(500));
    agentIds.push(i + 1);
  }

  const policy = await (await ethers.getContractFactory('CosignPolicy')).deploy(token.target, registry.target, usdc(5_000));
  await policy.setExecutor(executor.address);
  await policy.setHumanApprover(approver.address);
  await policy.setScreener(screener.address);
  await policy.setBudget(CATEGORY, usdc(100_000));
  await policy.connect(screener).registerPayee(payee.address, true);
  await token.mint(policy.target, usdc(1_000_000));

  const { chainId } = await ethers.provider.getNetwork();
  const domain = { name: 'CosignPolicy', version: '2', chainId, verifyingContract: policy.target };

  let counter = 0;

  /**
   * Build a release package. Options:
   *  amount, invoiceHash, payee, category, expiryOffset (seconds from now; may be negative),
   *  verdicts: {ROLE: VERDICT}, drop: ROLE to omit, edit: (att, i) => void (applied BEFORE signing),
   *  badSigner: ROLE whose attestation is signed by the wrong key, nonceBase.
   */
  async function build(opts = {}) {
    const now = await time.latest();
    counter += 1;
    const invoiceHash = opts.invoiceHash ?? ethers.id(`invoice-${counter}`);
    const payeeAddr = opts.payee ?? payee.address;
    const amount = opts.amount ?? usdc(1_250);
    const category = opts.category ?? CATEGORY;
    const expiry = now + (opts.expiryOffset ?? 3_600);
    const destinationDomain = opts.destinationDomain ?? 26;

    let atts = ROLE_NAMES.map((name, i) => ({
      invoiceHash,
      payee: payeeAddr,
      amount,
      role: ROLES[name],
      verdict: opts.verdicts?.[name] ?? VERDICT.PASS,
      confidenceBps: 9_300,
      evidenceHash: ethers.id(`evidence-${name}-${counter}`),
      agentId: agentIds[i],
      expiry,
      nonce: (opts.nonceBase ?? counter * 100) + i,
      destinationDomain,
    }));
    if (opts.edit) atts.forEach((a, i) => opts.edit(a, i));

    const sigs = [];
    for (let i = 0; i < atts.length; i++) {
      const name = ROLE_NAMES[i];
      const key = opts.badSigner === name ? ethers.Wallet.createRandom() : wallets[i];
      sigs.push(await key.signTypedData(domain, ATTESTATION_TYPES, atts[i]));
    }

    if (opts.drop) {
      const idx = ROLES[opts.drop];
      atts = atts.filter((_, i) => i !== idx);
      sigs.splice(idx, 1);
    }

    return { req: { invoiceHash, payee: payeeAddr, amount, category, destinationDomain }, atts, sigs, humanSig: '0x', expiry };
  }

  /** Human approval over the request, in the packed format the contract expects: uint64 expiry + signature. */
  async function humanApproval(req, { signer = approver, expiryOffset = 3_600, amount } = {}) {
    const exp = (await time.latest()) + expiryOffset;
    const sig = await signer.signTypedData(domain, HUMAN_TYPES, {
      invoiceHash: req.invoiceHash,
      payee: req.payee,
      amount: amount ?? req.amount,
      destinationDomain: req.destinationDomain,
      expiry: exp,
    });
    return ethers.concat([ethers.toBeHex(exp, 8), sig]);
  }

  const evaluate = (p) => policy.evaluate(p.req, p.atts, p.sigs, p.humanSig);
  const release = (p, from = executor) => policy.connect(from).release(p.req, p.atts, p.sigs, p.humanSig);

  return {
    owner, executor, auditor, operator, approver, screener, pool, payee, stranger,
    token, registry, policy, wallets, agentIds, domain,
    build, humanApproval, evaluate, release,
  };
}

module.exports = { deployAll, ROLES, ROLE_NAMES, VERDICT, usdc, CATEGORY };
