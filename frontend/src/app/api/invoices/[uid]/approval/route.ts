import { NextResponse } from 'next/server';
import { approvalRequest } from '@/server/engine';
import { fail, rateLimited, tooMany } from '@/server/guard';
import { requireSession, sessionFrom } from '@/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET: the EIP-712 message the approver's wallet signs (eth_signTypedData_v4) to release an over-limit payment. */
export async function GET(req: Request, { params }: { params: { uid: string } }) {
  if (rateLimited(req, 30)) return tooMany();
  try {
    const session = requireSession(await sessionFrom(req));
    return NextResponse.json(await approvalRequest(decodeURIComponent(params.uid), session));
  } catch (e) { return fail(e); }
}
