import { NextResponse } from 'next/server';
import { OcrError, ocrFile } from '../../../../../../agents/src/ocr';
import { fail, rateLimited, tooMany } from '@/server/guard';
import { assertSameOrigin, requireSession, sessionFrom } from '@/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const MAX_BYTES = 8 * 1024 * 1024;

/**
 * POST the raw bytes of a PNG, JPEG or scanned PDF (Content-Type image/png, image/jpeg or application/pdf).
 * Returns the text the OCR engine read. It does NOT run the agents: OCR can misread a digit or a wallet character, so the
 * app hands the text to a person to check and correct first, and only then is it submitted like any pasted invoice.
 */
export async function POST(req: Request) {
  if (rateLimited(req, 6)) return tooMany();
  try {
    assertSameOrigin(req);
    requireSession(await sessionFrom(req));
    const type = req.headers.get('content-type') ?? '';
    if (!/^(image\/(png|jpeg)|application\/pdf)/.test(type)) return NextResponse.json({ error: 'send a PNG, JPEG or PDF with its Content-Type' }, { status: 415 });
    if (Number(req.headers.get('content-length') ?? 0) > MAX_BYTES) return NextResponse.json({ error: 'The file is larger than 8 MB.' }, { status: 413 });
    const bytes = new Uint8Array(await req.arrayBuffer());
    if (bytes.length > MAX_BYTES) return NextResponse.json({ error: 'The file is larger than 8 MB.' }, { status: 413 });
    const text = await ocrFile(bytes);
    return NextResponse.json({ text, note: 'Read by OCR. Check every amount, date and wallet character before running the agents.' });
  } catch (e) {
    if (e instanceof OcrError) return NextResponse.json({ error: e.message }, { status: 422 });
    return fail(e);
  }
}
