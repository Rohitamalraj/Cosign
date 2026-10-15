import { NextResponse } from 'next/server';
import { signOut } from '@/server/auth';
import { getDb } from '@/server/engine';
import { fail } from '@/server/guard';
import { COOKIE, assertSameOrigin, readCookie, setSessionCookie } from '@/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    assertSameOrigin(req);
    await signOut(await getDb(), readCookie(req, COOKIE));
    return setSessionCookie(NextResponse.json({ ok: true }), null, req);
  } catch (e) { return fail(e); }
}
