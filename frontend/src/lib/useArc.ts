'use client';

import { useCallback, useEffect, useState } from 'react';
import type { ArcView } from '@/server/arc';

/** Client hook for /api/arc. The type import is erased at build time, so no server code reaches the browser. */
export function useArc() {
  const [view, setView] = useState<ArcView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (fresh = false) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/arc${fresh ? '?fresh=1' : ''}`);
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `request failed (${res.status})`);
      setView(body as ArcView);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'could not load the on-chain record');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  return { view, loading, error, reload: load };
}

export const ROLE_NAMES = ['Reader', 'Verifier', 'Matcher', 'Sentinel', 'Treasurer'];
export const EXPLORER = 'https://explorer.testnet.arc.io';
