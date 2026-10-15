import 'server-only';
import { NextResponse } from 'next/server';
import { getSession, type Session } from './auth';
import { getDb } from './engine';

export const COOKIE = 'cosign_session';

export function readCookie(req: Request, name: string): string | null {
  const raw = req.headers.get('cookie');
  if (!raw) return null;
  for (const part of raw.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}

export async function sessionFrom(req: Request): Promise<Session | null> {
  return getSession(await getDb(), readCookie(req, COOKIE));
}

export function requireSession(s: Session | null): Session {
  if (!s) throw Object.assign(new Error('Sign in with your wallet first.'), { status: 401 });
  return s;
}

export const isSecure = (req: Request) => (req.headers.get('x-forwarded-proto') ?? new URL(req.url).protocol.replace(':', '')) === 'https';

export function setSessionCookie(res: NextResponse, token: string | null, req: Request, maxAgeSec = 12 * 3600): NextResponse {
  const attrs = ['Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${token ? maxAgeSec : 0}`];
  if (isSecure(req)) attrs.push('Secure');
  res.headers.append('Set-Cookie', `${COOKIE}=${token ? encodeURIComponent(token) : ''}; ${attrs.join('; ')}`);
  return res;
}

/** The site's own host, used as the sign-in domain. */
export function siteHost(req: Request): { domain: string; uri: string } {
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? new URL(req.url).host;
  const proto = req.headers.get('x-forwarded-proto') ?? new URL(req.url).protocol.replace(':', '');
  return { domain: host, uri: `${proto}://${host}` };
}

/**
 * Browsers attach the session cookie to cross-site requests unless told not to. SameSite=Lax already blocks most of
 * that for POST; this also rejects a POST whose Origin is another site, as a second layer.
 */
export function assertSameOrigin(req: Request): void {
  if (req.method === 'GET' || req.method === 'HEAD') return;
  const origin = req.headers.get('origin');
  if (!origin) return; // non-browser clients (curl, MCP) send none; they cannot ride a browser cookie
  const { domain } = siteHost(req);
  if (new URL(origin).host !== domain) throw Object.assign(new Error('cross-site request refused'), { status: 403 });
}
