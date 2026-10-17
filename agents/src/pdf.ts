/**
 * PDF -> text, for text-based PDFs only. A scanned (image-only) PDF yields no text here and throws PdfNoTextError;
 * the caller then runs OCR (ocr.ts) and shows the result to a person to check, rather than guessing.
 *
 * A PDF is untrusted input, so: size and page caps, a wall-clock timeout, a magic-byte check, pdf.js eval disabled,
 * and the output is plain text that goes through the same deterministic parser as a pasted invoice.
 */

export interface PdfLimits {
  maxBytes: number;
  maxPages: number;
  maxChars: number;
  timeoutMs: number;
}

export const DEFAULT_PDF_LIMITS: PdfLimits = { maxBytes: 5 * 1024 * 1024, maxPages: 10, maxChars: 50_000, timeoutMs: 20_000 };

export class PdfError extends Error {}
/** The PDF opened fine but has no text layer: it is a scan, and needs OCR (see ocr.ts). */
export class PdfNoTextError extends PdfError {}

interface TextItem { str: string; transform: number[]; width: number }

/** Items on the same baseline form a line; a wide horizontal gap becomes " | " so table rows keep their columns. */
export function itemsToLines(items: TextItem[], gap = 14): string[] {
  const rows = new Map<number, TextItem[]>();
  for (const it of items) {
    if (!it.str.trim()) continue;
    const y = Math.round(it.transform[5] / 3); // ~3pt tolerance for the baseline
    const row = rows.get(y) ?? [];
    row.push(it);
    rows.set(y, row);
  }
  return [...rows.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([, row]) => {
      row.sort((a, b) => a.transform[4] - b.transform[4]);
      let out = '';
      let prevEnd = Number.NEGATIVE_INFINITY;
      for (const it of row) {
        const x = it.transform[4];
        if (out) out += x - prevEnd > gap ? ' | ' : ' ';
        out += it.str.trim();
        prevEnd = x + it.width;
      }
      return out;
    });
}

export async function pdfToText(data: Uint8Array, limits: Partial<PdfLimits> = {}): Promise<string> {
  const lim = { ...DEFAULT_PDF_LIMITS, ...limits };
  if (data.length === 0) throw new PdfError('The file is empty.');
  if (data.length > lim.maxBytes) throw new PdfError(`The PDF is larger than ${Math.round(lim.maxBytes / 1024 / 1024)} MB.`);
  const head = Buffer.from(data.subarray(0, 1024)).toString('latin1');
  if (!head.includes('%PDF-')) throw new PdfError('That does not look like a PDF.');

  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  // Hand pdf.js its worker module directly. By default it locates the worker by file path, which breaks when a
  // bundler (Next.js) relocates this code. With the module already on globalThis it runs the worker in-process.
  const g = globalThis as { pdfjsWorker?: unknown };
  // @ts-ignore pdf.js ships no type declarations for the worker entry point
  if (!g.pdfjsWorker) g.pdfjsWorker = await import('pdfjs-dist/legacy/build/pdf.worker.mjs');
  const task = pdfjs.getDocument({ data: new Uint8Array(data), useSystemFonts: true, isEvalSupported: false, disableFontFace: true, verbosity: 0 });

  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new PdfError('Reading the PDF took too long.')), lim.timeoutMs); });

  const work = (async () => {
    let doc;
    try { doc = await task.promise; }
    catch (e) {
      const name = (e as { name?: string })?.name;
      throw new PdfError(name === 'PasswordException' ? 'The PDF is password-protected.' : 'The PDF could not be read (it may be corrupt).', { cause: e });
    }
    try {
      if (doc.numPages > lim.maxPages) throw new PdfError(`The PDF has ${doc.numPages} pages; the limit is ${lim.maxPages}.`);
      const lines: string[] = [];
      for (let n = 1; n <= doc.numPages; n++) {
        const page = await doc.getPage(n);
        const content = await page.getTextContent();
        lines.push(...itemsToLines(content.items.filter((i): i is typeof i & TextItem => 'str' in i) as TextItem[]));
      }
      const text = lines.join('\n');
      if (text.replace(/\s/g, '').length < 20) throw new PdfNoTextError('No text found. This looks like a scanned image, so it needs OCR.');
      return text.slice(0, lim.maxChars);
    } finally {
      await doc.destroy().catch(() => undefined);
    }
  })();

  try {
    return await Promise.race([work, timeout]);
  } finally {
    clearTimeout(timer);
    await task.destroy().catch(() => undefined);
  }
}
