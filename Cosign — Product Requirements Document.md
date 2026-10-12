# Cosign — Product Requirements Document

Oct 13, 2026 · @Rohit

## Executive summary

Cosign is a multi-agent accounts payable and receivable system in which no single AI agent can move money: a payment settles in USDC on Arc only after independent, single-purpose agents have each signed a verdict and an on-chain policy contract has verified the quorum.

**Built for:** Tameion Agents Hackathon, RFB 2 (AP/AR Automation), with elements of RFB 3 (vendor reputation) and RFB 4 (limits enforced in a contract, not a prompt).

**Who it serves:** freelancers, small agencies and small businesses that pay vendors and chase customers in USDC and have no AP team.

**The problem in one line:** invoice payments fail at trust handoffs (fake vendor, changed wallet, duplicate, wrong amount), and one AI agent making all those calls is just a faster single point of failure.

**The idea in one line:** split the AP job into eight single-purpose agents, make each one sign what it concluded, give each an on-chain reputation backed by a USDC bond, and let the contract, not the model, decide whether money moves.

**What a judge will see:** a clean invoice paid automatically; a duplicate and a swapped-wallet invoice blocked on-chain; a replayable receipt for every payment; reputation scores that move when agents are right or wrong; and real before/after payables data from real users.

## Hackathon context

