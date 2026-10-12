import { NextResponse } from 'next/server';
import { resetEngine } from '@/server/engine';
import { fail, rateLimited, tooMany } from '@/server/guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST: put the demo ledger and the five demo cases back to their starting state. */
export async function POST(req: Request) {
  if (rateLimited(req, 5)) return tooMany();
  try {
    await resetEngine();
    return NextResponse.json({ ok: true });
  } catch (err) { return fail(err); }
}
