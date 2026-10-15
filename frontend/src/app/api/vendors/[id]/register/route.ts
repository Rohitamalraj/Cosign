import { NextResponse } from 'next/server';
import { retryVendorRegistration } from '@/server/engine';
import { fail, rateLimited, tooMany } from '@/server/guard';
import { assertSameOrigin, requireSession, sessionFrom } from '@/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/** POST: retry allowlisting a saved vendor's wallet on-chain (admin). */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  if (rateLimited(req, 10)) return tooMany();
  try {
    assertSameOrigin(req);
    return NextResponse.json({ vendor: await retryVendorRegistration(decodeURIComponent(params.id), requireSession(await sessionFrom(req))) });
  } catch (e) { return fail(e); }
}
