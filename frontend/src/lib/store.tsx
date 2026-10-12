'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Invoice } from './data';

interface Store {
  invoices: Invoice[];
  loading: boolean;
  error: string | null;
  /** Run an invoice through the real agents. Returns the result, or throws with a readable message. */
  submit: (text: string) => Promise<Invoice>;
  /** A human decision. Approval can only clear the limit rule; the server enforces the rest. */
  humanDecide: (uid: string, approve: boolean) => Promise<void>;
  reset: () => Promise<void>;
  refresh: () => Promise<void>;
}

const Ctx = createContext<Store | null>(null);

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error ?? `request failed (${res.status})`);
  return body as T;
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setInvoices((await api<{ invoices: Invoice[] }>('/api/invoices')).invoices);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'could not load invoices');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const value = useMemo<Store>(() => ({
    invoices, loading, error, refresh,
    submit: async (text) => {
      const { invoice } = await api<{ invoice: Invoice }>('/api/invoices', { method: 'POST', body: JSON.stringify({ text }) });
      await refresh();
      return invoice;
    },
    humanDecide: async (uid, approve) => {
      await api(`/api/invoices/${encodeURIComponent(uid)}/decision`, { method: 'POST', body: JSON.stringify({ approve }) });
      await refresh();
    },
    reset: async () => {
      await api('/api/reset', { method: 'POST' });
      await refresh();
    },
  }), [invoices, loading, error, refresh]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore(): Store {
  const v = useContext(Ctx);
  if (!v) throw new Error('StoreProvider missing');
  return v;
}
