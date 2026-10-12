import { HDNodeWallet } from 'ethers';
import { ROLE_ORDER, type RoleName } from './types';

/** Public, well-known test mnemonic. Dev and tests only. It is refused when NODE_ENV=production. */
const DEV_MNEMONIC = 'test test test test test test test test test test test junk';

/**
 * One key per agent, derived from a mnemonic. Agent keys are separate from the Executor wallet and are never
 * placed in prompts or logs. Set COSIGN_AGENT_MNEMONIC for anything real.
 */
export function loadAgentKeys(env: Record<string, string | undefined> = process.env): Record<RoleName, HDNodeWallet> {
  let phrase = env.COSIGN_AGENT_MNEMONIC;
  if (!phrase) {
    if (env.NODE_ENV === 'production') throw new Error('COSIGN_AGENT_MNEMONIC is required in production');
    phrase = DEV_MNEMONIC;
  }
  const keys = {} as Record<RoleName, HDNodeWallet>;
  ROLE_ORDER.forEach((role, i) => {
    keys[role] = HDNodeWallet.fromPhrase(phrase!, undefined, `m/44'/60'/0'/0/${100 + i}`);
  });
  return keys;
}
