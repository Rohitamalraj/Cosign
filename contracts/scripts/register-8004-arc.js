/**
 * Register Cosign's five agents in Arc testnet's ERC-8004 Identity Registry (v2.0.0, an ERC-721).
 *   npx hardhat run scripts/register-8004-arc.js --network arcTestnet
 *
 * Each agent gets an NFT whose agentURI is an on-chain data: URI holding its registration file (EIP-8004 format), so
 * nothing needs hosting. The owner is the deployer (the operator that also posts the bonds in our own AgentRegistry).
 * We link the identity to our registry with custom metadata keys (cosign.*). We do NOT call setAgentWallet and do NOT
 * write to the Reputation Registry: our scores live in AgentRegistry, moved only by the Auditor.
 * Writes ../deployments/erc8004.json (public ids only). Safe to re-run: agents already registered are skipped.
 */
const fs = require('node:fs');
const path = require('node:path');
const { ethers, network } = require('hardhat');

const IDENTITY = '0x8004A818BFB912233c491871b3d84c89A494BD9e';
const root = path.join(__dirname, '..', '..');
const OUT = path.join(root, 'deployments', 'erc8004.json');

const DESCRIPTIONS = {
  READER: 'Extracts structured fields from an invoice (text or PDF) and hashes the source. Treats the document as untrusted data and never follows instructions inside it.',
  VERIFIER: 'Checks the vendor, the destination wallet and the settlement chain against the registry. Opens a cooling-off and a challenge when a wallet changes.',
  MATCHER: 'Compares the invoice with the agreement or purchase order: rates, quantities, totals and remaining balance.',
  SENTINEL: 'Looks for duplicates, near-duplicates and anomalies against payment history. Models can only add doubt.',
  TREASURER: 'Chooses the payment day against cash on hand, and signs the orders that move idle reserve into USYC and back.',
};

async function main() {
  if (network.name !== 'arcTestnet') throw new Error('run with --network arcTestnet');
  const [deployer] = await ethers.getSigners();
  const dep = JSON.parse(fs.readFileSync(path.join(root, 'deployments', 'arc-testnet.json'), 'utf8'));
  const registry = new ethers.Contract(IDENTITY, [
    'function register(string agentURI, (string metadataKey, bytes metadataValue)[] metadata) returns (uint256 agentId)',
    'function ownerOf(uint256) view returns (address)',
    'function tokenURI(uint256) view returns (string)',
    'function getMetadata(uint256, string) view returns (bytes)',
    'event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)',
  ], deployer);

  const done = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : { agents: {} };
  const roles = Object.keys(dep.agents);
  for (const role of roles) {
    if (done.agents[role]?.erc8004AgentId) { console.log(role, 'already registered as', done.agents[role].erc8004AgentId); continue; }
    const a = dep.agents[role];
    const card = {
      type: 'https://eips.ethereum.org/EIPS/eip-8004#registration-v1',
      name: `Cosign ${role[0]}${role.slice(1).toLowerCase()}`,
      description: DESCRIPTIONS[role],
      services: [{ name: 'web', endpoint: 'https://github.com/Rohitamalraj/Cosign' }],
      x402Support: false,
      active: true,
      supportedTrust: ['crypto-economic'],
      cosign: { role, signer: a.signer, registry: dep.registry, registryAgentId: a.agentId, policy: dep.policy, note: 'Signs EIP-712 attestations; the policy contract verifies them. Scores and bonds live in Cosign AgentRegistry.' },
    };
    const uri = `data:application/json;base64,${Buffer.from(JSON.stringify(card)).toString('base64')}`;
    const enc = (s) => ethers.toUtf8Bytes(String(s));
    const meta = [
      ['cosign.role', enc(role)], ['cosign.signer', ethers.getBytes(a.signer)],
      ['cosign.registryAgentId', ethers.AbiCoder.defaultAbiCoder().encode(['uint256'], [a.agentId])], ['cosign.registry', ethers.getBytes(dep.registry)],
    ].map(([metadataKey, metadataValue]) => ({ metadataKey, metadataValue }));
    const tx = await registry.register(uri, meta);
    const r = await tx.wait();
    const t = r.logs.map((l) => { try { return registry.interface.parseLog(l); } catch { return null; } }).find((p) => p?.name === 'Transfer' && p.args.from === ethers.ZeroAddress);
    if (!t) throw new Error(`no mint event for ${role} in ${tx.hash}`);
    const id = Number(t.args.tokenId);
    done.agents[role] = { erc8004AgentId: id, owner: deployer.address, cosignAgentId: a.agentId, signer: a.signer, tx: tx.hash, explorer: `https://explorer.testnet.arc.io/tx/${tx.hash}` };
    console.log(role, '-> ERC-8004 agent', id, tx.hash);
  }
  const out = { network: 'arc-testnet', chainId: 5042002, identityRegistry: IDENTITY, registryVersion: '2.0.0', agentRegistry: `eip155:5042002:${IDENTITY}`, registeredAt: new Date().toISOString(), agents: done.agents };
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + '\n');

  // Read it all back from the chain.
  for (const role of roles) {
    const id = out.agents[role].erc8004AgentId;
    const uri = await registry.tokenURI(id);
    const card = JSON.parse(Buffer.from(uri.split(',')[1], 'base64').toString());
    const signer = ethers.hexlify(await registry.getMetadata(id, 'cosign.signer'));
    console.log(`${role}: owner ${await registry.ownerOf(id)} | card "${card.name}" | signer on chain ${signer} ${signer.toLowerCase() === dep.agents[role].signer.toLowerCase() ? 'matches' : 'MISMATCH'}`);
  }
}
main().catch((e) => { console.error(e.shortMessage || e.message); process.exit(1); });
