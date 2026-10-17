/**
 * OCR for scanned invoices (photos, screenshots, image-only PDFs): pixels in, plain text out.
 *
 * OCR is the least trustworthy way to read an invoice: it can turn a 0 into an O or drop a digit from a wallet. So the
 * app never runs OCR text straight through the agents. It hands the text back for a person to read and correct, and only
 * then is it submitted like any pasted invoice. (And even then the Verifier only pays a wallet that matches the vendor
 * ledger exactly, so a misread address cannot redirect a payment.)
 *
 * The inputs are untrusted files, so: magic-byte checks, size, pixel and page caps, a wall-clock timeout, and the engine
 * runs in a worker that is always terminated.
 */
import { tmpdir } from 'node:os';
import { dirname, join, sep } from 'node:path';

export interface OcrLimits {
  maxBytes: number;
  maxPixels: number;
  maxPages: number;
  maxChars: number;
  timeoutMs: number;
}

export const DEFAULT_OCR_LIMITS: OcrLimits = { maxBytes: 8 * 1024 * 1024, maxPixels: 25_000_000, maxPages: 3, maxChars: 50_000, timeoutMs: 60_000 };

export class OcrError extends Error {}

/**
 * The canvas and OCR engines are native / worker based, so a bundler (Next.js) must not inline them. Loading them with a
 * runtime require from the working directory keeps them as ordinary node_modules packages in every environment.
 */
declare const __non_webpack_require__: NodeRequire | undefined;
// webpack rewrites createRequire() and require() in bundled code; __non_webpack_require__ is the real Node require it leaves alone.
// process.getBuiltinModule (Node 22+) is invisible to webpack's parser, unlike a direct createRequire() call.
const nativeRequire: NodeRequire = typeof __non_webpack_require__ !== 'undefined'
  ? __non_webpack_require__
  : (process as unknown as { getBuiltinModule: (n: string) => typeof import('node:module') }).getBuiltinModule('node:module').createRequire(join(process.cwd(), 'package.json'));

const isPng = (b: Uint8Array) => b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
const isJpeg = (b: Uint8Array) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
const isPdf = (b: Uint8Array) => Buffer.from(b.subarray(0, 1024)).toString('latin1').includes('%PDF-');

export const looksLikeImage = (b: Uint8Array): boolean => isPng(b) || isJpeg(b);
export const looksLikePdf = isPdf;

type Recognizer = { recognize(img: Buffer): Promise<{ data: { text: string } }>; terminate(): Promise<unknown> };

async function withWorker<T>(limits: OcrLimits, fn: (w: Recognizer) => Promise<T>): Promise<T> {
  const { createWorker } = nativeRequire('tesseract.js') as typeof import('tesseract.js');
  // The English language data is downloaded once and cached in the temp directory.
  const worker = (await createWorker('eng', 1, { cachePath: tmpdir(), logger: () => undefined })) as unknown as Recognizer;
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new OcrError('Reading the image took too long.')), limits.timeoutMs); });
  try {
    return await Promise.race([fn(worker), timeout]);
  } finally {
    clearTimeout(timer);
    await worker.terminate().catch(() => undefined);
  }
}

