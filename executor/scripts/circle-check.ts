import { initiateDeveloperControlledWalletsClient } from '@circle-fin/developer-controlled-wallets';

/** Read-only check that the Circle credentials in executor/.env work. Prints no secrets. */
async function main() {
  const apiKey = process.env.CIRCLE_API_KEY;
  const entitySecret = process.env.CIRCLE_ENTITY_SECRET;
  if (!apiKey || !entitySecret) throw new Error('CIRCLE_API_KEY and CIRCLE_ENTITY_SECRET must be set in executor/.env');

  const client = initiateDeveloperControlledWalletsClient({ apiKey, entitySecret });
  const sets = await client.listWalletSets({});
  const list = sets.data?.walletSets ?? [];
  console.log(`credentials OK. wallet sets: ${list.length}`);
  for (const s of list) console.log(`  ${s.id}`);
  const wallets = await client.listWallets({});
  console.log(`wallets: ${wallets.data?.wallets?.length ?? 0}`);
  for (const w of wallets.data?.wallets ?? []) console.log(`  ${w.id}  ${w.blockchain}  ${w.accountType}  ${w.address}  state=${w.state}`);
}

main().catch((e) => {
  const status = (e as { response?: { status?: number; data?: unknown } })?.response;
  console.error('Circle check failed:', status ? `HTTP ${status.status} ${JSON.stringify(status.data)}` : (e instanceof Error ? e.message : e));
  process.exit(1);
});


