import { NextResponse } from 'next/server';
import { listVisibleInvoices, submitInvoice } from '@/server/engine';
import { fail, rateLimited, readJson, tooMany } from '@/server/guard';
import { assertSameOrigin, requireSession, sessionFrom } from '@/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET: the invoices the signed-in wallet may see (operators and admins: all; others: their own). */
export async function GET(req: Request) {
  try { return NextResponse.json({ invoices: await listVisibleInvoices(await sessionFrom(req)) }); } catch (err) { return fail(err); }
}

/** POST { text }: run an invoice through the five agents. Requires a signed-in wallet; the result is stored. */
export async function POST(req: Request) {
  if (rateLimited(req)) return tooMany();
  try {
    assertSameOrigin(req);
    const session = requireSession(await sessionFrom(req));
    const body = (await readJson(req)) as { text?: unknown };
    if (typeof body?.text !== 'string' || body.text.trim().length < 20) throw Object.assign(new Error('text must be the invoice text (at least 20 characters)'), { status: 400 });
    if (body.text.length > 20_000) throw Object.assign(new Error('invoice text is limited to 20,000 characters'), { status: 413 });
    return NextResponse.json({ invoice: await submitInvoice(body.text, session) });
  } catch (err) { return fail(err); }
}
