import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { JsonRpcProvider, Wallet, formatEther } from 'ethers';
import { CCTP_DESTINATIONS } from '../src';

/**
 * The CCTP relayer is a throwaway key whose only job is paying destination-chain gas to submit Circle's attestation.
 * It never holds USDC and cannot redirect a payment (the recipient is inside Circle's signed message).
 * The key lives in the gitignored executor/relayer.local.json. This script prints only the ADDRESS and its balances.
 *   npx tsx scripts/relayer.ts
 */
const FILE = join(process.cwd(), 'relayer.local.json');

export function loadRelayerKey(): string {
  if (!existsSync(FILE)) writeFileSync(FILE, JSON.stringify({ privateKey: Wallet.createRandom().privateKey }, null, 2));
  return (JSON.parse(readFileSync(FILE, 'utf8')) as { privateKey: string }).privateKey;
}

async function main() {
  const w = new Wallet(loadRelayerKey());
  console.log('relayer address:', w.address);
  for (const d of Object.values(CCTP_DESTINATIONS)) {
    const bal = await new JsonRpcProvider(d.rpcUrl).getBalance(w.address);
    console.log(`  ${d.name}: ${formatEther(bal)} ETH`);
  }
}
if (require.main === module) main().catch((e) => { console.error(e.message); process.exit(1); });
