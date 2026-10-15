import { NextResponse } from 'next/server';
import { createChallenge } from '@/server/auth';
import { getDb } from '@/server/engine';
import { fail, rateLimited, readJson, tooMany } from '@/server/guard';
import { assertSameOrigin, siteHost } from '@/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST { address }: the message the wallet must sign to sign in. */
export async function POST(req: Request) {
  if (rateLimited(req, 20)) return tooMany();
  try {
    assertSameOrigin(req);
    const body = (await readJson(req)) as { address?: unknown };
    if (typeof body?.address !== 'string') throw Object.assign(new Error('address is required'), { status: 400 });
    const { domain, uri } = siteHost(req);
    let ch;
    try { ch = await createChallenge(await getDb(), { address: body.address, domain, uri, chainId: 5042002 }); }
    catch { throw Object.assign(new Error('that is not a valid address'), { status: 400 }); }
    return NextResponse.json({ message: ch.message, expiresAt: ch.expiresAt });
  } catch (e) { return fail(e); }
}
