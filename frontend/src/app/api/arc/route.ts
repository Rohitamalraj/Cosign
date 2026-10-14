import { NextResponse } from 'next/server';
import { getArcView } from '@/server/arc';
import { fail, rateLimited, tooMany } from '@/server/guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET: the recorded Arc testnet run, re-verified against the chain (cached 30s). `?fresh=1` forces a re-check. */
export async function GET(req: Request) {
  if (rateLimited(req, 30)) return tooMany();
  try {
    const fresh = new URL(req.url).searchParams.get('fresh') === '1';
    return NextResponse.json(await getArcView(fresh));
  } catch (e) { return fail(e); }
}
