import { NextResponse } from 'next/server';
import { InboundError, normalizeInbound, tokenOk } from '@/server/email';
import { ingestEmail } from '@/server/engine';
import { fail, rateLimited, readJson, tooMany } from '@/server/guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/** The shared secret may arrive as a header, a ?token= query value, or the password of HTTP Basic auth (what Postmark's webhook URL form uses). */
function presentedToken(req: Request): string | null {
  const h = req.headers.get('x-cosign-token');
  if (h) return h;
  const q = new URL(req.url).searchParams.get('token');
  if (q) return q;
  const auth = req.headers.get('authorization');
  if (auth?.startsWith('Basic ')) {
    const decoded = Buffer.from(auth.slice(6), 'base64').toString();
    return decoded.slice(decoded.indexOf(':') + 1);
  }
  return null;
}

/**
 * POST: inbound email from your mail provider (Postmark inbound JSON, or the plain { from, subject, text, attachments } shape).
 * It becomes an invoice the agents check. It never pays anything, and OCR'd attachments wait in the inbox for a person.
 */
export async function POST(req: Request) {
  if (rateLimited(req, 60)) return tooMany();
  try {
    const expected = process.env.COSIGN_INBOUND_TOKEN;
    if (!expected) return NextResponse.json({ error: 'email intake is not configured on this server' }, { status: 503 });
    if (!tokenOk(presentedToken(req), expected)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    const msg = normalizeInbound(await readJson(req, 14 * 1024 * 1024));
    const out = await ingestEmail(msg);
    // 200 even when a message could not be read: a 4xx/5xx makes providers retry the same message for hours.
    return NextResponse.json(out);
  } catch (e) {
    if (e instanceof InboundError) return NextResponse.json({ error: e.message }, { status: 400 });
    return fail(e);
  }
}
