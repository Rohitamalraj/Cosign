import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { Wallet } from 'ethers';
import { openDb, type Db } from '../src/server/db';
import { AuthError, can, createChallenge, getSession, listUsers, resolveRole, setUserRole, signIn, signOut } from '../src/server/auth';

let db: Db;
type Signer = { address: string; signMessage(m: string): Promise<string> };
const alice: Signer = Wallet.createRandom();
const bob: Signer = Wallet.createRandom();
const E = (o: Record<string, string> = {}) => o as unknown as NodeJS.ProcessEnv;
const DOMAIN = 'cosign.example';
const base = { domain: DOMAIN, uri: 'https://cosign.example', chainId: 5042002 };
beforeEach(async () => { db = await openDb({}); });
afterEach(async () => { await db.close(); });

async function login(w: Signer, env: NodeJS.ProcessEnv = E(), tweak?: (m: string) => string) {
  const ch = await createChallenge(db, { address: w.address, ...base });
  const signature = await w.signMessage(ch.message); // the wallet signs what it was shown
  const msg = tweak ? tweak(ch.message) : ch.message; // then the message is altered in transit
  return signIn(db, { address: w.address, message: msg, signature, domain: DOMAIN, env });
}

describe('wallet sign-in', () => {
  it('signs in, creates a session and reads it back; an unknown wallet is a guest', async () => {
    const { token, session } = await login(alice);
    assert.equal(session.address, alice.address);
    assert.equal(session.role, 'guest');
    const again = await getSession(db, token, { env: E() });
    assert.equal(again?.address, alice.address);
  });

  it('an admin named in the environment is an admin, and an admin can grant operator', async () => {
    const env = E({ COSIGN_ADMIN_ADDRESSES: alice.address.toLowerCase() });
    assert.equal((await login(alice, env)).session.role, 'admin');
    await setUserRole(db, bob.address, 'operator');
    assert.equal((await login(bob, env)).session.role, 'operator');
    assert.deepEqual((await listUsers(db)).map((u) => u.role), ['operator']);
    await setUserRole(db, bob.address, null);
    assert.equal(await resolveRole(db, bob.address.toLowerCase(), env), 'guest');
  });

  it('a signature cannot be replayed: the nonce is single use', async () => {
    const ch = await createChallenge(db, { address: alice.address, ...base });
    const signature = await alice.signMessage(ch.message);
    await signIn(db, { address: alice.address, message: ch.message, signature, domain: DOMAIN });
    await assert.rejects(signIn(db, { address: alice.address, message: ch.message, signature, domain: DOMAIN }), /already used/);
  });

  it('rejects a signature from another wallet, a wrong address, a wrong site and an expired message', async () => {
    const ch = await createChallenge(db, { address: alice.address, ...base });
    await assert.rejects(signIn(db, { address: alice.address, message: ch.message, signature: await bob.signMessage(ch.message), domain: DOMAIN }), /does not match/);
    await assert.rejects(signIn(db, { address: bob.address, message: ch.message, signature: await bob.signMessage(ch.message), domain: DOMAIN }), /different address/);
    await assert.rejects(signIn(db, { address: alice.address, message: ch.message, signature: await alice.signMessage(ch.message), domain: 'evil.example' }), /different site/);
    const old = await createChallenge(db, { address: alice.address, ...base, now: new Date(Date.now() - 3_600_000) });
    await assert.rejects(signIn(db, { address: alice.address, message: old.message, signature: await alice.signMessage(old.message), domain: DOMAIN }), AuthError);
  });

  it('a message edited after signing is rejected', async () => {
    await assert.rejects(login(alice, E(), (m) => m.replace('Version: 1', 'Version: 2')), AuthError);
  });

  it('sign out ends the session; a malformed or expired token gives no session', async () => {
    const { token } = await login(alice);
    await signOut(db, token);
    assert.equal(await getSession(db, token), null);
    assert.equal(await getSession(db, 'short'), null);
    const second = await login(alice);
    assert.equal(await getSession(db, second.token, { now: new Date(Date.now() + 13 * 3_600_000) }), null);
  });

  it('permissions: only operators and admins release; only admins manage vendors', async () => {
    const guest = { address: alice.address, role: 'guest' as const, expiresAt: '' };
    const op = { ...guest, role: 'operator' as const };
    const admin = { ...guest, role: 'admin' as const };
    assert.deepEqual([can.releasePayments(guest), can.releasePayments(op), can.releasePayments(admin), can.releasePayments(null)], [false, true, true, false]);
    assert.deepEqual([can.manageVendors(op), can.manageVendors(admin)], [false, true]);
    assert.deepEqual([can.seeAllInvoices(guest), can.seeAllInvoices(op)], [false, true]);
  });
});
