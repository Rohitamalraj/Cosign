/**
 * Add the example vendors (the ones our seven example invoices are written for) to the vendor ledger.
 *   COSIGN_DB_DIR=.data/pg npx tsx scripts/seed-example-vendors.ts          (local PGlite)
 *   DATABASE_URL=postgres://... npx tsx scripts/seed-example-vendors.ts      (a real Postgres, e.g. Render)
 *
 * Their wallets are the testnet vendor wallets in agents/data-testnet/ledger.json, already allowlisted on the policy
 * contract during the first on-chain run. This only writes the database; for any NEW vendor use the Vendors page,
 * which also allowlists the wallet on-chain. These are example vendors we made up, not real businesses.
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { openDb } from '../src/server/db';
import { createVendor, getVendor, listVendors, upsertAgreement } from '../src/server/repo';

const MICRO = (s: string) => BigInt(Math.round(Number(s) * 1_000_000));

async function main() {
  const file = join(resolve(__dirname, '..', '..'), 'agents', 'data-testnet', 'ledger.json');
  const ledger = JSON.parse(readFileSync(file, 'utf8')) as {
    vendors: { id: string; name: string; emailDomain: string; wallet: string; category: string; chains?: string[]; aliases?: string[] }[];
    agreements: { ref: string; vendorId: string; description?: string; lines?: { match: string; rate: string }[]; expectedTotal?: string; remaining?: string }[];
  };
  const db = await openDb({ dir: process.env.DATABASE_URL ? undefined : process.env.COSIGN_DB_DIR ?? join(process.cwd(), '.data', 'pg') });
  const existing = new Set((await listVendors(db)).map((v) => v.wallet));
  const idMap = new Map<string, string>();
  for (const v of ledger.vendors) {
    if (existing.has(v.wallet.toLowerCase())) { idMap.set(v.id, (await listVendors(db)).find((x) => x.wallet === v.wallet.toLowerCase())!.id); continue; }
    const made = await createVendor(db, { name: v.name, aliases: v.aliases, emailDomain: v.emailDomain, wallet: v.wallet, category: v.category, chains: v.chains ?? ['arc'], createdBy: 'seed-example-vendors' });
    idMap.set(v.id, made.id);
    console.log('added', made.id, made.wallet);
  }
  for (const a of ledger.agreements) {
    const vendorId = idMap.get(a.vendorId);
    if (!vendorId || !(await getVendor(db, vendorId))) continue;
    await upsertAgreement(db, {
      ref: a.ref, vendorId, description: a.description ?? '', lines: (a.lines ?? []).map((l) => ({ match: l.match, rateMicro: MICRO(l.rate) })),
      expectedTotalMicro: a.expectedTotal ? MICRO(a.expectedTotal) : null, remainingMicro: a.remaining ? MICRO(a.remaining) : null,
    });
  }
  console.log('vendors in ledger:', (await listVendors(db)).length);
  await db.close();
}
main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
