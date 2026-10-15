'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Invoice } from './data';
import { signApproval, signInWithWallet, type ApprovalRequest } from './wallet';

export type Role = 'admin' | 'operator' | 'guest';
export interface Session { address: string; role: Role }

export interface ServerStatus {
  mode: 'live' | 'preview';
  network: string;
  chainId: number | null;
  policy: string | null;
  humanApprover: string | null;
  perTxLimitUsdc: number | null;
  policyUsdc: number | null;
  database: 'postgres' | 'pglite';
  models: { reader: boolean; matcher: boolean; sentinel: boolean };
  crossChainMint: boolean;
  note: string | null;
}

interface Store {
  invoices: Invoice[];
  loading: boolean;
  error: string | null;
  session: Session | null;
  status: ServerStatus | null;
  canRelease: boolean;
  /** Run an invoice through the real agents (needs a signed-in wallet). */
  submit: (text: string) => Promise<Invoice>;
  /** Upload a text-based PDF (max 5 MB). Scans are rejected with a readable message. */
  submitPdf: (file: File) => Promise<Invoice>;
  rerun: (uid: string) => Promise<Invoice>;
  /** Pay the invoice on-chain. Above the limit, this asks the approver wallet to sign first. */
  release: (uid: string, needsApproval: boolean) => Promise<Invoice>;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
}

const Ctx = createContext<Store | null>(null);

export async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error ?? `request failed (${res.status})`);
  if ((body as { pending?: boolean }).pending) throw new Error((body as { message?: string }).message ?? 'pending');
  return body as T;
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [status, setStatus] = useState<ServerStatus | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [s, st] = await Promise.all([
        api<{ session: Session | null }>('/api/auth/session'),
        api<ServerStatus>('/api/status').catch(() => null),
      ]);
      setSession(s.session);
      setStatus(st);
      setInvoices(s.session ? (await api<{ invoices: Invoice[] }>('/api/invoices')).invoices : []);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'could not load');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const value = useMemo<Store>(() => ({
    invoices, loading, error, refresh, session, status,
    canRelease: session?.role === 'admin' || session?.role === 'operator',
    submit: async (text) => {
      const { invoice } = await api<{ invoice: Invoice }>('/api/invoices', { method: 'POST', body: JSON.stringify({ text }) });
      await refresh();
      return invoice;
    },
    submitPdf: async (file) => {
      const res = await fetch('/api/invoices/pdf', { method: 'POST', headers: { 'content-type': 'application/pdf' }, body: file });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((body as { error?: string }).error ?? `upload failed (${res.status})`);
      await refresh();
      return (body as { invoice: Invoice }).invoice;
    },
    rerun: async (uid) => {
      const { invoice } = await api<{ invoice: Invoice }>(`/api/invoices/${encodeURIComponent(uid)}/rerun`, { method: 'POST', body: '{}' });
      await refresh();
      return invoice;
    },
    release: async (uid, needsApproval) => {
      let approval: { expiry: number; signature: string } | undefined;
      if (needsApproval) {
        const req = await api<ApprovalRequest>(`/api/invoices/${encodeURIComponent(uid)}/approval`);
        const signed = await signApproval(req); // MetaMask asks the approver to sign; the app never sees a key
        approval = { expiry: signed.expiry, signature: signed.signature };
      }
      try {
        const { invoice } = await api<{ invoice: Invoice }>(`/api/invoices/${encodeURIComponent(uid)}/release`, { method: 'POST', body: JSON.stringify({ approval }) });
        return invoice;
      } finally {
        await refresh();
      }
    },
    signIn: async () => { await signInWithWallet(); await refresh(); },
    signOut: async () => { await api('/api/auth/logout', { method: 'POST', body: '{}' }); await refresh(); },
  }), [invoices, loading, error, refresh, session, status]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore(): Store {
  const v = useContext(Ctx);
  if (!v) throw new Error('StoreProvider missing');
  return v;
}
