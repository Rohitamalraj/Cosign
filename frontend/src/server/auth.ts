/**
 * Sign-in with an Ethereum wallet (an EIP-4361-style message signed with personal_sign). There are no passwords and
 * the server never holds a user's key.
 *
 * Flow: the browser asks for a challenge for its address; the server stores a one-time nonce and returns the message;
 * the wallet signs it; the server recovers the signer, checks it is the address, the domain and an unused,
 * unexpired nonce, and then issues an opaque session token (only its hash is stored).
 *
 * Roles: `admin` (set by COSIGN_ADMIN_ADDRESSES or by another admin), `operator` (added by an admin), `guest`
 * (any other signed-in wallet: can run checks on their own invoices but cannot release payments or change vendors).
 */
import { createHash, randomBytes } from 'node:crypto';
import { getAddress, verifyMessage } from 'ethers';
import type { Db } from './db';

export type Role = 'admin' | 'operator' | 'guest';
export interface Session { address: string; role: Role; expiresAt: string }

const NONCE_TTL_MS = 10 * 60_000;
export const SESSION_TTL_MS = 12 * 60 * 60_000;

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

export function adminAddresses(env: NodeJS.ProcessEnv = process.env): string[] {
  return (env.COSIGN_ADMIN_ADDRESSES ?? '').split(/[\s,]+/).filter(Boolean).map((a) => { try { return getAddress(a).toLowerCase(); } catch { return ''; } }).filter(Boolean);
}

export interface Challenge { message: string; nonce: string; expiresAt: string }

export async function createChallenge(db: Db, args: { address: string; domain: string; uri: string; chainId: number; now?: Date }): Promise<Challenge> {
  const address = getAddress(args.address); // throws on a malformed address
  const now = args.now ?? new Date();
  const nonce = randomBytes(16).toString('hex');
  const expires = new Date(now.getTime() + NONCE_TTL_MS);
  await db.query('delete from auth_nonces where expires_at < $1', [now.toISOString()]);
  await db.query('insert into auth_nonces(nonce, expires_at) values ($1, $2)', [nonce, expires.toISOString()]);
  const message = [
    `${args.domain} wants you to sign in with your Ethereum account:`,
    address,
    '',
    'Sign in to Cosign. This signs a message only: it sends no transaction and costs nothing.',
    '',
    `URI: ${args.uri}`,
    'Version: 1',
    `Chain ID: ${args.chainId}`,
    `Nonce: ${nonce}`,
    `Issued At: ${now.toISOString()}`,
    `Expiration Time: ${expires.toISOString()}`,
  ].join('\n');
  return { message, nonce, expiresAt: expires.toISOString() };
}

export class AuthError extends Error {
  status = 401;
}

/** Verify a signed challenge and open a session. Returns the opaque token (give it to the browser once) and the session. */
export async function signIn(db: Db, args: { address: string; message: string; signature: string; domain: string; now?: Date; env?: NodeJS.ProcessEnv }): Promise<{ token: string; session: Session }> {
  const now = args.now ?? new Date();
  let address: string;
  try { address = getAddress(args.address); } catch { throw new AuthError('invalid address'); }

  const lines = args.message.split('\n');
  if (lines[0] !== `${args.domain} wants you to sign in with your Ethereum account:`) throw new AuthError('the message was made for a different site');
  if (lines[1] !== address) throw new AuthError('the message names a different address');
  const nonce = /^Nonce: ([0-9a-f]{32})$/m.exec(args.message)?.[1];
  const exp = /^Expiration Time: (.+)$/m.exec(args.message)?.[1];
  if (!nonce || !exp || Date.parse(exp) < now.getTime()) throw new AuthError('the sign-in message has expired');

  let signer: string;
  try { signer = verifyMessage(args.message, args.signature); } catch { throw new AuthError('the signature is not valid'); }
  if (signer.toLowerCase() !== address.toLowerCase()) throw new AuthError('the signature does not match the address');

  // One use only: deleting is the check, so a replayed signature finds nothing.
  const used = await db.query('delete from auth_nonces where nonce = $1 and expires_at > $2 returning nonce', [nonce, now.toISOString()]);
  if (!used.length) throw new AuthError('this sign-in link was already used or has expired');

  const lower = address.toLowerCase();
  const role = await resolveRole(db, lower, args.env);
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);
  await db.query('delete from sessions where expires_at < $1', [now.toISOString()]);
  await db.query('insert into sessions(token_hash, address, expires_at) values ($1,$2,$3)', [sha256(token), lower, expiresAt.toISOString()]);
  return { token, session: { address, role, expiresAt: expiresAt.toISOString() } };
}

/** Admins named in the environment are always admins; others get the role an admin gave them, or guest. */
export async function resolveRole(db: Db, lowerAddress: string, env: NodeJS.ProcessEnv = process.env): Promise<Role> {
  if (adminAddresses(env).includes(lowerAddress)) return 'admin';
  const rows = await db.query<{ role: Role }>('select role from users where address = $1', [lowerAddress]);
  return rows[0]?.role ?? 'guest';
}

export async function getSession(db: Db, token: string | null | undefined, opts: { now?: Date; env?: NodeJS.ProcessEnv } = {}): Promise<Session | null> {
  if (!token || token.length < 20 || token.length > 200) return null;
  const now = opts.now ?? new Date();
  const rows = await db.query<{ address: string; expires_at: string }>('select address, expires_at from sessions where token_hash = $1', [sha256(token)]);
  const r = rows[0];
  if (!r || new Date(r.expires_at).getTime() <= now.getTime()) return null;
  return { address: getAddress(r.address), role: await resolveRole(db, r.address, opts.env), expiresAt: new Date(r.expires_at).toISOString() };
}

export async function signOut(db: Db, token: string | null | undefined): Promise<void> {
  if (token) await db.query('delete from sessions where token_hash = $1', [sha256(token)]);
}

export async function setUserRole(db: Db, address: string, role: Role | null): Promise<void> {
  const a = getAddress(address).toLowerCase();
  if (role === null || role === 'guest') { await db.query('delete from users where address = $1', [a]); return; }
  await db.query('insert into users(address, role) values ($1,$2) on conflict (address) do update set role = excluded.role', [a, role]);
}

export async function listUsers(db: Db): Promise<{ address: string; role: Role }[]> {
  return (await db.query<{ address: string; role: Role }>('select address, role from users order by created_at')).map((r) => ({ address: getAddress(r.address), role: r.role }));
}

export const can = {
  releasePayments: (s: Session | null) => !!s && (s.role === 'admin' || s.role === 'operator'),
  manageVendors: (s: Session | null) => !!s && s.role === 'admin',
  reportOutcomes: (s: Session | null) => !!s && (s.role === 'admin' || s.role === 'operator'),
  seeAllInvoices: (s: Session | null) => !!s && (s.role === 'admin' || s.role === 'operator'),
};
