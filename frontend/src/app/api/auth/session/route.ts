import { NextResponse } from 'next/server';
import { fail } from '@/server/guard';
import { sessionFrom } from '@/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET: who is signed in (null when nobody is). */
export async function GET(req: Request) {
  try { return NextResponse.json({ session: await sessionFrom(req) }); } catch (e) { return fail(e); }
}
