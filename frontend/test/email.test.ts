import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { InboundError, composeInvoiceText, normalizeInbound, tokenOk } from '../src/server/email';
import { parseInvoice } from '../../agents/src/parse';
import { invoicePdf } from '../../agents/test/pdf-helper';

const INVOICE = 'INVOICE INV-7\nIssued: 2026-10-13\nDue: 2026-10-20\nCurrency: USDC\nPay to wallet: 0x71c4000000000000000000000000000000009ae2\n\nDescription | Qty | Rate | Amount\nDesign hours | 10 | 0.125 | 1.25\n\nTotal: 1.25 USDC\n';

describe('inbound webhook token', () => {
  it('accepts only the exact configured secret, and never an unconfigured or short one', () => {
    const secret = 'a'.repeat(32);
    assert.equal(tokenOk(secret, secret), true);
    assert.equal(tokenOk('b'.repeat(32), secret), false);
    assert.equal(tokenOk(secret.slice(0, 31), secret), false);
    assert.equal(tokenOk(null, secret), false);
    assert.equal(tokenOk(secret, undefined), false);
    assert.equal(tokenOk('short', 'short'), false, 'a secret under 16 characters is treated as not configured');
  });
});

describe('normalising a message', () => {
  it('reads a Postmark inbound payload, including a base64 PDF attachment', () => {
    const pdf = Buffer.from(invoicePdf()).toString('base64');
    const m = normalizeInbound({
      FromFull: { Email: 'Billing@NorthwindDesign.example', Name: 'Northwind Design Co.' }, From: '"Northwind" <billing@northwinddesign.example>',
      Subject: 'Invoice INV-1041', TextBody: 'Hi, invoice attached.\r\nThanks', MessageID: 'abc-123',
      Attachments: [{ Name: 'inv.pdf', ContentType: 'application/pdf', Content: pdf, ContentLength: pdf.length }],
    });
    assert.equal(m.fromEmail, 'billing@northwinddesign.example');
    assert.equal(m.fromName, 'Northwind Design Co.');
    assert.equal(m.messageId, 'abc-123');
    assert.equal(m.text, 'Hi, invoice attached.\nThanks');
    assert.equal(m.attachments.length, 1);
    assert.equal(Buffer.from(m.attachments[0].bytes.subarray(0, 5)).toString(), '%PDF-');
  });

  it('reads the plain shape and falls back to the HTML body', () => {
    const m = normalizeInbound({ from: 'Acme <ap@acme.example>', subject: 'x', text: INVOICE, attachments: [{ filename: 'a.png', contentType: 'image/png', contentBase64: Buffer.from('png').toString('base64') }] });
    assert.equal(m.fromEmail, 'ap@acme.example');
    assert.equal(m.fromName, 'Acme');
    assert.equal(m.attachments[0].contentType, 'image/png');
    const h = normalizeInbound({ From: 'a@b.example', HtmlBody: '<p>Total: <b>5.00</b> USDC</p><script>alert(1)</script>' });
    assert.match(h.text, /Total: 5\.00 USDC/);
    assert.doesNotMatch(h.text, /alert/);
  });

  it('rejects a missing sender, a non-object, too many attachments and an oversized one', () => {
    assert.throws(() => normalizeInbound({ subject: 'no sender', text: 'x' }), InboundError);
    assert.throws(() => normalizeInbound({ from: 'not an email', text: 'x' }), /valid sender/);
    assert.throws(() => normalizeInbound('text'), /JSON object/);
    const a = { filename: 'a.pdf', contentType: 'application/pdf', contentBase64: 'AAAA' };
    assert.throws(() => normalizeInbound({ from: 'a@b.example', attachments: [a, a, a, a] }), /at most 3/);
    assert.throws(() => normalizeInbound({ from: 'a@b.example', attachments: [{ ...a, contentBase64: 'A'.repeat(12 * 1024 * 1024) }] }), /larger than 8 MB/);
  });
});

describe('building the invoice text', () => {
  const base = { messageId: null, fromEmail: 'billing@northwinddesign.example', fromName: 'Northwind Design Co.', subject: 'Invoice', attachments: [] };

  it('a body invoice with no From line gets the real sender prepended, so the Verifier can check the domain', () => {
    const t = composeInvoiceText({ ...base, text: INVOICE }, []);
    const p = parseInvoice(t);
    assert.equal(p.vendorName, 'Northwind Design Co.');
    assert.equal(p.senderEmail, 'billing@northwinddesign.example');
    assert.equal(p.invoiceNumber, 'INV-7');
    assert.equal(p.totalMicro, 1_250_000n);
  });

  it('an invoice that names its own sender is left alone (the email address is not allowed to rename the vendor)', () => {
    const t = composeInvoiceText({ ...base, text: `From: Real Vendor <ap@real.example>\n${INVOICE}` }, []);
    assert.equal(parseInvoice(t).vendorName, 'Real Vendor');
  });

  it('an attachment is the invoice and the email body becomes forwarded context, so a wallet-change note is seen', () => {
    const body = 'Hello, our payment wallet changed. New wallet: 0x99990000000000000000000000000000000099ff. Please update your records.';
    const t = composeInvoiceText({ ...base, text: body }, [INVOICE]);
    const p = parseInvoice(t);
    assert.equal(p.invoiceNumber, 'INV-7');
    assert.equal(p.payee, '0x71c4000000000000000000000000000000009ae2');
    assert.equal(p.changeRequest?.newWallet, '0x99990000000000000000000000000000000099ff');
    assert.equal(p.changeRequest?.fromEmail, 'billing@northwinddesign.example');
  });
});
