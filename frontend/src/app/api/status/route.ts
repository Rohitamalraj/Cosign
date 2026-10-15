import { NextResponse } from 'next/server';
import { getStatus } from '@/server/engine';
import { fail } from '@/server/guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET: whether this server is live or in preview, which contracts it talks to, and which models are configured. */
export async function GET() {
  try { return NextResponse.json(await getStatus()); } catch (e) { return fail(e); }
}