The submission deadline is Oct 17, 11:59 PM ET (Oct 18, about 9:30 AM IST), and judging is asynchronous, so the repo, video and live link must stand on their own. Details below are from the [Tameion page](https://tameion.thecanteenapp.com/) as fetched Oct 10, 2026.

| Item | Requirement |
| --- | --- |
| Event | Tameion Agents Hackathon, hosted by Canteen with Circle and Arc; online, invite-only, Sep 27 to Oct 17 |
| Settlement | Arc (Circle's stablecoin L1), USDC gas, sub-second finality |
| RFB targeted | RFB 2 AP/AR Automation (primary); RFB 3 reputation and RFB 4 contract-enforced limits (secondary). RFBs are prompts, not tracks |
| Required deliverables | Public GitHub repo; demo video under 3 minutes; answers to traction questions (businesses onboarded, value moved, problems solved) |
| Encouraged | Live deployed link judges can click through |
| Judging | 30% agentic sophistication, 30% traction, 20% Circle tool usage, 20% innovation |
| Traction rule | Needs at least one real user with a real money problem; synthetic data does not count; test USDC counts, mainnet counts more |
| Prior work | Only progress and users gained during the event are judged |
| Prizes | $40k: 1st $10k, 2nd $7.5k, 3rd $5k x 3, plus 10 to 12 standout teams at about $650 to $750 each |
| Design stance | Limit the agent somewhere it cannot talk its way past, such as a contract, a human threshold and a full audit record |

The last row is the organizers' own answer to "how much autonomy", and Cosign is built around it.

## Problem and evidence

Every major AP loss category traces to a trust failure at a handoff: who the vendor is, whether the invoice was already paid, whether the bank or wallet details changed, and whether anyone verified before money left. Figures below were retrieved Oct 2026; rows marked "secondary" come from a summary of the original report.

| Area | Finding | Source |
| --- | --- | --- |
| Fraud exposure | 76% of US organizations had attempted or actual payments fraud in 2025; 74% were hit by business email compromise (BEC) | [AFP 2026 survey release](https://www.financialprofessionals.org/about/learn-more/press-releases/Details/over-75-percent-of-us-firms-experienced-payments-fraud-in-2025-while-ai-adoption-for-fraud-mitigation-lags) |
| AI defenses lag | Only 17% of organizations use AI against payments fraud | [AFP 2026 survey release](https://www.financialprofessionals.org/about/learn-more/press-releases/Details/over-75-percent-of-us-firms-experienced-payments-fraud-in-2025-while-ai-adoption-for-fraud-mitigation-lags) |
| Small firms absorb losses | Smaller firms face fraud less often but lack recovery infrastructure, so they more often bear the full loss | [AFP 2026 survey release](https://www.financialprofessionals.org/about/learn-more/press-releases/Details/over-75-percent-of-us-firms-experienced-payments-fraud-in-2025-while-ai-adoption-for-fraud-mitigation-lags) |
| Vendor and invoice fraud | In the prior-year AFP survey, vendor impersonation reached 45% and invoice fraud 24%; only 22% recovered 75% or more of lost funds (secondary) | [DeepStrike BEC summary](https://deepstrike.io/blog/business-email-compromise-statistics-2026) |
| AI-forged vendors | LLMs can generate a full fake vendor identity: forged W-9, website, tax documents, even a voice agent that answers verification calls | [Beancount.io](https://beancount.io/blog/2026/07/20/ai-fake-invoice-fraud-accounts-payable-guide) |
| Duplicate payments | Duplicates are 18% of overpayment-driven lost profit; cancelled-invoice payments 14%; pricing discrepancies 13% (dataset: $3.25T spend, 400M+ invoices) | [apexanalytix 2026 report](https://www.businesswire.com/news/home/20260604272811/en/apexanalytix-2026-Global-Overpayment-Report-Reveals-Top-Five-Causes-of-Lost-Profit-in-Global-Enterprises) |
| Error floor | Even top performers report nearly 0.8% of disbursements as duplicate or erroneous (secondary, APQC) | [CFO.com](https://www.cfo.com/news/metric-of-the-month-detect-and-prevent-duplicate-or-erroneous-payments/656852/) |
| Manual cost | Fully loaded cost per invoice: $10.89 average vs $2.78 best-in-class; only 22% of organizations are best-in-class (secondary, Ardent Partners and APQC) | [AP automation statistics](https://stealthagents.com/research/ai-accounts-payable-automation-statistics) |
| Late receivables | 59% of small businesses have invoices overdue 30+ days (47% a year earlier); average unpaid balance $17.7K | [QuickBooks 2026 report](https://quickbooks.intuit.com/r/small-business-data/small-business-late-payments-report-2026/) |
| Cascade | 24% of businesses with 30+ day overdue invoices could not pay their own vendors on time because of delayed revenue | [QuickBooks 2026 report](https://quickbooks.intuit.com/r/small-business-data/small-business-late-payments-report-2026/) |
| Manual bill pay | 74% are not fully automated on bills; manual processes are the top internal reason for delayed outgoing payments | [QuickBooks 2026 report](https://quickbooks.intuit.com/r/small-business-data/small-business-late-payments-report-2026/) |
| Payment speed | US small businesses waited 28.8 days on average to be paid in Q1 2026, 9.0 days past due (secondary, Xero data) | [Invoice follow-up statistics](https://stealthagents.com/research/small-business-invoice-follow-up-workload-statistics-2026) |
| Stablecoin risk | A wrong address usually cannot be recovered, and stablecoin transfers have no chargeback | [Stablecoin Insider](https://stablecoininsider.org/stablecoin-payment-loss-liability/) |

**What the evidence says**

1. Fraud is now cheap and polished, so "looks legitimate" is no longer a signal.
2. Duplicates and wrong amounts persist even in mature, automated AP, because they arise across systems and handoffs.
3. Small businesses carry the worst of it: thin recovery options, manual processes, and late customers.
4. On-chain payments remove the safety nets (reversal, recall), so the check must happen before the money moves.

## Target users and jobs to be done

The first user is a very small business that pays vendors and chases customers by hand and is willing to run real invoices through the system on testnet USDC within days. This matches the hackathon's own examples of qualifying traction: a freelancer chasing invoices, a small agency paying contractors abroad.

| Persona | Situation | Job to be done | What they fear |
| --- | --- | --- | --- |
| Freelancer or solo founder (AR-heavy) | Sends 3 to 10 invoices a month, customers pay late | Get paid on time without awkward chasing | Damaging a client relationship; cash gaps |
| Small agency owner (AP-heavy) | Pays 5 to 20 contractors and SaaS vendors, often cross-border | Pay the right party the right amount once, on the right day | Paying a fake invoice or twice |
| Operations lead at a small startup | Handles approvals in email and chat, no AP software | Have a record of why every payment was made | Audit questions with no trail |
| Vendor or contractor (counterparty) | Wants prompt, predictable payment | Be paid fast and build a track record | Being flagged wrongly; opaque rules |

**Primary persona for the demo:** the small agency owner, because it exercises payables, fraud checks and vendor reputation in one story, and a freelancer on the receivables side completes the loop.

## Solution overview

Cosign replaces one all-purpose AP agent with a small team of specialists whose conclusions are signed, checked by a contract, and scored over time. The money only moves when the contract sees enough independent agreement.

**Design principles**

1. **No single agent can move money.** Only the Executor holds spending authority, and only through the policy contract.
2. **Agents sign, contracts decide.** Models give verdicts; an on-chain rule set decides whether to release funds.
3. **Evidence over assertion.** Every verdict points to hashed source material and a stored evidence bundle.
4. **Reputation from outcomes.** Scores change when the Auditor later proves an agent right or wrong, not when anyone says so.
5. **Skin in the game.** Each agent posts a USDC bond that is slashed for a proven bad approval.
6. **Disagreement escalates.** If agents conflict, a human decides; the system never averages a doubt away.
7. **Verify before, not after.** Stablecoin transfers cannot be reversed, so every check happens before release.

**Payables lifecycle (core path)**

1. An invoice arrives by email, PDF or API and the Reader extracts structured data and hashes the source.
2. The Verifier checks the vendor identity and the destination wallet (screening, history, change-of-address rules).
3. The Matcher compares the invoice to the contract, purchase order and delivery proof.
4. The Sentinel checks for duplicates, near-duplicates, amount drift and look-alike vendors.
5. The Treasurer chooses the payment day (early-pay discount vs. cash on hand, USYC redemption if needed).
6. Each agent submits a signed attestation; the policy contract checks the quorum and limits.
7. The Executor sends USDC on Arc from the policy wallet, and a receipt bundles attestations, evidence and the transaction hash.
8. The Auditor reconciles the payment to the invoice and the ledger, then writes outcomes that update reputation.

**Receivables lifecycle (secondary path):** the Collector tracks open invoices, ranks customers by past behavior, sends timed follow-ups, and matches incoming USDC to the right invoice using unique per-invoice payment addresses.

## Agent roster

Eight agents, one job each. Each has its own wallet or key, its own on-chain identity, and permission to do exactly one thing; only the Executor can spend.

| Agent | Single job | Inputs | Output (signed) | Decides | Cannot do |
| --- | --- | --- | --- | --- | --- |
| Reader | Turn an invoice into structured data | Email, PDF, API payload | Parsed fields + source hash | Field values, confidence | Judge legitimacy or pay |
| Verifier | Confirm the counterparty and destination | Vendor record, wallet, change requests | Vendor and wallet verdict | Onboard, hold, or challenge a vendor or address change | Approve amounts |
| Matcher | Check the invoice against what was agreed | Contract, PO, delivery proof | Match verdict + variance | Pass, partial, or reject on mismatch | Screen wallets |
| Sentinel | Catch duplicates and anomalies | Full invoice and payment history | Risk verdict + reasons | Flag duplicate, drift, look-alike | Pay or approve alone |
| Treasurer | Choose when to pay | Cash, due dates, discounts, forecast | Payment date + rationale | Pay now, wait, take discount, redeem USYC | Release funds |
| Executor | Send the payment | Quorum receipt from the contract | Transaction hash | Nothing; it executes only what the contract releases | Pay without quorum |
| Collector | Chase receivables | Open invoices, customer history | Follow-up plan and messages | Who to chase, when, and how firmly | Alter invoice amounts |
| Auditor | Reconcile and score | Payments, bank or chain data, disputes | Outcome records | Right or wrong after the fact | Change past verdicts |

**Independence rules**

- Matcher and Sentinel run on different models, so their errors are less correlated.
- The Verifier never sees the Matcher's verdict, and vice versa, so neither can anchor on the other.
- The Auditor reads from the ledger and chain, not from agent summaries.

## Proof system

A payment is released only when a policy contract on Arc verifies a bundle of signed attestations that all bind to the same invoice, payee and amount. The contract, not a model and not a prompt, is the final gate, which is the organizers' stated preferred pattern for bounded autonomy.

**Attestation schema.** Each agent signs one attestation per invoice using EIP-712 typed data.

```json
{
  "invoiceHash": "0x...",        // hash of the canonical invoice + source file
  "payee": "0x...",              // destination wallet
  "amount": "1250.00",           // USDC
  "role": "MATCHER",             // READER | VERIFIER | MATCHER | SENTINEL | TREASURER
  "verdict": "PASS",             // PASS | FAIL | ESCALATE
  "confidence": 0.93,
  "evidenceCID": "bafy...",      // stored evidence bundle
  "agentId": 17,                 // on-chain agent identity
  "expiry": 1760745600,
  "nonce": 42
}
```

**Release rules enforced by the policy contract**

| # | Rule | Why |
| --- | --- | --- |
| 1 | Every required role has a valid attestation: Reader, Verifier, Matcher, Sentinel, Treasurer | Independent agreement, not one opinion |
| 2 | Each signer is a registered agent with reputation above the threshold and bond above the minimum | Only accountable agents count |
| 3 | All attestations match on invoiceHash, payee and amount | Stops mix-and-match and tampering |
| 4 | Every verdict is PASS; any FAIL or ESCALATE holds the payment and routes it to a human | Doubt is never averaged away |
| 5 | Payee is on the screened allowlist, or a new or changed address has finished its cooling-off period and challenge | Targets wallet-swap fraud |
| 6 | Amount is within the per-transaction limit and category budget; above the limit a human signature is required | Bounded authority |
| 7 | invoiceHash has never been paid (on-chain paid set, idempotent nonce) | Duplicate and retry protection |
| 8 | Attestations are fresh (before expiry) | Stops stale approvals |

**Payment receipt.** After release, the system stores one receipt per payment: the attestations, the evidence bundle CIDs, the policy version, the transaction hash, and later the Auditor's reconciliation outcome. Anyone can replay the decision from the receipt without trusting the system.

**Honesty about limits.** Signatures prove who concluded what, not that the conclusion is correct. Correctness comes from independence between agents, the Auditor's later ground truth, and bonded reputation; the contract only guarantees that the required checks happened and agreed.

## Reputation and bonds

An agent's weight in the quorum comes from a score built only from audited outcomes, and a USDC bond makes a wrong approval cost the agent's operator real money. Reputation is not self-reported and not rated by other agents.

**Identity and registries.** The design follows [ERC-8004 (Trustless Agents)](https://eips.ethereum.org/EIPS/eip-8004), which defines three lightweight registries: Identity (an ERC-721 agent handle), Reputation (feedback tied to identity) and Validation (requests and records of independent verification). The standard is still a draft, and its own commentary notes Sybil rating attacks as a known risk. Open item: confirm whether registries are deployed on Arc testnet; if not, deploy a minimal compatible version.

**How scores move.** All events come from the Auditor, anchored to external ground truth (a duplicate found later, a vendor dispute, a recovered or lost payment, a human review).

| Event | Effect on agent score | Effect on bond |
| --- | --- | --- |
| Agent's FAIL verdict is confirmed (fraud or duplicate blocked and later proven) | Large increase, weighted by amount protected | None |
| Agent's PASS contributed to a payment later proven duplicate, fraudulent or wrong | Large decrease | Partial slash, paid into a loss-recovery pool for the business |
| Agent's FAIL blocked a payment later proven legitimate | Moderate decrease | None |
| ESCALATE resolved by a human in the agent's favor | Small increase | None |
| ESCALATE resolved against the agent | Small decrease | None |
| Verdicts consistently match final outcomes | Slow calibration bonus | None |

**Scoring rules**

- Scores are per role (a good Matcher is not automatically a trusted Verifier) and use a rolling window so old results fade.
- New agents start with low weight and earn standing.
- Slash amounts, thresholds and window length are configuration values, not hard-coded; initial values are chosen for the demo and labeled as assumptions.

**Anti-gaming**

- Only operator-registered agents with a posted bond count toward quorum, which limits Sybil agents.
- No agent-to-agent ratings; only Auditor events change scores.
- Different models for Matcher and Sentinel reduce correlated failure.

**Vendor reputation (RFB 3 link).** Each vendor accumulates on-time delivery, dispute rate, address-change frequency and verified payment history. That record sets the Verifier's scrutiny and the Treasurer's terms: a long-standing clean vendor can be paid faster and with fewer checks; a new vendor starts with the strictest path.

## Architecture and stack

&#91;embedded content: payables architecture · 7 agents, 1 contract gate\]

Agents only produce signed verdicts; the Collector, which handles receivables, sits outside this payables path. The Arc policy contract is the single place that can release funds, and the Auditor's outcomes flow back into reputation, which the contract reads when it checks signers.

| Layer | Choice | Circle or Arc tool | Notes |
| --- | --- | --- | --- |
| Agent workers | Stateless services calling LLMs over a job queue | None | Matcher and Sentinel on different models; failures produce ESCALATE or retry, never a pass |
| Ingestion | OCR plus LLM extraction; the organizers' prior-art list points to invoice2data and paperless-ngx | None | Documents are untrusted data |
| Identity and reputation | ERC-8004-style registries on Arc testnet | Circle Contracts | Deploy a minimal compatible version if the standard registries are absent |
| Policy contract | Solidity contract with the eight release rules, a paid-invoice set and per-category budgets | Circle Contracts | Pattern follows the organizers' guidance to enforce limits in a contract |
| Payments | Executor wallet controlled through the policy contract; USDC settlement and gas | Circle Wallets, Paymaster, USDC | Vendor never needs a gas token |
| Treasury | Idle reserve into USYC, redeemed when the forecast needs cash; unified balance view | USYC, Gateway | Treasurer, P1 |
| Cross-chain vendors | Burn-and-mint USDC transfer | CCTP | P2 |
| Screening | Self-hosted OpenSanctions yente, or Circle tooling where available | Address screening | Open question in this PRD |
| Evidence | Hashed evidence bundles in IPFS or object storage, CID on the receipt | None | Contents stay off-chain |
| Developer tooling | ARC CLI (Canteen-hosted Arc testnet) and Circle CLI | ARC CLI, Circle CLI | From the hackathon's Get Started steps |
| Reference code | circlefin/arc-escrow, arc-x402-circle-wallets and arc-fintech | Arc sample apps | Fork for escrow, agent-wallet and treasury patterns |
| Frontend | Web app: invoice inbox, escalation queue, receipts, reputation, traction dashboard | None | A judge can replay the demo cases without help |

## Functional requirements

P0 items are required for a credible submission by Oct 17; P1 items raise the score on agency and Circle usage; P2 items are stretch.

| ID | Requirement | Priority | Acceptance criteria |
| --- | --- | --- | --- |
| FR-1 | Ingest invoices from email forward, PDF upload or API and extract vendor, amount, currency, due date, line items, payment details | P0 | A set of at least 10 sample invoices parses with correct amount, vendor and due date on all but flagged low-confidence ones; source file is hashed |
| FR-2 | Vendor registry with onboarding verification before first payment | P0 | A new vendor cannot be paid until the Verifier attests; verification steps are recorded |
| FR-3 | Screen destination wallets before payment | P0 | Wallet checked against a sanctions or risk list; a flagged address blocks release and escalates |
| FR-4 | Wallet or bank detail change handling | P0 | A changed payee address triggers a cooling-off period and an out-of-band challenge; payment is held until cleared |
| FR-5 | Match invoice to contract, PO or agreed rate | P0 | Mismatch beyond tolerance yields FAIL or ESCALATE with the variance shown |
| FR-6 | Detect exact and near-duplicate invoices | P0 | Re-sent invoice and a variant with altered number or small amount change are both flagged; on-chain paid set rejects a second payment of the same invoiceHash |
| FR-7 | Each agent signs a typed attestation | P0 | Attestations verify against the registered agent key; schema matches the Proof system section |
| FR-8 | Policy contract enforces the eight release rules | P0 | Contract tests cover every rule, including missing role, mismatched payee, expired attestation, over-limit, and replay |
| FR-9 | Executor pays in USDC on Arc from a Circle wallet, gas in USDC | P0 | Payment settles on Arc testnet and the transaction hash is stored on the receipt |
| FR-10 | Human escalation inbox | P0 | ESCALATE and FAIL items appear with evidence; a human approve or reject is recorded and signed |
| FR-11 | Receipt and replay view | P0 | For any payment the UI shows attestations, evidence, policy version and transaction hash |
| FR-12 | Auditor reconciles payments and writes outcome records | P0 | Each paid invoice is marked reconciled or disputed; outcomes update the reputation ledger |
| FR-13 | Reputation ledger with per-role scores | P0 | Scores change in the demo after a confirmed catch and after a confirmed miss |
| FR-14 | Traction dashboard | P0 | Shows invoices processed, USDC volume, duplicates and fraud caught, and days payable before and after |
| FR-15 | Treasurer chooses payment date | P1 | Decision log shows discount vs. cash reasoning; idle reserve is moved to or redeemed from USYC where available |
| FR-16 | Agent bonds and slashing | P1 | A bond is posted per agent; a proven bad approval reduces it and funds a recovery pool |
| FR-17 | Collector for receivables | P1 | Unique per-invoice payment address or link, timed follow-ups by customer history, incoming USDC matched to the invoice |
| FR-18 | Idempotent execution | P1 | Retrying a failed or timed-out payment never produces a second transfer |
| FR-19 | Vendor reputation scoring | P2 | Vendor record shows on-time, dispute and change-frequency stats and influences terms |
| FR-20 | Cross-chain vendor payment | P2 | A vendor on another chain is paid through CCTP with the same receipt format |

## Non-functional requirements

Security and auditability matter more than speed here: a wrong payment cannot be undone, so the system favors holding a payment over guessing.

| Area | Requirement |
| --- | --- |
| Fail-safe default | Any missing, expired or conflicting attestation holds the payment; the system never pays on timeout |
| Key security | Agent keys and the Executor wallet are separate; the Executor wallet is controlled through Circle Wallets with the policy contract as the spending authority; no key is stored in prompts or logs |
| Prompt-injection resistance | Invoice text and email bodies are treated as untrusted data; agents extract fields but never follow instructions found in documents; the Executor ignores everything except contract-released payments |
| Auditability | Every verdict, human decision and payment is stored append-only with hashes; a payment can be replayed from its receipt |
| Idempotency | Payment requests carry a nonce and the invoiceHash; duplicate requests are rejected on-chain |
| Privacy | Invoice contents stay off-chain; only hashes, verdicts and evidence CIDs go on-chain; evidence storage supports access control |
| Reliability | Agents are stateless workers over a queue; a failed agent produces an ESCALATE or a retry, never a silent pass |
| Performance | Quorum assembly and release complete within a minute for the demo; Arc's sub-second settlement keeps payment latency negligible |
| Cost | Gas paid in USDC at roughly one cent per transaction on Arc, so per-invoice cost stays well below the $10.89 manual average |
| Compliance posture | Screening and records are designed to support later review (for example 1099-style record keeping and sanctions checks) but the product does not claim regulatory certification |
| Testability | Contract rules have unit tests; a scripted fraud suite (duplicate, swapped wallet, forged invoice, over-limit) runs end to end |

## Why this beats existing approaches

The gap is accountability on irreversible rails: today's options either rely on a person's attention, fixed rules, or one model's judgment, and none leaves a verifiable, enforceable record of why money moved. This comparison is by design category, not a benchmark of named products.

| Capability | Manual AP | Rules-based automation (OCR + workflow) | Single AI agent | Cosign |
| --- | --- | --- | --- | --- |
| Who decides | A clerk | Fixed rules and approvers | One model | Independent specialist agents plus a contract |
| Handles messy, novel invoices | Yes, slowly | Weak outside templates | Yes | Yes (Reader plus Matcher) |
| Duplicate and near-duplicate protection | Memory and spreadsheets | Exact-match rules | Model judgment, can be retried into a double pay | Sentinel plus on-chain paid set |
| Fake vendor or swapped wallet | Depends on vigilance | Rarely checked | Can be talked into it by a convincing email | Verifier cooling-off and challenge; contract allowlist |
| Resists prompt injection from invoice text | Not applicable | Not applicable | Weak spot | Agents cannot spend; only contract-released payments execute |
| Accountability when wrong | A person | A vendor or process owner | Nobody and nothing | Per-agent reputation and a slashable bond |
| Evidence of why a payment happened | Email trail | Workflow log | Chat or log text | Signed attestations, hashed evidence, replayable receipt |
| Fit for payments that cannot be reversed | Poor | Poor | Poor | Built for it: verify before release |
| Cost per invoice | $10.89 average, fully loaded | Lower, with exception handling | Low | Low; extra model calls offset by fewer losses |

**Why it matters now**

- Only 22% of organizations have reached best-in-class AP automation, and 17% use AI against payments fraud, so most small teams have neither speed nor strong controls.
- Duplicate and wrong payments persist even in mature AP because errors arise across systems and handoffs, which a cross-checking design targets directly.
- Agent identity and reputation standards such as ERC-8004 are emerging, so portable agent track records are becoming practical.

**Honest trade-offs**

- More agents mean more model calls, more latency and more things to monitor.
- Signatures prove who concluded what, not that they were right; quality depends on independence and the Auditor's ground truth.
- Bonds and reputation weights are demo-grade parameters until tested on real volume.
- Correlated model errors can still slip through; mixing models reduces but does not eliminate this.

## Success metrics and traction plan

Traction is 30% of the score, so the plan is to onboard a few real users early, run their actual invoices, and measure before and after. Targets below are proposed, not promised; adjust to what real users allow.

| Metric | Definition | Proposed target by Oct 17 | Why it matters |
| --- | --- | --- | --- |
| Businesses onboarded | Real users running real invoices | 3 to 5 | Directly asked in the submission form |
| Invoices processed | Invoices through the full quorum path | 30 or more | RFB 2 traction metric |
| USDC volume | Value paid and collected (test USDC counts) | Report actual | Value moved, asked in the form |
| Duplicates caught | Duplicate or near-duplicate invoices blocked | Report actual; 100% of seeded cases | RFB 2 traction metric |
| Fraud cases blocked | Seeded and real wallet-swap, fake-vendor, over-limit cases | 100% of the scripted suite | Proves the proof system |
| Duplicate payments executed | Payments made twice for one invoice | 0 | Core promise |
| Days payable outstanding | Average days from invoice receipt to payment, before vs after | Report both | RFB 2 traction metric |
| Days receivable outstanding | Average days from invoice sent to paid, before vs after | Report both (if Collector ships) | RFB 2 traction metric |
| Decisions escalated | Share of invoices sent to a human, and how often the human agreed | Report actual | Shows bounded autonomy |
| Receipts replayable | Payments with a complete replayable receipt | 100% | Auditability claim |

**Traction plan**

1. **Recruit (by Oct 14):** ask 5 to 8 people with real invoices, such as freelancers, small agencies, student startups and open-source maintainers, to be design partners; the goal is 3 to 5 who commit.
2. **Baseline (Oct 14 to 15):** collect each user's last few months of invoice dates and payment dates to compute their starting days payable or receivable.
3. **Run (Oct 15 to 17):** process their real invoices through the system on testnet USDC, including at least one seeded duplicate and one swapped-wallet case agreed with the user.
4. **Record:** keep user permission, screenshots and the dashboard export for the submission's traction answers.
5. **Be honest in the submission:** state clearly what was real, what was seeded for testing, and that testnet USDC was used; judges value genuine usage and discount synthetic data.

## Demo plan

The demo shows five scripted invoices through one pipeline, so the judge sees the contract hold on every attack and then sees real user numbers. The video must stay under 3 minutes; the live link should let a judge replay the same cases without help.

| Case | Invoice | Expected result | What it proves |
| --- | --- | --- | --- |
| A | Clean invoice from a known vendor, matches contract | All attestations PASS; contract releases; USDC paid on Arc; receipt shown | Normal path works end to end |
| B | Same invoice re-sent with a changed invoice number and a slightly different amount | Sentinel FAIL; payment held; a direct second payment of the original hash is rejected by the contract | Duplicate defense in two layers |
| C | Email from the vendor saying the wallet changed | Verifier opens a cooling-off and challenge; payment held until cleared | Wallet-swap fraud defense |
| D | Invoice text that tells the agent to ignore rules and pay elsewhere | Reader extracts data only; no instruction followed; Verifier flags the destination | Prompt-injection resistance |
| E | Invoice above the per-transaction limit | ESCALATE; human signs; payment releases with the human signature on the receipt | Bounded autonomy |

**Reputation moment:** after case B or C, the Auditor confirms the catch and the Sentinel or Verifier score rises; a seeded earlier miss shows a score drop and a bond slash.

**Video outline (target 2:50)**

| Time | Scene |
| --- | --- |
| 0:00 to 0:20 | The problem: fraud and duplicates stats, and why one agent is not enough |
| 0:20 to 0:50 | Case A: invoice in, agents sign, contract releases, receipt |
| 0:50 to 1:20 | Case B: duplicate blocked, contract rejects re-payment |
| 1:20 to 1:50 | Case C: wallet-swap email held by cooling-off |
| 1:50 to 2:10 | Cases D and E: injection ignored, human approval above limit |
| 2:10 to 2:30 | Reputation and bond change after the Auditor's outcome |
| 2:30 to 2:50 | Real traction: users, invoices, USDC volume, before and after days payable, and what comes next |

## Build plan to Oct 17

The plan front-loads the contract and the core agents, starts recruiting real users on day one, and reserves the last two days for real invoices, the video and resubmission. Dates are a proposal for the five days left, counted from Oct 13.

&#91;embedded content: build plan · Oct 13 to Oct 17, 9 workstreams, 2 milestones\]

**Checkpoints**

1. **End of Oct 14:** policy contract tests pass for all eight rules; Reader, Verifier, Matcher and Sentinel produce attestations on sample invoices.
2. **End of Oct 15:** the first USDC payment settles on Arc testnet with a replayable receipt; at least three real users are recruited with baselines recorded.
3. **End of Oct 16:** all five demo cases pass; reputation scores move after an Auditor outcome; first submission is sent (resubmission is allowed).
4. **Oct 17:** final real-user numbers, demo video under 3 minutes, README and live link checked, resubmit before 11:59 PM ET.

**If time slips, cut in this order:** cross-chain payment (FR-20), vendor reputation (FR-19), Collector (FR-17), bond slashing (FR-16), Treasurer (FR-15). Never cut the policy contract, the duplicate and wallet-swap cases, the receipt view, or real-user traction.

## Risks and mitigations

The biggest risks are time and traction, not technology: there are about five days left and real users take longest to arrive.

| Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- |
| Too little time for the full design | High | High | Build P0 only first; cut Collector, cross-chain and vendor reputation if needed; protect time for the video and repo |
| Not enough real users by Oct 17 | Medium | High | Start outreach on day 1; use your own invoices and projects as one real user; be explicit in the submission about real vs seeded data |
| ERC-8004 registries not available on Arc testnet | Medium | Medium | Deploy a minimal compatible identity and reputation contract; describe the standard as the model |
| Testnet access or test USDC is limited | Medium | Medium | Use the Canteen-hosted Arc testnet through the ARC CLI and the testnet USDC faucet linked on the hackathon page |
| LLM extraction errors on messy invoices | Medium | Medium | Confidence thresholds; low confidence yields ESCALATE, never a silent pass |
| Prompt injection through invoice text or email | Medium | High | Treat documents as untrusted data; only the contract can release funds; include an injection case in the demo and tests |
| Correlated errors across agents | Medium | Medium | Use different models for Matcher and Sentinel; rely on the Auditor for ground truth |
| Reputation gaming or fake agents | Low | Medium | Bond-weighted quorum; only Auditor events change scores; no agent-to-agent ratings |
| Complexity hides the agency story from judges | Medium | Medium | Show a decision log with reasons per agent; keep the demo to five cases |
| Handling real users' invoices | Medium | Medium | Get consent; keep contents off-chain; store only hashes and verdicts on-chain; redact screenshots |
| Overclaiming security or compliance | Low | High | State limits plainly: signatures prove who concluded what, not correctness; no regulatory certification claimed |

## Open questions and assumptions

**Open questions**

- [ ] Are ERC-8004 registries deployed on Arc testnet, or do we deploy a minimal version?
- [ ] Which address screening source will be used: Circle's tooling where available, or the self-hosted OpenSanctions option the organizers suggest?
- [ ] Which 3 to 5 real users can commit to running invoices before Oct 17?
- [ ] Which two models will power Matcher and Sentinel so their errors differ?
- [ ] Where does the evidence bundle live (IPFS, object storage) and who can read it?
- [ ] Should the live link let judges replay the five demo cases without logging in?

**Assumptions**

- The deadline is Oct 17, 11:59 PM ET, as shown on the hackathon page on Oct 10, 2026; re-check before submitting.
- Test USDC on Arc testnet counts as traction; mainnet would count more but is out of scope for this window.
- Bond sizes, slash percentages and score thresholds are demo parameters, not tuned values.
- Figures marked secondary in the evidence table come from summaries of original reports and should be re-checked against the originals before being quoted in the submission.
- The comparison is by design category, not a benchmark of named products.

## Sources

Retrieved October 2026. Pages in the first list were opened and the figures checked against them. Pages in the second list were seen in search results only; verify against the original before quoting them in the submission.

**Opened and checked**

- [Tameion Agents Hackathon page](https://tameion.thecanteenapp.com/): dates, deadline, deliverables, judging, RFBs, FAQ
- [AFP 2026 Payments Fraud and Control Survey release](https://www.financialprofessionals.org/about/learn-more/press-releases/Details/over-75-percent-of-us-firms-experienced-payments-fraud-in-2025-while-ai-adoption-for-fraud-mitigation-lags): 76% fraud, 74% BEC, 17% AI use
- [QuickBooks 2026 Small Business Late Payments Report](https://quickbooks.intuit.com/r/small-business-data/small-business-late-payments-report-2026/): 59% overdue, $17.7K, 24% cascade, manual processes
- [apexanalytix 2026 Global Overpayment Report release](https://www.businesswire.com/news/home/20260604272811/en/apexanalytix-2026-Global-Overpayment-Report-Reveals-Top-Five-Causes-of-Lost-Profit-in-Global-Enterprises): 18%, 14%, 13% overpayment causes

**Seen in search results only**

- [DeepStrike, BEC statistics 2026](https://deepstrike.io/blog/business-email-compromise-statistics-2026): prior-year AFP vendor impersonation, invoice fraud and recovery figures
- [Beancount.io, AI-generated fake invoices](https://beancount.io/blog/2026/07/20/ai-fake-invoice-fraud-accounts-payable-guide): AI-forged vendor identities
- [CFO.com, duplicate or erroneous payments (APQC)](https://www.cfo.com/news/metric-of-the-month-detect-and-prevent-duplicate-or-erroneous-payments/656852/): 0.8% top-performer error rate
- [AP automation statistics 2026](https://stealthagents.com/research/ai-accounts-payable-automation-statistics): $10.89 vs $2.78 per invoice, 22% best-in-class (Ardent Partners, APQC)
- [Small business invoice follow-up statistics 2026](https://stealthagents.com/research/small-business-invoice-follow-up-workload-statistics-2026): 28.8 days to be paid, 9.0 days late (Xero data)
- [Stablecoin Insider, who bears the loss](https://stablecoininsider.org/stablecoin-payment-loss-liability/): wrong-address and no-chargeback risk
- [ERC-8004 draft specification](https://eips.ethereum.org/EIPS/eip-8004): identity, reputation and validation registries
