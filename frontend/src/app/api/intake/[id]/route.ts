import { NextResponse } from 'next/server';
import { updateIntakeItem } from '@/server/engine';
import { fail, rateLimited, readJson, tooMany } from '@/server/guard';
import { assertSameOrigin, requireSession, sessionFrom } from '@/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST { action: "dismiss" | "processed", invoiceUid? }: clear an inbox item (operators and admins). */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  if (rateLimited(req, 30)) return tooMany();
  try {
    assertSameOrigin(req);
    const s = requireSession(await sessionFrom(req));
    const b = (await readJson(req)) as { action?: unknown; invoiceUid?: unknown };
    if (b?.action !== 'dismiss' && b?.action !== 'processed') throw Object.assign(new Error('action must be dismiss or processed'), { status: 400 });
    const id = Number(params.id);
    if (!Number.isInteger(id) || id <= 0) throw Object.assign(new Error('bad id'), { status: 400 });
    await updateIntakeItem(id, b.action, typeof b.invoiceUid === 'string' ? b.invoiceUid : null, s);
    return NextResponse.json({ ok: true });
  } catch (e) { return fail(e); }
}
