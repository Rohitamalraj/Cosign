import { NextResponse } from 'next/server';
import { rerunInvoice } from '@/server/engine';
import { fail, rateLimited, tooMany } from '@/server/guard';
import { assertSameOrigin, requireSession, sessionFrom } from '@/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST: run the stored invoice text through the agents again (fresh signatures, current ledger and chain state). */
export async function POST(req: Request, { params }: { params: { uid: string } }) {
  if (rateLimited(req, 10)) return tooMany();
  try {
    assertSameOrigin(req);
    const session = requireSession(await sessionFrom(req));
    return NextResponse.json({ invoice: await rerunInvoice(decodeURIComponent(params.uid), session) });
  } catch (e) { return fail(e); }
}
