/**
 * Circle CCTP domain ids for the chains an invoice may ask to be paid on. Domain 26 is Arc itself (a plain USDC
 * transfer); any other domain is paid by burning USDC on Arc and minting on that chain through CCTP V2.
 * Testnet ids from Circle's CCTP docs. Add a chain here only after checking its domain id.
 */
export const ARC_DOMAIN = 26;

const BY_NAME: Record<string, number> = {
  arc: 26,
  'arc testnet': 26,
  'ethereum sepolia': 0,
  sepolia: 0,
  'op sepolia': 2,
  'optimism sepolia': 2,
  'arbitrum sepolia': 3,
  'base sepolia': 6,
};

const LABELS: Record<number, string> = { 26: 'Arc', 0: 'Ethereum Sepolia', 2: 'OP Sepolia', 3: 'Arbitrum Sepolia', 6: 'Base Sepolia' };

/** The CCTP domain for a chain name written on an invoice, or null if it is not one we can pay on. */
export function chainDomain(name: string | null | undefined): number | null {
  if (!name) return null;
  const d = BY_NAME[name.trim().toLowerCase().replace(/\s+/g, ' ')];
  return d === undefined ? null : d;
}

export const chainLabel = (domain: number): string => LABELS[domain] ?? `domain ${domain}`;

/** Canonical name used in the ledger (`vendor.chains`), so "Base Sepolia" and "base sepolia" are the same chain. */
export const chainKey = (domain: number): string => chainLabel(domain).toLowerCase();
