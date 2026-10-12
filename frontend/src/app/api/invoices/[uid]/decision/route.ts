import { NextResponse } from 'next/server';
import { releaseSimulated } from '@/server/engine';
import { fail, rateLimited, readJson, tooMany } from '@/server/guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST { approve: boolean }: a human decision. Approval can only clear the limit rule; every other rule must already pass. */
export async function POST(req: Request, { params }: { params: { uid: string } }) {
  if (rateLimited(req)) return tooMany();
  try {
    const body = (await readJson(req)) as { approve?: unknown };
    if (typeof body?.approve !== 'boolean') throw Object.assign(new Error('approve must be true or false'), { status: 400 });
    const inv = await releaseSimulated(decodeURIComponent(params.uid), body.approve);
    return inv ? NextResponse.json({ invoice: inv }) : NextResponse.json({ error: 'unknown invoice' }, { status: 404 });
  } catch (err) { return fail(err); }
}
