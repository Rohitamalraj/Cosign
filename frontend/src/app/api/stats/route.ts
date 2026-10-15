import { NextResponse } from 'next/server';
import { getStats } from '@/server/engine';
import { fail, rateLimited, tooMany } from '@/server/guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET: aggregate counts and volumes across the whole workspace. No vendor names or invoice contents. */
export async function GET(req: Request) {
  if (rateLimited(req, 60)) return tooMany();
  try { return NextResponse.json(await getStats()); } catch (e) { return fail(e); }
}
