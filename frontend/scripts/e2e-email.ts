/**
 * Tests the email-intake webhook against a running server: the token check, an invoice in the body, a retry of the same
 * message, a text PDF attachment, a scanned image (which must wait for a person, not run), a spoofed sender domain, and
 * the inbox API. No payment is made.
 *
 *   E2E_BASE_URL=http://localhost:3117 E2E_INBOUND_TOKEN=... E2E_ADMIN_KEY=0x... npx tsx scripts/e2e-email.ts
 * The server needs COSIGN_INBOUND_TOKEN set to the same value and the admin wallet in COSIGN_ADMIN_ADDRESSES.
 */
import { createCanvas } from '@napi-rs/canvas';
import { Wallet } from 'ethers';
import { invoicePdf } from '../../agents/test/pdf-helper';

const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:3117';
const TOKEN = process.env.E2E_INBOUND_TOKEN!;
let failures = 0;
const ok = (c: boolean, msg: string) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${msg}`); if (!c) failures++; };

async function post(path: string, body: unknown, headers: Record<string, string> = {}, cookie = '') {
  const res = await fetch(BASE + path, { method: 'POST', headers: { 'content-type': 'application/json', cookie, ...headers }, body: JSON.stringify(body) });
  const set = res.headers.get('set-cookie');
  return { status: res.status, body: (await res.json().catch(() => ({}))) as Record<string, any>, cookie: set ? set.split(';')[0] : cookie };
}

const tag = Date.now().toString().slice(-6);
const invoiceBody = (n: string) => `INVOICE ${n}\nIssued: 2026-10-16\nDue: 2026-12-01\nAgreement: SOW-22\nCurrency: USDC\nPay to wallet: 0x485cff12956519a597dcdb0cb0e1b37fe5b0246c\n\nDescription | Qty | Rate | Amount\nDesign hours - ${n} work | 8 | 0.125 | 1.00\n\nTotal: 1.00 USDC\nTerms: Net 7\n`;

async function main() {
  const hook = (body: unknown, token: string | null = TOKEN) => post('/api/intake/email', body, token ? { 'x-cosign-token': token } : {});

  ok((await hook({ from: 'a@b.example', text: 'x' }, null)).status === 401, 'no token is refused (401)');
  ok((await hook({ from: 'a@b.example', text: 'x' }, 'wrong-token-wrong-token')).status === 401, 'a wrong token is refused (401)');
  ok((await hook({ subject: 'no sender', text: 'x' })).status === 400, 'a message with no sender is rejected (400)');

  // 1. An invoice in the body, from the vendor's real domain.
  const n1 = `INV-MAIL-${tag}`;
  const m1 = { from: 'Northwind Design Co. <billing@northwinddesign.example>', subject: `Invoice ${n1}`, messageId: `msg-${tag}-1`, text: invoiceBody(n1) };
  const r1 = await hook(m1);
  ok(r1.status === 200 && r1.body.status === 'processed', `a body invoice becomes an invoice (${r1.body.status}, decision ${r1.body.decision})`);
  ok((await hook(m1)).body.status === 'duplicate', 'a provider retry of the same message id is ignored');

  // 2. A text PDF attachment.
  const pdf = Buffer.from(invoicePdf({ number: `INV-PDF-${tag}`, issued: '2026-10-16', due: '2026-12-01', rate: '0.125', total: '1.25', wallet: '0x485cff12956519a597dcdb0cb0e1b37fe5b0246c' })).toString('base64');
  const r2 = await hook({ from: 'billing@northwinddesign.example', subject: 'Invoice attached', messageId: `msg-${tag}-2`, text: 'Hello, please find the invoice attached.', attachments: [{ filename: 'invoice.pdf', contentType: 'application/pdf', contentBase64: pdf }] });
  ok(r2.body.status === 'processed', `a text PDF attachment is read and checked (${r2.body.status})`);

  // 3. A scanned image: OCR runs, but a person must check it before the agents do.
  const c = createCanvas(1000, 260);
  const g = c.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, 1000, 260); g.fillStyle = '#000'; g.font = '30px sans-serif';
  ['INVOICE INV-SCAN-1', 'From: Northwind Design Co. <billing@northwinddesign.example>', 'Total: 1.00 USDC'].forEach((l, i) => g.fillText(l, 30, 60 + i * 50));
  const r3 = await hook({ from: 'billing@northwinddesign.example', subject: 'Scan', messageId: `msg-${tag}-3`, text: 'photo of invoice', attachments: [{ filename: 'scan.png', contentType: 'image/png', contentBase64: c.toBuffer('image/png').toString('base64') }] });
  ok(r3.body.status === 'needs_review', `a scanned image waits for a person instead of running (${r3.body.status})`);

  // 4. A spoofed sender: same vendor name, wrong domain. The Verifier must not pass it.
  const n4 = `INV-SPOOF-${tag}`;
  const r4 = await hook({ from: 'Northwind Design Co. <billing@northw1nd-design.example>', subject: 'URGENT new bank details', messageId: `msg-${tag}-4`, text: invoiceBody(n4) });
  ok(r4.body.status === 'processed', 'a spoofed-domain invoice is still recorded');

  // 5. The inbox and invoice list, as an admin.
  const admin = new Wallet(process.env.E2E_ADMIN_KEY!);
  const ch = await post('/api/auth/challenge', { address: admin.address });
  const si = await post('/api/auth/verify', { address: admin.address, message: ch.body.message, signature: await admin.signMessage(ch.body.message) });
  const get = async (p: string) => (await fetch(BASE + p, { headers: { cookie: si.cookie } })).json() as Promise<Record<string, any>>;
  const inbox = await get('/api/intake');
  const items = inbox.items as { subject: string; status: string; ocr: boolean }[];
  ok(items.some((i) => i.status === 'new' && i.ocr), 'the inbox shows the OCR item as needing a check');
  ok(items.filter((i) => i.status === 'processed').length >= 3, 'processed messages are listed with their invoices');
  const inv = (await get('/api/invoices')).invoices as { id: string; status: string; decision: string; intake?: { channel: string; from: string }; attestations: { role: string; verdict: string }[] }[];
  const spoof = inv.find((i) => i.id === n4);
  ok(!!spoof?.intake && spoof.intake.from === 'billing@northw1nd-design.example', 'the emailed invoice is tagged with the real sender');
  ok(spoof?.attestations.find((a) => a.role === 'VERIFIER')?.verdict !== 'PASS', `the Verifier does not PASS a spoofed sender domain (${spoof?.attestations.find((a) => a.role === 'VERIFIER')?.verdict})`);
  ok(inv.some((i) => i.id === n1), 'the real-domain invoice is in the list');

  // The upload path: a scan is read by OCR and the TEXT comes back for a person to check; the agents do not run.
  const before = ((await get('/api/invoices')).invoices as unknown[]).length;
  const up = await fetch(BASE + '/api/invoices/ocr', { method: 'POST', headers: { 'content-type': 'image/png', cookie: si.cookie }, body: new Uint8Array(c.toBuffer('image/png')) });
  const upBody = (await up.json()) as { text?: string };
  ok(up.status === 200 && /INV-SCAN/.test(upBody.text ?? ''), `uploading a scan returns the OCR text (HTTP ${up.status}: ${JSON.stringify(upBody).slice(0, 160)})`);
  ok(((await get('/api/invoices')).invoices as unknown[]).length === before, 'reading a scan does not run the agents or create an invoice');
  ok((await fetch(BASE + '/api/invoices/ocr', { method: 'POST', headers: { 'content-type': 'text/plain', cookie: si.cookie }, body: 'hello' })).status === 415, 'a non-image upload is refused (415)');
  ok((await fetch(BASE + '/api/invoices/ocr', { method: 'POST', headers: { 'content-type': 'image/png' }, body: new Uint8Array(c.toBuffer('image/png')) })).status === 401, 'OCR needs a sign-in (401)');
  ok((await fetch(BASE + '/api/intake')).status === 401, 'the inbox needs a sign-in (401)');

  console.log(failures ? `\n${failures} CHECK(S) FAILED` : '\nALL EMAIL CHECKS PASSED');
  process.exit(failures ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
