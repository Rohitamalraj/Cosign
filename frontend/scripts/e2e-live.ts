/**
 * End-to-end test of the LIVE app against a running server, using real wallets and the real chain:
 * sign in, run an invoice, pay it on-chain, report an outcome (the Auditor moves a score on-chain), pay an over-limit
 * invoice with the approver wallet's EIP-712 signature, hold a duplicate, and check that a guest cannot pay.
 *
 *   E2E_BASE_URL=http://localhost:3113 E2E_ADMIN_KEY=0x... E2E_APPROVER_KEY=0x... npx tsx scripts/e2e-live.ts
 *
 * The admin wallet must be listed in the server's COSIGN_ADMIN_ADDRESSES. The approver key must be the wallet that is
 * `policy.humanApprover()` on-chain. Keys come from the environment and are never printed.
 */
import { Contract, JsonRpcProvider, Wallet } from 'ethers';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:3113';
const dep = JSON.parse(readFileSync(join(resolve(__dirname, '..', '..'), 'deployments', 'arc-testnet.json'), 'utf8')) as { policy: string; registry: string };
const provider = new JsonRpcProvider('https://rpc.testnet.arc.io');
const policy = new Contract(dep.policy, ['function paid(bytes32) view returns (bool)'], provider);
const registry = new Contract(dep.registry, ['function getAgent(uint256) view returns (tuple(address operator, address signer, uint8 role, uint128 bond, int32 score, bool active))'], provider);

