# Traction playbook

Traction is 30% of the score, and the brief says it needs **at least one real user with a real money problem**. Synthetic data does not count, test USDC does. The dashboard shows `0` real design partners until you add one. That is deliberate: an honest zero beats an invented number.

Deadline: Oct 17, 11:59 PM ET. Be explicit in the submission about what was real, what was seeded, and that it was testnet USDC.

## 1. Who to ask (today)

Aim for 3 to 5 people who send or pay invoices by hand and would run **2 to 5 real invoices** through the system on testnet. Best fits, from the PRD:

- A freelancer who sends 3 to 10 invoices a month and chases late customers.
- A small agency owner paying 5 to 20 contractors.
- A student startup or open-source maintainer who pays or gets paid by invoice.
- Yourself, if you have real invoices (the PRD allows it as one user, if you say so plainly).

## 2. Message you can send

**Short DM**

> Hey [name], I'm building Cosign for a hackathon: it checks invoices before USDC is paid, so a fake vendor, a swapped wallet or a duplicate gets blocked. I need 2 to 5 real invoices run through it on a test network (no real money moves), and the dates of your last few invoices and payments so I can measure how long paying takes today. Takes about 20 minutes. Can I use your numbers in my submission, with your name or anonymised, your choice?

**Email**

> Subject: 20 minutes, no money at risk: help test an invoice checker?
>
> I'm submitting Cosign to the Tameion Agents Hackathon. It is a set of agents that each sign off on an invoice, and a smart contract that only releases payment if they all agree. Everything runs on a test network with test money.
>
> What I'd ask: (1) the dates of your last 3 to 6 invoices and when they were paid, (2) 2 to 5 real invoices as text so I can run them through, (3) permission to quote the result. You can be anonymous. I'll send you the outcome.

## 3. Consent (read this out or paste it)

> I agree that [business or alias] is a design partner for Cosign's hackathon submission. I understand it runs on a test network with test USDC, no real money moves, and my invoice contents stay off-chain (only hashes and verdicts are published). Cosign may report counts, test volume and before/after payment timing, with my name or an alias as I choose, and I can withdraw at any time. Signed / confirmed by message on [date].

Keep the written confirmation (a message is enough). Redact screenshots.

## 4. Baseline: how long it takes today

Ask for a sheet with these columns, one row per invoice, last 3 to 6 months:

| invoice_id | direction | counterparty (alias ok) | amount | currency | invoice_date | due_date | paid_date |
| --- | --- | --- | --- | --- | --- | --- | --- |

- **Days payable outstanding (DPO)** = average of `paid_date - invoice_date` for rows where they pay.
- **Days receivable outstanding (DRO)** = the same for rows where they get paid.

Compute the baseline now. Compute the "after" only from real invoices actually run through Cosign, with the dates they really moved. If there are too few to compare, say so and do not extrapolate.

## 5. Running their invoices (what works today, honestly)

- The app reads **pasted text and text-based PDFs** (upload in `/invoices`). **Scanned PDFs need OCR, which is not built**: for those, paste the text. The parser reads a labelled layout (`From:`, `Due:`, a `Description | Qty | Rate | Amount` table); a partner's own layout will often not match. With a free model configured (`READER_LLM`), the model proposes the missing fields and every proposed value must appear verbatim in the document, otherwise it is rejected and the invoice is held. Without a model, an off-template invoice is held for a human.
- The agents check an invoice against a **ledger** (registered vendors, agreements or POs, payment history), which now lives in a database and has a screen: **Vendors**. Add a partner's vendors there with their payment wallet, category and the agreed rate (this is a real on-chain allowlist transaction, followed by the cooling-off). The Matcher can only check rates for vendors that have an agreement, so enter one. This takes a few minutes with the partner on a call.
- In the web app (`/invoices`) a payment is a real transaction of testnet USDC through the Executor and Circle wallets. A partner signs in with their wallet (as a guest, to check their own invoices) or you run their invoices as an operator. Say which you did. Add their vendors on `/vendors` first (a real on-chain allowlist, then the cooling-off).

## 6. Recording it

Edit `frontend/data/traction.json`. One object per partner **with consent**:

```json
{
  "partners": [
    {
      "name": "Alias or real name",
      "consent": true,
      "realInvoices": 4,
      "usdcVolume": 12.4,
      "testnet": true,
      "dpoBeforeDays": 21,
      "dpoAfterDays": 6,
      "notes": "Freelance designer; 3 payables, 1 receivable. Invoices real; payments on Arc testnet."
    }
  ]
}
```

The dashboard then shows the real partner count and the before/after chart. Do not add seeded or invented entries, and do not put a number in `dpoAfterDays` you cannot back with real dates.

## 7. Submission answers (fill from the file)

| Question | Answer | Where it comes from |
| --- | --- | --- |
| Businesses onboarded | _count of consenting partners_ | `traction.json` |
| Value moved | _sum of `usdcVolume`, labelled testnet_, plus the test USDC of the scripted on-chain runs (first run: 11.05 USDC, archived in `deployments/archive/v0.1`; current runs in `deployments/onchain-demo*.json`), labelled as scripted | `traction.json`, `deployments/` |
| Problems solved | duplicate / near-duplicate caught, wallet-swap held, injection ignored, over-limit escalated, each with a transaction or receipt | `/onchain` page |
| Real vs seeded | Real: partner invoices. Seeded: the seven scripted cases and the Auditor's slash event | be explicit |
| Network | Arc testnet, test USDC | |

Judges discount synthetic data, so the clearest honest statement wins: *"N real users, M real invoices, X test USDC. The five attack cases are scripted and labelled as such."*

## 8. If you only get one partner

One real user with a real invoice and honest numbers beats five invented ones. Run that one well: show their invoice (redacted), the verdicts, the transaction, the receipt replaying, and the before/after dates.
