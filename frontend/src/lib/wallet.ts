'use client';

/**
 * The browser wallet (MetaMask or any EIP-1193 wallet). Cosign never sees a key: the wallet signs a sign-in message and,
 * for over-limit payments, an EIP-712 approval, and only signatures leave the browser.
 */

interface Eip1193 { request(args: { method: string; params?: unknown[] }): Promise<unknown> }

export const ARC = {
  chainId: '0x4cef52', // 5042002
  chainName: 'Arc Testnet',
  rpcUrls: ['https://rpc.testnet.arc.io'],
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
  blockExplorerUrls: ['https://explorer.testnet.arc.io'],
};

function provider(): Eip1193 {
  const eth = (window as unknown as { ethereum?: Eip1193 }).ethereum;
  if (!eth) throw new Error('No wallet found. Install MetaMask (or another browser wallet) and reload.');
  return eth;
}

export const hasWallet = (): boolean => typeof window !== 'undefined' && !!(window as unknown as { ethereum?: unknown }).ethereum;

/** Ask the wallet for an account and make sure it is on Arc testnet (adding the network if needed). */
export async function connectWallet(): Promise<string> {
  const eth = provider();
  const accounts = (await eth.request({ method: 'eth_requestAccounts' })) as string[];
  if (!accounts?.[0]) throw new Error('The wallet did not share an account.');
  await ensureArc();
  return accounts[0];
}

export async function ensureArc(): Promise<void> {
  const eth = provider();
  const current = (await eth.request({ method: 'eth_chainId' })) as string;
  if (current.toLowerCase() === ARC.chainId) return;
  try {
    await eth.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: ARC.chainId }] });
  } catch (e) {
    const code = (e as { code?: number }).code;
    if (code === 4902 || code === -32603) await eth.request({ method: 'wallet_addEthereumChain', params: [ARC] });
    else throw e;
  }
}

async function post<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `request failed (${res.status})`);
  return data as T;
}

/** Sign in with the wallet. Returns the session the server opened. */
export async function signInWithWallet(): Promise<{ address: string; role: 'admin' | 'operator' | 'guest' }> {
  const address = await connectWallet();
  const { message } = await post<{ message: string }>('/api/auth/challenge', { address });
  const signature = (await provider().request({ method: 'personal_sign', params: [message, address] })) as string;
  const { session } = await post<{ session: { address: string; role: 'admin' | 'operator' | 'guest' } }>('/api/auth/verify', { address, message, signature });
  return session;
}

export interface ApprovalRequest {
  domain: Record<string, unknown>;
  types: Record<string, { name: string; type: string }[]>;
  value: Record<string, unknown>;
  expiry: number;
  approver: string;
}

/** Sign the approval with the connected wallet. It must be the on-chain approver's wallet, or the contract rejects it. */
export async function signApproval(req: ApprovalRequest): Promise<{ expiry: number; signature: string; signer: string }> {
  const signer = await connectWallet();
  if (signer.toLowerCase() !== req.approver.toLowerCase()) {
    throw new Error(`Switch your wallet to the approver account (${req.approver}). Connected: ${signer}.`);
  }
  const domainFields = [
    { name: 'name', type: 'string' }, { name: 'version', type: 'string' }, { name: 'chainId', type: 'uint256' }, { name: 'verifyingContract', type: 'address' },
  ];
  const data = JSON.stringify({
    types: { EIP712Domain: domainFields, ...req.types },
    primaryType: 'HumanApproval',
    domain: { ...req.domain, chainId: Number(req.domain.chainId) },
    message: req.value,
  });
  const signature = (await provider().request({ method: 'eth_signTypedData_v4', params: [signer, data] })) as string;
  return { expiry: req.expiry, signature, signer };
}
