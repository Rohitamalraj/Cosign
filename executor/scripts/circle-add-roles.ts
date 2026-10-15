import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { initiateDeveloperControlledWalletsClient } from '@circle-fin/developer-controlled-wallets';

/**
 * Adds the two operating wallets the live web app needs, in the existing Circle wallet set:
 *   SCREENER  allowlists payees on the policy contract when an admin adds a vendor
 *   AUDITOR   writes outcomes to the registry (score changes and bond slashes) when an operator reports one
 * Neither wallet can move funds or change rules: the screener only edits the payee list and the Auditor only edits
 * reputation. Idempotent: wallets that already exist are kept.
 *   node --env-file=.env --import tsx scripts/circle-add-roles.ts
 */
const LOCAL = join(process.cwd(), 'circle-wallets.local.json');
const PUBLIC = join(process.cwd(), '..', 'deployments', 'circle-wallets-arc-testnet.json');
const NEW_ROLES = ['SCREENER', 'AUDITOR'] as const;

async function main() {
  if (!existsSync(LOCAL)) throw new Error('run circle-setup.ts first');
  const saved = JSON.parse(readFileSync(LOCAL, 'utf8')) as { walletSetId: string; wallets: Record<string, { id: string; address: string }> };
  const client = initiateDeveloperControlledWalletsClient({ apiKey: process.env.CIRCLE_API_KEY!, entitySecret: process.env.CIRCLE_ENTITY_SECRET! });
  const missing = NEW_ROLES.filter((r) => !saved.wallets[r]);
  if (missing.length) {
    const made = await client.createWallets({
      walletSetId: saved.walletSetId,
      blockchains: ['ARC-TESTNET'],
      count: missing.length,
      accountType: 'EOA',
      metadata: missing.map((r) => ({ name: `cosign-${r.toLowerCase()}`, refId: r })),
    });
    (made.data!.wallets ?? []).forEach((w, i) => { saved.wallets[(w.refId as string | undefined) ?? missing[i]] = { id: w.id!, address: w.address! }; });
    writeFileSync(LOCAL, JSON.stringify(saved, null, 2));
  }
  const pub = JSON.parse(readFileSync(PUBLIC, 'utf8')) as { addresses: Record<string, string> };
  for (const r of NEW_ROLES) pub.addresses[r] = saved.wallets[r].address;
  writeFileSync(PUBLIC, JSON.stringify(pub, null, 2) + '\n');
  for (const r of NEW_ROLES) console.log(r.padEnd(9), saved.wallets[r].address);
}
main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
