import 'server-only';
import { NextResponse } from 'next/server';

/**
 * Basic abuse protection for the public demo routes: bodies are size-limited and callers are rate limited.
 * If model keys are configured, these routes can spend them, so keep the limits low and do not expose a
 * keyed deployment publicly without real authentication.
 */

const hits = new Map<string, number[]>();

export function rateLimited(req: Request, limit = 20, windowMs = 60_000): boolean {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'local';
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < windowMs);
  if (recent.length >= limit) { hits.set(ip, recent); return true; }
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 5_000) hits.clear();
  return false;
}

export const tooMany = () => NextResponse.json({ error: 'rate limited, try again in a minute' }, { status: 429 });

export async function readJson(req: Request, maxBytes = 64 * 1024): Promise<unknown> {
  const text = await req.text();
  if (Buffer.byteLength(text) > maxBytes) throw Object.assign(new Error('body too large'), { status: 413 });
  try { return JSON.parse(text); } catch { throw Object.assign(new Error('body must be JSON'), { status: 400 }); }
}

export function fail(e: unknown) {
  const status = (e as { status?: number })?.status;
  // Errors the app raises on purpose carry an HTTP status and a message meant for the person using it.
  if (status === 202) return NextResponse.json({ pending: true, message: (e as Error).message }, { status });
  if (typeof status === 'number' && status >= 400 && status < 600 && status !== 500) return NextResponse.json({ error: (e as Error).message }, { status });
  console.error('api error:', e instanceof Error ? e.message : e);
  return NextResponse.json({ error: 'internal error' }, { status: 500 });
}
