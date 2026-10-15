import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Prints the values the deployed server needs, ready to paste into your host's environment settings. It reads local
 * gitignored files and prints to YOUR terminal only. Do not paste its output into chat, an issue or a commit.
 *   node --env-file=.env --import tsx scripts/print-deploy-env.ts
 * It deliberately does not print CIRCLE_API_KEY or CIRCLE_ENTITY_SECRET: copy those from executor/.env yourself.
 */
const wallets = JSON.parse(readFileSync(join(process.cwd(), 'circle-wallets.local.json'), 'utf8')) as { wallets: Record<string, { id: string; address: string }> };
const relayer = existsSync(join(process.cwd(), 'relayer.local.json')) ? (JSON.parse(readFileSync(join(process.cwd(), 'relayer.local.json'), 'utf8')) as { privateKey: string }).privateKey : '';

console.log('# Paste each line into your host\'s environment settings (Render: Environment).\n');
console.log(`COSIGN_CIRCLE_WALLETS=${JSON.stringify(wallets.wallets)}`);
console.log(`COSIGN_RELAYER_PRIVATE_KEY=${relayer}`);
console.log('COSIGN_ADMIN_ADDRESSES=<your MetaMask address, the one that signs in as admin>');
console.log('# Also set CIRCLE_API_KEY and CIRCLE_ENTITY_SECRET (copy them from executor/.env). DATABASE_URL comes from Render\'s database.');
