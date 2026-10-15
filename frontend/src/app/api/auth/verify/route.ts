import { NextResponse } from 'next/server';
import { AuthError, signIn } from '@/server/auth';
import { getDb } from '@/server/engine';
import { fail, rateLimited, readJson, tooMany } from '@/server/guard';
import { assertSameOrigin, setSessionCookie, siteHost } from '@/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST { address, message, signature }: verify the signed message and open a session (httpOnly cookie). */
export async function POST(req: Request) {
  if (rateLimited(req, 20)) return tooMany();
  try {
    assertSameOrigin(req);
    const b = (await readJson(req)) as { address?: unknown; message?: unknown; signature?: unknown };
    if (typeof b?.address !== 'string' || typeof b.message !== 'string' || typeof b.signature !== 'string') throw Object.assign(new Error('address, message and signature are required'), { status: 400 });
    const { domain } = siteHost(req);
    try {
      const { token, session } = await signIn(await getDb(), { address: b.address, message: b.message, signature: b.signature, domain });
      return setSessionCookie(NextResponse.json({ session }), token, req);
    } catch (e) {
      if (e instanceof AuthError) throw Object.assign(new Error(e.message), { status: 401 });
      throw e;
    }
  } catch (e) { return fail(e); }
}
