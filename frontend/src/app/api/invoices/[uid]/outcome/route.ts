import { NextResponse } from 'next/server';
import { OUTCOME_KINDS, type OutcomeKind } from '@/server/auditor';
import { listOutcomes, reportOutcome, getDb } from '@/server/engine';
import { fail, rateLimited, readJson, tooMany } from '@/server/guard';
import { assertSameOrigin, requireSession, sessionFrom } from '@/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/** GET: the outcome reported for this invoice, if any, and the kinds that can be reported. */
export async function GET(req: Request, { params }: { params: { uid: string } }) {
  try {
    requireSession(await sessionFrom(req));
    return NextResponse.json({ outcomes: await listOutcomes(await getDb(), decodeURIComponent(params.uid)), kinds: OUTCOME_KINDS });
  } catch (e) { return fail(e); }
}

/** POST { kind, note }: tell the Auditor what really happened. It changes agent scores (and slashes bonds) on-chain, once per invoice. */
export async function POST(req: Request, { params }: { params: { uid: string } }) {
  if (rateLimited(req, 10)) return tooMany();
  try {
    assertSameOrigin(req);
    const session = requireSession(await sessionFrom(req));
    const b = (await readJson(req)) as { kind?: unknown; note?: unknown };
    if (typeof b?.kind !== 'string') throw Object.assign(new Error('kind is required'), { status: 400 });
    return NextResponse.json({ outcome: await reportOutcome(decodeURIComponent(params.uid), b.kind as OutcomeKind, typeof b.note === 'string' ? b.note : '', session) });
  } catch (e) { return fail(e); }
}
