import { NextResponse } from 'next/server';
import { getEngine, submit } from '@/server/engine';
import { fail, rateLimited, readJson, tooMany } from '@/server/guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET: every invoice with the agents' real verdicts. */
export async function GET() {
  try {
    const e = await getEngine();
    return NextResponse.json({ invoices: e.invoices });
  } catch (err) { return fail(err); }
}

/** POST { text }: run an invoice through all five agents. */
export async function POST(req: Request) {
  if (rateLimited(req)) return tooMany();
  try {
    const body = (await readJson(req)) as { text?: unknown };
    if (typeof body?.text !== 'string' || body.text.trim().length < 20) throw Object.assign(new Error('text must be the invoice text (at least 20 characters)'), { status: 400 });
    if (body.text.length > 20_000) throw Object.assign(new Error('invoice text is limited to 20,000 characters'), { status: 413 });
    return NextResponse.json({ invoice: await submit(body.text) });
  } catch (err) { return fail(err); }
}
