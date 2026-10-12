'use client';

import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { invoices as seed, type Invoice } from './data';

interface Store {
  invoices: Invoice[];
  humanDecide: (id: string, approve: boolean) => void;
}

const Ctx = createContext<Store | null>(null);

// In-memory only. Swap for real API calls when the backend exists.
export function StoreProvider({ children }: { children: ReactNode }) {
  const [invoices, setInvoices] = useState<Invoice[]>(seed);

  const value = useMemo<Store>(
    () => ({
      invoices,
      humanDecide: (id, approve) =>
        setInvoices((list) =>
          list.map((inv) => {
            if (inv.id !== id) return inv;
            if (!approve) return { ...inv, status: 'held', humanSig: undefined };
            // Human approval satisfies rule 6 only; every other rule still has to be green.
            const others = Object.entries(inv.ruleOverrides).filter(([n, s]) => Number(n) !== 6 && s !== 'pass');
            if (others.length) return inv;
            const { 6: _removed, ...rest } = inv.ruleOverrides;
            return {
              ...inv,
              status: 'released',
              ruleOverrides: rest,
              humanSig: '0x7c2e…f1b9 (owner)',
              tx: '0xa3d6f2…9e04',
            };
          }),
        ),
    }),
    [invoices],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore(): Store {
  const v = useContext(Ctx);
  if (!v) throw new Error('StoreProvider missing');
  return v;
}