let failures = 0;
const ok = (c: boolean, msg: string) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${msg}`); if (!c) failures++; };

class Client {
  cookie = '';
  async call(path: string, init: { method?: string; body?: unknown } = {}) {
    const res = await fetch(BASE + path, { method: init.method ?? (init.body === undefined ? 'GET' : 'POST'), headers: { 'content-type': 'application/json', cookie: this.cookie }, body: init.body === undefined ? undefined : JSON.stringify(init.body) });
    const set = res.headers.get('set-cookie');
    if (set) this.cookie = set.split(';')[0];
    return { status: res.status, body: (await res.json().catch(() => ({}))) as Record<string, any> };
  }
  async signIn(w: { address: string; signMessage(m: string): Promise<string> }) {
    const ch = await this.call('/api/auth/challenge', { body: { address: w.address } });
    const sig = await w.signMessage(ch.body.message);
    return this.call('/api/auth/verify', { body: { address: w.address, message: ch.body.message, signature: sig } });
  }
}

const invoice = (n: string, qty: number, issued: string) => {
  const total = (qty * 0.125).toFixed(3).replace(/0$/, '');
  return `INVOICE ${n}\nFrom: Northwind Design Co. <billing@northwinddesign.example>\nTo: Acme Studio\nIssued: ${issued}\nDue: 2026-12-01\nAgreement: SOW-22\nCurrency: USDC\nPay to wallet: 0x485cff12956519a597dcdb0cb0e1b37fe5b0246c\n\nDescription | Qty | Rate | Amount\nDesign hours - ${n} work | ${qty} | 0.125 | ${total}\n\nTotal: ${total} USDC\nTerms: Net 7\n`;
};

async function main() {
  const admin = new Wallet(process.env.E2E_ADMIN_KEY!);
  const approver = new Wallet(process.env.E2E_APPROVER_KEY!);
  const a = new Client();

  const st = await a.call('/api/status');
  ok(st.body.mode === 'live', `server is in live mode (${st.body.network})`);

  // Not signed in: nothing is visible and nothing can be run.
  ok((await a.call('/api/invoices', { body: { text: invoice('INV-X', 8, '2026-10-16') } })).status === 401, 'running an invoice without signing in is refused (401)');

  const si = await a.signIn(admin);
  ok(si.status === 200 && si.body.session.role === 'admin', 'admin wallet signs in with a signed message');

  // 1. A clean invoice, paid on-chain.
  const n1 = `INV-E2E-${Date.now().toString().slice(-6)}`;
  const r1 = await a.call('/api/invoices', { body: { text: invoice(n1, 8, '2026-10-16') } });
  const inv1 = r1.body.invoice;
  ok(inv1?.status === 'ready', `clean invoice is ready: the real contract says it would release (${inv1?.status}: ${inv1?.headline?.slice(0, 90)})`);
  if (process.env.E2E_SMOKE) {
    console.log(failures ? `${failures} CHECK(S) FAILED` : 'SMOKE PASSED (no payment made)');
    process.exit(failures ? 1 : 0);
  }
  const pay1 = await a.call(`/api/invoices/${encodeURIComponent(inv1.uid)}/release`, { body: {} });
  ok(pay1.status === 200 && pay1.body.invoice?.status === 'released', `paid on-chain through the Executor (${pay1.body.invoice?.txUrl ?? pay1.body.error})`);
  ok(await policy.paid(inv1.hashFull), "the contract's paid set contains the invoice (read from Arc)");
  const rc = await a.call(`/api/invoices/${encodeURIComponent(inv1.uid)}/receipt`);
  ok(rc.status === 200 && rc.body.replay?.ok === true, 'the receipt replays from scratch (signatures, registry, receipt hash)');

  // 2. The Auditor: a person says the payment was correct; each signer's score moves on-chain.
  const before = await Promise.all([1, 2, 3, 4, 5].map(async (i) => Number((await registry.getAgent(i)).score)));
  const out = await a.call(`/api/invoices/${encodeURIComponent(inv1.uid)}/outcome`, { body: { kind: 'confirmed_correct', note: 'e2e check' } });
  const written = (out.body.outcome?.effects ?? []).filter((e: any) => e.tx).length;
  ok(out.status === 200 && written === 5, `Auditor wrote ${written}/5 score changes on-chain`);
  const after = await Promise.all([1, 2, 3, 4, 5].map(async (i) => Number((await registry.getAgent(i)).score)));
  ok(after.every((s, i) => s === Math.min(100, before[i] + 1)), `scores read from the registry rose by 1: ${before.join(',')} -> ${after.join(',')}`);
  ok((await a.call(`/api/invoices/${encodeURIComponent(inv1.uid)}/outcome`, { body: { kind: 'confirmed_correct' } })).status === 409, 'a second outcome for the same invoice is refused (409)');

  // 3. The same invoice again is held (duplicate).
  const dup = await a.call('/api/invoices', { body: { text: invoice(n1, 8, '2026-10-16') } });
  ok(dup.body.invoice?.status !== 'ready' && dup.body.invoice?.status !== 'released', `re-submitting the paid invoice is held (${dup.body.invoice?.status}: ${dup.body.invoice?.headline?.slice(0, 100)})`);

  // 4. Over the limit: needs the approver wallet's signature.
  const n2 = `INV-E2E-${(Date.now() + 1).toString().slice(-6)}`;
  const r2 = await a.call('/api/invoices', { body: { text: invoice(n2, 48, '2026-10-17') } });
  const inv2 = r2.body.invoice;
  ok(inv2?.status === 'escalated' && inv2.ruleOverrides?.['6'] === 'wait', `6 USDC invoice is held for the approver by the contract's rule 6 (${inv2?.status})`);
  const noSig = await a.call(`/api/invoices/${encodeURIComponent(inv2.uid)}/release`, { body: {} });
  ok(noSig.status === 409, 'releasing without the approver signature is refused');
  const ap = await a.call(`/api/invoices/${encodeURIComponent(inv2.uid)}/approval`);
  ok(ap.status === 200 && ap.body.approver?.toLowerCase() === approver.address.toLowerCase(), 'the server asks for the on-chain approver wallet to sign');
  const wrong = await admin.signTypedData(ap.body.domain, ap.body.types, ap.body.value);
  const bad = await a.call(`/api/invoices/${encodeURIComponent(inv2.uid)}/release`, { body: { approval: { expiry: ap.body.expiry, signature: wrong } } });
  ok(bad.status === 400, 'a signature from a wallet that is not the approver is refused (400)');
  const good = await approver.signTypedData(ap.body.domain, ap.body.types, ap.body.value);
  const pay2 = await a.call(`/api/invoices/${encodeURIComponent(inv2.uid)}/release`, { body: { approval: { expiry: ap.body.expiry, signature: good } } });
  ok(pay2.status === 200 && pay2.body.invoice?.status === 'released', `paid after the approver signed (${pay2.body.invoice?.txUrl ?? pay2.body.error})`);

  // 5. A guest wallet cannot pay or see someone else's invoices.
  const guest = new Client();
  await guest.signIn(Wallet.createRandom());
  ok((await guest.call(`/api/invoices/${encodeURIComponent(inv1.uid)}/release`, { body: {} })).status === 403, "a guest cannot release payments (403)");
  ok(((await guest.call('/api/invoices')).body.invoices ?? []).length === 0, "a guest does not see the admin's invoices");
  ok((await guest.call('/api/vendors')).status === 403, 'a guest cannot read the vendor ledger (403)');

  // 6. Adding a vendor allowlists its wallet on-chain, with a cooling-off before it can be paid.
  const vw = Wallet.createRandom();
  const v = await a.call('/api/vendors', { body: { name: `E2E Vendor ${Date.now().toString().slice(-5)}`, emailDomain: 'e2e-vendor.example', wallet: vw.address, category: 'general', chains: ['arc'] } });
  const arc = v.body.vendor?.chain?.arc;
  ok(v.status === 200 && arc?.eligibleAt > Math.floor(Date.now() / 1000), `new vendor is allowlisted on-chain and cooling off until ${arc ? new Date(arc.eligibleAt * 1000).toISOString() : '?'}`);

  console.log(failures ? `\n${failures} CHECK(S) FAILED` : '\nALL LIVE CHECKS PASSED');
  process.exit(failures ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
