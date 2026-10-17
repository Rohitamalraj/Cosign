import { NextResponse } from 'next/server';
import { PdfError, PdfNoTextError } from '../../../../../../agents/src/pdf';
import { submitPdf } from '@/server/engine';
import { fail, rateLimited, tooMany } from '@/server/guard';
import { assertSameOrigin, requireSession, sessionFrom } from '@/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_BYTES = 5 * 1024 * 1024;

/** POST the raw bytes of a text-based PDF (Content-Type: application/pdf). A scanned PDF answers 422 with needsOcr, and the client then uses /api/invoices/ocr. */
export async function POST(req: Request) {
  if (rateLimited(req, 10)) return tooMany();
  try {
    assertSameOrigin(req);
    const session = requireSession(await sessionFrom(req));
    if (!(req.headers.get('content-type') ?? '').startsWith('application/pdf')) {
      return NextResponse.json({ error: 'send the PDF with Content-Type: application/pdf' }, { status: 415 });
    }
    const declared = Number(req.headers.get('content-length') ?? 0);
    if (declared > MAX_BYTES) return NextResponse.json({ error: 'The PDF is larger than 5 MB.' }, { status: 413 });
    const bytes = new Uint8Array(await req.arrayBuffer());
    if (bytes.length > MAX_BYTES) return NextResponse.json({ error: 'The PDF is larger than 5 MB.' }, { status: 413 });
    return NextResponse.json({ invoice: await submitPdf(bytes, session) });
  } catch (e) {
    if (e instanceof PdfNoTextError) return NextResponse.json({ error: e.message, needsOcr: true }, { status: 422 });
    if (e instanceof PdfError) {
      if (e.cause) console.error('pdf error cause:', e.cause instanceof Error ? `${e.cause.name}: ${e.cause.message}` : e.cause);
      return NextResponse.json({ error: e.message }, { status: 422 });
    }
    return fail(e);
  }
}
