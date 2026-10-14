import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { initiateDeveloperControlledWalletsClient } from '@circle-fin/developer-controlled-wallets';
import { verifyTypedData } from 'ethers';
import { ATTESTATION_TYPES } from '../src/abi';

/**
 * Creates (once) a wallet set and six EOA wallets on ARC-TESTNET: one per signing agent plus the Executor.
 * Then proves a Circle-held key can sign our EIP-712 Attestation and that it recovers to the wallet address,
 * which is exactly what CosignPolicy checks with ecrecover.
 *
 * Writes public addresses to ../deployments/circle-wallets-arc-testnet.json and wallet ids (not secret, but
 * only useful with your API key) to executor/circle-wallets.local.json (gitignored).
 */
const ROLES = ['READER', 'VERIFIER', 'MATCHER', 'SENTINEL', 'TREASURER', 'EXECUTOR'] as const;
const LOCAL = join(process.cwd(), 'circle-wallets.local.json');
const PUBLIC = join(process.cwd(), '..', 'deployments', 'circle-wallets-arc-testnet.json');

async function main() {
  const client = initiateDeveloperControlledWalletsClient({ apiKey: process.env.CIRCLE_API_KEY!, entitySecret: process.env.CIRCLE_ENTITY_SECRET! });

  let saved: { walletSetId: string; wallets: Record<string, { id: string; address: string }> } | null = existsSync(LOCAL) ? JSON.parse(readFileSync(LOCAL, 'utf8')) : null;

  if (!saved) {
    const set = await client.createWalletSet({ name: 'cosign-arc-testnet' });
    const walletSetId = set.data!.walletSet!.id!;
    const made = await client.createWallets({
      walletSetId,
      blockchains: ['ARC-TESTNET'],
      count: ROLES.length,
      accountType: 'EOA',
      metadata: ROLES.map((r) => ({ name: `cosign-${r.toLowerCase()}`, refId: r })),
    });
    const wallets: Record<string, { id: string; address: string }> = {};
    (made.data!.wallets ?? []).forEach((w, i) => {
      const role = (w.refId as string | undefined) ?? ROLES[i];
      wallets[role] = { id: w.id!, address: w.address! };
    });
    saved = { walletSetId, wallets };
    writeFileSync(LOCAL, JSON.stringify(saved, null, 2));
    console.log('created wallet set and wallets');
  } else console.log('reusing wallets from circle-wallets.local.json');

  mkdirSync(join(PUBLIC, '..'), { recursive: true });
  writeFileSync(PUBLIC, JSON.stringify({ blockchain: 'ARC-TESTNET', accountType: 'EOA', addresses: Object.fromEntries(Object.entries(saved.wallets).map(([r, w]) => [r, w.address])) }, null, 2) + '\n');
  for (const [r, w] of Object.entries(saved.wallets)) console.log(`  ${r.padEnd(9)} ${w.address}`);

  // --- the test that matters: can a Circle-held key sign our attestation so that ecrecover returns its address? ---
  const policy = JSON.parse(readFileSync(join(process.cwd(), '..', 'deployments', 'arc-testnet.json'), 'utf8')).policy as string;
  const domain = { name: 'CosignPolicy', version: '1', chainId: 5042002, verifyingContract: policy };
  const message = {
    invoiceHash: '0x' + '11'.repeat(32), payee: '0x' + '22'.repeat(20), amount: '1250000', role: 0, verdict: 1, confidenceBps: 9800,
    evidenceHash: '0x' + '33'.repeat(32), agentId: 1, expiry: 2_000_000_000, nonce: '1',
  };
  const typedData = {
    types: { EIP712Domain: [{ name: 'name', type: 'string' }, { name: 'version', type: 'string' }, { name: 'chainId', type: 'uint256' }, { name: 'verifyingContract', type: 'address' }], ...ATTESTATION_TYPES },
    primaryType: 'Attestation',
    domain,
    message,
  };

  const reader = saved.wallets.READER;
  const res = await client.signTypedData({ walletId: reader.id, data: JSON.stringify(typedData), memo: 'cosign feasibility test' });
  const signature = res.data?.signature;
  if (!signature) throw new Error('Circle returned no signature');
  const recovered = verifyTypedData(domain, ATTESTATION_TYPES, message, signature);
  console.log(`\nsignature recovers to ${recovered}`);
  console.log(recovered.toLowerCase() === reader.address.toLowerCase() ? 'PASS: a Circle-held key signs our attestation and ecrecover matches the wallet address' : `FAIL: expected ${reader.address}`);
}

main().catch((e) => {
  const r = (e as { response?: { status?: number; data?: unknown } })?.response;
  console.error('failed:', r ? `HTTP ${r.status} ${JSON.stringify(r.data)}` : (e instanceof Error ? e.message : e));
  process.exit(1);
});
