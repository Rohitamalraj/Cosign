'use client';

import { useEffect, useState } from 'react';
import { Card, PageHeader } from '@/components/ui';
import { api, useStore } from '@/lib/store';

interface ChainState { eligibleAt: number; blocked: boolean }
interface Vendor {
  id: string; name: string; emailDomain: string; wallet: string; category: string; chains: string[]; paidCount: number; walletSinceDays: number;
  onchain: { registered?: boolean; error?: string | null; registerTxs?: Record<string, string> };
  chain: { arc: ChainState | null; remote: Record<string, ChainState> } | null;
}

const CHAIN_CHOICES = ['arc', 'base sepolia'];

function eligibility(s: ChainState | null | undefined, now: number): { text: string; tone: string } {
  if (!s || s.eligibleAt === 0) return { text: 'not allowlisted', tone: 'text-[#8e2e2a]' };
  if (s.blocked) return { text: 'blocked', tone: 'text-[#8e2e2a]' };
  if (s.eligibleAt > now) return { text: `cooling off, payable in ${Math.ceil((s.eligibleAt - now) / 60)} min`, tone: 'text-[#7a5a14]' };
  return { text: 'payable', tone: 'text-[#2c6b57]' };
}

export default function Vendors() {
  const { session, signIn } = useStore();
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [now, setNow] = useState(Math.floor(Date.now() / 1000));
  const [f, setF] = useState({ name: '', emailDomain: '', wallet: '', category: 'design', chains: ['arc'] as string[], ref: '', description: '', match: '', rate: '', remaining: '' });
  const isAdmin = session?.role === 'admin';
  const canSee = session?.role === 'admin' || session?.role === 'operator';

  async function load() {
    try {
      const r = await api<{ vendors: Vendor[]; categories: string[] }>('/api/vendors');
      setVendors(r.vendors);
      setCategories(r.categories);
      setNow(Math.floor(Date.now() / 1000));
    } catch (e) { setErr(e instanceof Error ? e.message : 'could not load vendors'); }
  }
  useEffect(() => { if (canSee) void load(); }, [canSee]); // eslint-disable-line react-hooks/exhaustive-deps

  async function add() {
    setBusy(true);
    setErr(null);
    try {
      await api('/api/vendors', {
        method: 'POST',
        body: JSON.stringify({
          name: f.name, emailDomain: f.emailDomain, wallet: f.wallet, category: f.category, chains: f.chains,
          agreement: f.ref ? { ref: f.ref, description: f.description, lines: f.match ? [{ match: f.match, rateUsdc: f.rate }] : [], remainingUsdc: f.remaining || undefined } : undefined,
        }),
      });
      setF({ ...f, name: '', emailDomain: '', wallet: '', ref: '', description: '', match: '', rate: '', remaining: '' });
    } catch (e) { setErr(e instanceof Error ? e.message : 'could not add the vendor'); }
    finally { setBusy(false); await load(); }
  }

  async function retry(id: string) {
    setBusy(true);
    setErr(null);
    try { await api(`/api/vendors/${encodeURIComponent(id)}/register`, { method: 'POST', body: '{}' }); }
    catch (e) { setErr(e instanceof Error ? e.message : 'retry failed'); }
    finally { setBusy(false); await load(); }
  }

  const input = 'w-full border border-ink/20 bg-opal p-2 text-[13px] outline-none focus:border-violet';

  return (
    <>
      <PageHeader
        eyebrow="Vendor ledger"
        title="Only vendors you registered can be paid."
        sub="Adding a vendor saves it here and allowlists its wallet on the policy contract through the screener wallet. A new wallet then waits out a cooling-off period before it can receive money, so a swapped address cannot be paid the moment it appears."
      />

      {!session && <Card><p className="text-ink/70">Sign in with your wallet. Only operators and admins can see the ledger.</p><button type="button" className="btn-solid mt-3" onClick={() => void signIn().catch((e) => setErr(e.message))}>Sign in with wallet</button></Card>}
      {session && !canSee && <Card><p className="text-ink/70">Your wallet ({session.address.slice(0, 8)}…) is signed in as a guest. Ask an admin to make you an operator to see and use the vendor ledger.</p></Card>}
      {err && <p role="alert" className="mb-4 border border-[#b4443f]/60 bg-[#b4443f]/10 p-3 text-[#8e2e2a]">{err}</p>}

      {canSee && (
        <div className="card mb-6 overflow-x-auto">
          <table className="w-full min-w-[820px] text-left">
            <thead><tr className="border-b border-ink/15">{['Vendor', 'Wallet', 'Category', 'Chains', 'On-chain status', 'Paid'].map((h) => <th key={h} className="eyebrow px-4 py-3 font-medium">{h}</th>)}</tr></thead>
            <tbody>
              {vendors.map((v) => (
                <tr key={v.id} className="border-b border-ink/10 align-top last:border-0">
                  <td className="px-4 py-3"><b>{v.name}</b><div className="font-mono text-[11px] text-ink/55">{v.emailDomain}</div></td>
                  <td className="px-4 py-3 font-mono text-[12px]" title={v.wallet}>{v.wallet.slice(0, 8)}…{v.wallet.slice(-6)}</td>
                  <td className="px-4 py-3 text-ink/70">{v.category}</td>
                  <td className="px-4 py-3 text-ink/70">{v.chains.join(', ')}</td>
                  <td className="px-4 py-3 text-[12px]">
                    {v.chain ? (
                      <>
                        {v.chains.map((c) => {
                          const e = eligibility(c === 'arc' ? v.chain!.arc : v.chain!.remote[c], now);
                          return <div key={c}><span className="text-ink/55">{c}: </span><span className={e.tone}>{e.text}</span></div>;
                        })}
                        {v.onchain.error && <div className="text-[#8e2e2a]">{v.onchain.error}</div>}
                        {isAdmin && (v.onchain.error || v.chain.arc?.eligibleAt === 0) && <button type="button" className="mt-1 text-violet underline" disabled={busy} onClick={() => void retry(v.id)}>Retry registration</button>}
                      </>
                    ) : <span className="text-ink/50">no chain connected</span>}
                  </td>
                  <td className="px-4 py-3 font-mono text-[12px]">{v.paidCount}</td>
                </tr>
              ))}
              {vendors.length === 0 && <tr><td colSpan={6} className="px-4 py-10 text-center text-ink/50">No vendors yet. An admin can add the first one below.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {isAdmin && (
        <Card>
          <h2 className="h2">Add a vendor</h2>
          <p className="mt-1 text-[13px] text-ink/60">The wallet is allowlisted on Arc testnet by the screener wallet (a real transaction). Use the wallet the vendor gave you directly, not one copied from an email.</p>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <label className="text-[12px]">Name<input className={input} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Northwind Design Co." /></label>
            <label className="text-[12px]">Email domain (invoices come from)<input className={input} value={f.emailDomain} onChange={(e) => setF({ ...f, emailDomain: e.target.value })} placeholder="northwinddesign.com" /></label>
            <label className="text-[12px] md:col-span-2">Payment wallet<input className={`${input} font-mono`} value={f.wallet} onChange={(e) => setF({ ...f, wallet: e.target.value })} placeholder="0x…" /></label>
            <label className="text-[12px]">Category<select className={input} value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>{(categories.length ? categories : ['design']).map((c) => <option key={c}>{c}</option>)}</select></label>
            <fieldset className="text-[12px]"><legend>Settles on</legend>
              <div className="mt-1 flex gap-4">{CHAIN_CHOICES.map((c) => (
                <label key={c} className="flex items-center gap-1.5"><input type="checkbox" checked={f.chains.includes(c)} onChange={(e) => setF({ ...f, chains: e.target.checked ? [...f.chains, c] : f.chains.filter((x) => x !== c) })} />{c}</label>
              ))}</div>
            </fieldset>
          </div>
          <h3 className="mt-5 text-[13px] font-semibold">Agreement or PO (optional, but the Matcher needs it to check rates)</h3>
          <div className="mt-2 grid gap-3 md:grid-cols-3">
            <label className="text-[12px]">Reference<input className={input} value={f.ref} onChange={(e) => setF({ ...f, ref: e.target.value })} placeholder="SOW-22" /></label>
            <label className="text-[12px]">Line text it matches<input className={input} value={f.match} onChange={(e) => setF({ ...f, match: e.target.value })} placeholder="design hours" /></label>
            <label className="text-[12px]">Agreed rate (USDC)<input className={input} value={f.rate} onChange={(e) => setF({ ...f, rate: e.target.value })} placeholder="125.00" /></label>
            <label className="text-[12px] md:col-span-2">Description<input className={input} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder="Design retainer" /></label>
            <label className="text-[12px]">Budget remaining (USDC)<input className={input} value={f.remaining} onChange={(e) => setF({ ...f, remaining: e.target.value })} placeholder="20000.00" /></label>
          </div>
          <button type="button" className="btn-solid mt-4" disabled={busy || !f.name || !f.wallet || !f.emailDomain} onClick={() => void add()}>{busy ? 'Registering on-chain…' : 'Add vendor'}</button>
        </Card>
      )}
    </>
  );
}
