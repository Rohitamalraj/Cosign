import { NextResponse } from 'next/server';
import { listIntakeItems } from '@/server/engine';
import { fail } from '@/server/guard';
import { requireSession, sessionFrom } from '@/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET: the email inbox (operators and admins). */
export async function GET(req: Request) {
  try { return NextResponse.json({ items: await listIntakeItems(requireSession(await sessionFrom(req))), configured: !!process.env.COSIGN_INBOUND_TOKEN }); }
  catch (e) { return fail(e); }
}
