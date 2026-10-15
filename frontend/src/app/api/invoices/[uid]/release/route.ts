import { NextResponse } from 'next/server';
import { releaseInvoice } from '@/server/engine';
import { fail, rateLimited, readJson, tooMany } from '@/server/guard';
import { assertSameOrigin, requireSession, sessionFrom } from '@/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/**
 * POST { approval?: { expiry, signature } }: pay the invoice on-chain. Operators and admins only. The Executor asks the
 * contract first and only sends if the eight rules pass; above the limit, `approval` must be the approver wallet's EIP-712 signature.
 */
export async function POST(req: Request, { params }: { params: { uid: string } }) {
  if (rateLimited(req, 10)) return tooMany();
  try {
    assertSameOrigin(req);
    const session = requireSession(await sessionFrom(req));
    const body = (await readJson(req).catch(() => ({}))) as { approval?: { expiry?: unknown; signature?: unknown } };
    let approval: { expiry: number; signature: string } | undefined;
    if (body?.approval) {
      if (!Number.isInteger(body.approval.expiry) || typeof body.approval.signature !== 'string' || !/^0x[0-9a-fA-F]{130}$/.test(body.approval.signature)) throw Object.assign(new Error('approval needs an integer expiry and a 65-byte signature'), { status: 400 });
      approval = { expiry: body.approval.expiry as number, signature: body.approval.signature };
    }
    return NextResponse.json({ invoice: await releaseInvoice(decodeURIComponent(params.uid), session, approval) });
  } catch (e) { return fail(e); }
}