const clean = (text: string, limits: OcrLimits): string => text.replace(/\r/g, '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, limits.maxChars);

async function checkPixels(data: Uint8Array, limits: OcrLimits): Promise<void> {
  const { loadImage } = nativeRequire('@napi-rs/canvas') as typeof import('@napi-rs/canvas');
  let img;
  try { img = await loadImage(Buffer.from(data)); } catch { throw new OcrError('That image could not be read (it may be corrupt).'); }
  if (img.width * img.height > limits.maxPixels) throw new OcrError(`The image is too large (${img.width} x ${img.height} pixels).`);
}

/** Read text from a PNG or JPEG. */
export async function ocrImage(data: Uint8Array, opts: Partial<OcrLimits> = {}): Promise<string> {
  const limits = { ...DEFAULT_OCR_LIMITS, ...opts };
  if (data.length === 0) throw new OcrError('The file is empty.');
  if (data.length > limits.maxBytes) throw new OcrError(`The file is larger than ${Math.round(limits.maxBytes / 1024 / 1024)} MB.`);
  if (!looksLikeImage(data)) throw new OcrError('Only PNG and JPEG images are supported.');
  await checkPixels(data, limits);
  const text = clean(await withWorker(limits, async (w) => (await w.recognize(Buffer.from(data))).data.text), limits);
  if (text.replace(/\s/g, '').length < 10) throw new OcrError('No readable text was found in the image. Try a sharper, straighter photo.');
  return text;
}

/** Render the pages of a PDF to images and read them. Used for image-only (scanned) PDFs. */
export async function ocrPdf(data: Uint8Array, opts: Partial<OcrLimits> = {}): Promise<string> {
  const limits = { ...DEFAULT_OCR_LIMITS, ...opts };
  if (data.length === 0) throw new OcrError('The file is empty.');
  if (data.length > limits.maxBytes) throw new OcrError(`The file is larger than ${Math.round(limits.maxBytes / 1024 / 1024)} MB.`);
  if (!isPdf(data)) throw new OcrError('That does not look like a PDF.');

  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const g = globalThis as { pdfjsWorker?: unknown };
  // @ts-ignore pdf.js ships no type declarations for the worker entry point
  if (!g.pdfjsWorker) g.pdfjsWorker = await import('pdfjs-dist/legacy/build/pdf.worker.mjs');
  const canvasLib = nativeRequire('@napi-rs/canvas') as typeof import('@napi-rs/canvas');
  const { createCanvas } = canvasLib;
  // pdf.js draws glyphs with Path2D and friends. In Node it must use the same implementation as the canvas it draws on.
  const gl = globalThis as Record<string, unknown>;
  gl.Path2D = canvasLib.Path2D;
  gl.DOMMatrix ??= canvasLib.DOMMatrix;
  gl.ImageData ??= canvasLib.ImageData;
  // Non-embedded standard fonts (Helvetica and friends) need pdf.js's font files to be drawn at all.
  const fontDir = join(dirname(nativeRequire.resolve('pdfjs-dist/package.json')), 'standard_fonts') + sep;
  const task = pdfjs.getDocument({ data: new Uint8Array(data), isEvalSupported: false, verbosity: 0, standardFontDataUrl: fontDir });
  let doc;
  try { doc = await task.promise; }
  catch (e) { throw new OcrError((e as { name?: string })?.name === 'PasswordException' ? 'The PDF is password-protected.' : 'The PDF could not be read (it may be corrupt).'); }
  try {
    if (doc.numPages > limits.maxPages) throw new OcrError(`The PDF has ${doc.numPages} pages; OCR reads at most ${limits.maxPages}.`);
    const pages: Buffer[] = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const viewport = page.getViewport({ scale: 2 });
      if (viewport.width * viewport.height > limits.maxPixels) throw new OcrError('A PDF page is too large to read.');
      const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      // @ts-ignore napi-rs canvas is compatible with pdf.js rendering but not with its DOM typings
      await page.render({ canvasContext: ctx, viewport, canvas }).promise;
      pages.push(canvas.toBuffer('image/png'));
    }
    const text = clean(await withWorker(limits, async (w) => {
      const parts: string[] = [];
      for (const png of pages) parts.push((await w.recognize(png)).data.text);
      return parts.join('\n\n');
    }), limits);
    if (text.replace(/\s/g, '').length < 10) throw new OcrError('No readable text was found in the PDF.');
    return text;
  } finally {
    await doc.destroy().catch(() => undefined);
    await task.destroy().catch(() => undefined);
  }
}

/** Read text from a PNG, JPEG or scanned PDF, whichever it is. */
export async function ocrFile(data: Uint8Array, opts: Partial<OcrLimits> = {}): Promise<string> {
  if (looksLikeImage(data)) return ocrImage(data, opts);
  if (isPdf(data)) return ocrPdf(data, opts);
  throw new OcrError('Upload a PNG, JPEG or PDF.');
}
