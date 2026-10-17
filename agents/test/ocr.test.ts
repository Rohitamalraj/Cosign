import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createCanvas } from '@napi-rs/canvas';
import { OcrError, looksLikeImage, ocrFile, ocrImage, ocrPdf } from '../src/ocr';
import { parseInvoice } from '../src/parse';
import { invoicePdf, makeTextPdf } from './pdf-helper';

function png(lines: string[], opts: { w?: number; h?: number; blank?: boolean } = {}): Uint8Array {
  const c = createCanvas(opts.w ?? 1000, opts.h ?? 60 + lines.length * 50);
  const g = c.getContext('2d');
  g.fillStyle = '#fff';
  g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = '#000';
  g.font = '30px sans-serif';
  if (!opts.blank) lines.forEach((l, i) => g.fillText(l, 30, 55 + i * 50));
  return new Uint8Array(c.toBuffer('image/png'));
}

describe('OCR of an image', () => {
  it('reads a photo-like invoice image', async () => {
    const text = await ocrImage(png(['INVOICE INV-4821', 'From: Acme Print <billing@acme.example>', 'Total: 125.50 USDC']));
    assert.match(text, /INV-4821/);
    assert.match(text, /billing@acme\.example/);
    assert.match(text, /125\.50/);
  });

  it('rejects an empty file, a wrong type, a blank image and a corrupt image with a clear message', async () => {
    await assert.rejects(ocrImage(new Uint8Array()), /empty/);
    await assert.rejects(ocrImage(new Uint8Array(Buffer.from('GIF89a not supported'))), /PNG and JPEG/);
    await assert.rejects(ocrImage(png([], { blank: true })), /No readable text/);
    const corrupt = new Uint8Array(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 7)]));
    await assert.rejects(ocrImage(corrupt), OcrError);
  });

  it('enforces the size and pixel caps before running the engine', async () => {
    await assert.rejects(ocrImage(png(['hello world this is text']), { maxBytes: 100 }), /larger than/);
    await assert.rejects(ocrImage(png(['hello world this is text'], { w: 2000, h: 2000 }), { maxPixels: 1_000_000 }), /too large/);
  });

  it('looksLikeImage recognises PNG and JPEG only', () => {
    assert.equal(looksLikeImage(png(['x'])), true);
    assert.equal(looksLikeImage(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0])), true);
    assert.equal(looksLikeImage(new Uint8Array(Buffer.from('%PDF-1.4'))), false);
  });
});

describe('OCR of a PDF (pages rendered to images)', () => {
  it('reads a rendered invoice, and the parser then recovers every field including the line item', async () => {
    const text = await ocrPdf(invoicePdf());
    const p = parseInvoice(text);
    assert.equal(p.invoiceNumber, 'INV-1041');
    assert.equal(p.vendorName, 'Northwind Design Co.');
    assert.equal(p.payee, '0x71c4000000000000000000000000000000009ae2');
    assert.equal(p.totalMicro, 1_250_000_000n);
    assert.equal(p.due, '2026-10-20');
    assert.equal(p.lineItems.length, 1, 'OCR drops the | separators; the parser reads the spaced table');
    assert.equal(p.lineItems[0].qty, 10);
    assert.equal(p.lineItems[0].amountMicro, 1_250_000_000n);
  });

  it('refuses a non-PDF, a too-long PDF and a corrupt PDF', async () => {
    await assert.rejects(ocrPdf(new Uint8Array(Buffer.from('not a pdf'))), /does not look like a PDF/);
    await assert.rejects(ocrPdf(invoicePdf(), { maxPages: 0 }), /pages/);
    await assert.rejects(ocrPdf(new Uint8Array(Buffer.from('%PDF-1.4\ngarbage\n%%EOF'))), OcrError);
  });

  it('ocrFile picks the right path from the bytes', async () => {
    assert.match(await ocrFile(png(['INVOICE INV-9 total 5.00 USDC please'])), /INVOICE/);
    assert.match(await ocrFile(makeTextPdf([{ text: 'Pay to wallet: 0x71c4000000000000000000000000000000009ae2', x: 50, y: 700 }])), /Pay to wallet/);
    await assert.rejects(ocrFile(new Uint8Array(Buffer.from('plain text'))), /PNG, JPEG or PDF/);
  });
});

describe('invoice tables without column separators', () => {
  const base = 'INVOICE INV-1\nFrom: V <v@v.example>\nTotal: 10.00 USDC\n';
  it('reads "description qty rate amount" rows and skips headers and totals rows', () => {
    const p = parseInvoice(`${base}\nDescription Qty Rate Amount\nDesign hours - sprint 4 2.50 10.00\nTotal 10.00 10.00 10.00\n`);
    assert.equal(p.lineItems.length, 1);
    assert.equal(p.lineItems[0].description, 'Design hours - sprint');
    assert.equal(p.lineItems[0].amountMicro, 10_000_000n);
  });

  it('still prefers the pipe table when there is one', () => {
    const p = parseInvoice(`${base}\nDescription | Qty | Rate | Amount\nDesign hours | 4 | 2.50 | 10.00\n`);
    assert.equal(p.lineItems.length, 1);
    assert.equal(p.lineItems[0].description, 'Design hours');
  });
});
