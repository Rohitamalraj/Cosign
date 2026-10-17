# Email intake and OCR

Invoices can arrive three ways beyond pasting text: a **text PDF**, a **scan or photo** (PNG, JPEG, or an image-only PDF), and **email**. This page says how each works, what is automatic, and what a person always checks.

## The rule that matters

- **Nothing is ever paid because of an email.** An emailed invoice becomes an invoice in the inbox that the agents check. An operator still has to open it and press Pay (and over the limit, the approver's wallet signs).
- **OCR text is never run automatically.** OCR can turn an `@` into `®` or a `1` into `I` (our own test did exactly that). So text read from a scan is shown to a person to check and correct, and only then submitted like any pasted invoice.
- **The sender address is only a claim.** The Verifier compares the sender's domain to the registered vendor's domain and holds the invoice if they differ. A wallet-change request in an email is always held behind a cooling-off and a challenge. The vendor wallet must also match the ledger exactly, so a misread or forged address cannot redirect a payment.

## Uploading a scan (no email needed)

In **Invoices**, press **Upload a PDF or scan**.
- A text PDF goes straight to the agents.
- A PNG, a JPEG, or a PDF with no text layer is read by OCR. The text appears in the box with a notice. Fix any misread characters, then press **Run the five agents**.
- Limits: 8 MB, 25 million pixels, 3 pages for PDFs. Rate limited per user.

## Email intake

### 1. Set the shared secret
Pick a random value of 16+ characters and set it on the server:

```
COSIGN_INBOUND_TOKEN=<random string>
```
Without it the webhook answers `503 email intake is not configured`.

### 2. Point your mail provider at the webhook
The endpoint is `POST https://<your-server>/api/intake/email`. It accepts the secret as the `x-cosign-token` header, a `?token=` query value, or the password of HTTP Basic auth.

**Postmark (inbound):**
1. Create an inbound stream and note its inbound address, or set an MX record for a subdomain you own (for example `invoices.yourcompany.com`) as Postmark's docs describe.
2. In the stream's settings, set the webhook URL to `https://anything:<COSIGN_INBOUND_TOKEN>@<your-server>/api/intake/email`.
3. Forward or CC invoices to the inbound address.

**Anything else** (SendGrid, Mailgun, a script, a forwarder): POST JSON in this plain shape with the `x-cosign-token` header:

```json
{
  "from": "Vendor Name <billing@vendor.example>",
  "subject": "Invoice INV-1041",
  "messageId": "unique-id-from-your-provider",
  "text": "the email body, or the invoice itself",
  "attachments": [{ "filename": "invoice.pdf", "contentType": "application/pdf", "contentBase64": "..." }]
}
```

### 3. What happens to each message
| The message has | Result |
| --- | --- |
| Invoice text in the body | The agents run. It appears in **Invoices**, tagged "by email from <sender>" |
| A text PDF attachment | Same: the PDF text is the invoice, and the email body becomes forwarded context so a "our wallet changed" note is seen |
| A scan or image attachment | OCR runs, and the item waits in the **Email inbox** panel ("needs your check"). Press **Check and run** to load it into the editor |
| Nothing readable | Recorded as "could not be read", with the reason |
| The same `messageId` again (a provider retry) | Ignored, so one email is never two invoices |

Other attachment types (spreadsheets, logos, signatures) are ignored. At most 3 attachments of 8 MB each are read.

### Limits and honesty
- Email invoices are stored under an "email-intake" identity that operators and admins can see. A guest wallet never sees them.
- The webhook is rate limited per IP and in memory.
- OCR needs the English language data from tesseract.js's CDN the first time it runs (then it is cached in the temp directory), so the server needs outbound internet access.
- Not built: reading an IMAP mailbox directly (use a provider's inbound webhook), and OCR in other languages.

## Test it yourself

Against a running server with the same token set:

```bash
E2E_BASE_URL=http://localhost:3000 E2E_INBOUND_TOKEN=... E2E_ADMIN_KEY=0x... npx tsx frontend/scripts/e2e-email.ts
```
It checks the token, a body invoice, a retried message, a text PDF, a scanned image (which must wait for a person), a spoofed sender domain, the OCR upload route, and the inbox permissions. No payment is made.
