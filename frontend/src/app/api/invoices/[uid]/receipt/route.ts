import { NextResponse } from 'next/server';
import { receiptFor } from '@/server/engine';
import { fail, rateLimited, tooMany } from '@/server/guard';
import { requireSession, sessionFrom } from '@/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET: the stored receipt for a paid invoice, replayed from scratch against the registry just now. */
export async function GET(req: Request, { params }: { params: { uid: string } }) {
  if (rateLimited(req, 30)) return tooMany();
  try {
    const out = await receiptFor(decodeURIComponent(params.uid), requireSession(await sessionFrom(req)));
    return NextResponse.json(out);
  } catch (e) { return fail(e); }
}
