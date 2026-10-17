/**
 * Inbound email, as a way for invoices to arrive. A mail provider (Postmark, or anything that can POST JSON) calls the
 * webhook with each message; this module normalises it and builds the text the agents read.
 *
 * Trust model, because email is the easiest channel to forge:
 *  - the webhook needs a shared secret (COSIGN_INBOUND_TOKEN), so only your provider can call it;
 *  - the sender address is only a claim. The Verifier compares its domain to the registered vendor's domain and holds the
 *    invoice if they differ, and a wallet-change request in an email is always held behind a cooling-off and a challenge;
 *  - nothing is ever paid because of an email. It becomes an invoice that an operator must still choose to pay;
 *  - text read from a scan by OCR is not run automatically: it waits in the inbox for a person to check it.
 * No framework imports here, so plain `node --test` can use it.
 */
import { timingSafeEqual } from 'node:crypto';

export const MAX_BODY_CHARS = 100_000;
export const MAX_ATTACHMENTS = 3;
export const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024;

export interface InboundAttachment { name: string; contentType: string; bytes: Uint8Array }

export interface InboundMessage {
  messageId: string | null;
  fromEmail: string;
  fromName: string;
  subject: string;
  text: string;
  attachments: InboundAttachment[];
}

export class InboundError extends Error {
  status = 400;
}

const EMAIL = /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/;

/** Constant-time comparison of the presented token against the configured one. */
export function tokenOk(presented: string | null | undefined, expected: string | undefined): boolean {
  if (!expected || expected.length < 16 || !presented) return false;
  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

const stripHtml = (html: string): string => html.replace(/<(style|script)[\s\S]*?<\/\1>/gi, ' ').replace(/<br\s*\/?>|<\/(p|div|tr|li|h\d)>/gi, '\n').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n\n').trim();

function decodeAttachment(name: unknown, type: unknown, b64: unknown): InboundAttachment | null {
  if (typeof b64 !== 'string' || typeof name !== 'string') return null;
  if (b64.length > Math.ceil((MAX_ATTACHMENT_BYTES * 4) / 3) + 8) throw new InboundError(`attachment "${name.slice(0, 60)}" is larger than 8 MB`);
  const bytes = new Uint8Array(Buffer.from(b64, 'base64'));
  if (bytes.length > MAX_ATTACHMENT_BYTES) throw new InboundError(`attachment "${name.slice(0, 60)}" is larger than 8 MB`);
  return { name: name.slice(0, 120), contentType: typeof type === 'string' ? type.toLowerCase() : 'application/octet-stream', bytes };
}

/**
 * Accepts the Postmark inbound webhook shape (From, FromName, Subject, TextBody/HtmlBody, MessageID, Attachments[]) and a
 * plain shape for anything else: { from, fromName?, subject?, text, messageId?, attachments?: [{ filename, contentType, contentBase64 }] }.
 */
export function normalizeInbound(payload: unknown): InboundMessage {
  if (!payload || typeof payload !== 'object') throw new InboundError('the body must be a JSON object');
  const p = payload as Record<string, unknown>;
  const isPostmark = typeof p.From === 'string' || typeof p.FromFull === 'object';
  const full = (p.FromFull as { Email?: unknown; Name?: unknown } | undefined) ?? {};

  const fromRaw = String(isPostmark ? (full.Email ?? p.From ?? '') : (p.from ?? '')).trim();
  const angle = fromRaw.match(/<([^>]+)>/);
  const fromEmail = (angle ? angle[1] : fromRaw).trim().toLowerCase();
  if (!EMAIL.test(fromEmail)) throw new InboundError('the message has no valid sender address');
  const fromName = String((isPostmark ? (full.Name ?? p.FromName) : p.fromName) ?? (angle ? fromRaw.slice(0, angle.index).trim() : '')).replace(/["<>]/g, '').trim().slice(0, 120);

  const textRaw = isPostmark ? (typeof p.TextBody === 'string' && p.TextBody.trim() ? p.TextBody : typeof p.HtmlBody === 'string' ? stripHtml(p.HtmlBody) : '') : (typeof p.text === 'string' ? p.text : '');
  const subject = String((isPostmark ? p.Subject : p.subject) ?? '').slice(0, 200);
  const messageId = (isPostmark ? p.MessageID : p.messageId) ? String(isPostmark ? p.MessageID : p.messageId).slice(0, 200) : null;

  const rawAtt = (isPostmark ? p.Attachments : p.attachments) as unknown;
  const list = Array.isArray(rawAtt) ? rawAtt : [];
  if (list.length > MAX_ATTACHMENTS) throw new InboundError(`at most ${MAX_ATTACHMENTS} attachments are read`);
  const attachments = list
    .map((a: Record<string, unknown>) => (isPostmark ? decodeAttachment(a.Name, a.ContentType, a.Content) : decodeAttachment(a.filename, a.contentType, a.contentBase64)))
    .filter((a): a is InboundAttachment => !!a);

  return { messageId, fromEmail, fromName, subject, text: textRaw.slice(0, MAX_BODY_CHARS).replace(/\r\n/g, '\n').trim(), attachments };
}

/**
 * The text the agents read for a message: the invoice (an attachment, or the body) first, then the email itself as
 * forwarded context, so a "our wallet changed" note in the body is picked up by the change-request rules.
 */
export function composeInvoiceText(msg: InboundMessage, attachmentTexts: string[]): string {
  const hasFrom = (t: string) => /^\s*From\s*:/im.test(t);
  const sender = msg.fromName ? `${msg.fromName} <${msg.fromEmail}>` : msg.fromEmail;
  const invoicePart = attachmentTexts.length ? attachmentTexts.join('\n\n') : msg.text;
  const head = hasFrom(invoicePart) ? invoicePart : `From: ${sender}\n${invoicePart}`;
  if (!attachmentTexts.length || !msg.text.trim()) return head;
  return `${head}\n\n--- Forwarded message ---\nFrom: ${sender}\nSubject: ${msg.subject}\n\n${msg.text}`;
}
