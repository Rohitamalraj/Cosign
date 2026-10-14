import { NextResponse } from 'next/server';
import { PdfError } from '../../../../../../agents/src/pdf';
import { submitPdf } from '@/server/engine';
import { fail, rateLimited, tooMany } from '@/server/guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_BYTES = 5 * 1024 * 1024;

/** POST the raw bytes of a text-based PDF (Content-Type: application/pdf). Scans are rejected: OCR is not built. */
export async function POST(req: Request) {
  if (rateLimited(req, 10)) return tooMany();
  try {
    if (!(req.headers.get('content-type') ?? '').startsWith('application/pdf')) {
      return NextResponse.json({ error: 'send the PDF with Content-Type: application/pdf' }, { status: 415 });
    }
    const declared = Number(req.headers.get('content-length') ?? 0);
    if (declared > MAX_BYTES) return NextResponse.json({ error: 'The PDF is larger than 5 MB.' }, { status: 413 });
    const bytes = new Uint8Array(await req.arrayBuffer());
    if (bytes.length > MAX_BYTES) return NextResponse.json({ error: 'The PDF is larger than 5 MB.' }, { status: 413 });
    return NextResponse.json({ invoice: await submitPdf(bytes) });
  } catch (e) {
    if (e instanceof PdfError) {
      if (e.cause) console.error('pdf error cause:', e.cause instanceof Error ? `${e.cause.name}: ${e.cause.message}` : e.cause);
      return NextResponse.json({ error: e.message }, { status: 422 });
    }
    return fail(e);
  }
}
