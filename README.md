# Cosign

**Multi-agent accounts payable where no single AI agent can move money.**

Cosign splits the AP job into eight single-purpose agents. Each one signs what it concluded about an invoice. An on-chain policy contract on [Arc](https://www.circle.com/) verifies the signatures and releases USDC only if every rule passes. Models give verdicts. The contract decides.

Built for the **Tameion Agents Hackathon**, RFB 2 (AP/AR automation), with elements of RFB 3 (vendor and agent reputation) and RFB 4 (limits enforced in a contract, not a prompt).

> **Status: work in progress.** The policy contract and its tests are done and pass locally. The frontend runs on **mock data**. The agent workers, the Executor service and the Arc testnet deployment are not built yet. See [What works today](#what-works-today).

## Why

Every major AP loss category traces back to a trust failure at a handoff: a fake vendor, a changed wallet, a duplicate, a wrong amount. Stablecoin transfers have no chargeback and a wrong address usually can't be recovered, so the check has to happen *before* the money moves. One AI agent making all those calls is just a faster single point of failure: it can be talked into paying a convincing fake.

Figures from the [PRD](./Cosign%20%E2%80%94%20Product%20Requirements%20Document.md) (retrieved Oct 2026; the PRD marks which were only seen in search summaries and need re-checking before quoting):

- 76% of US organizations faced attempted or actual payments fraud in 2025, and only 17% use AI against it ([AFP 2026](https://www.financialprofessionals.org/about/learn-more/press-releases/Details/over-75-percent-of-us-firms-experienced-payments-fraud-in-2025-while-ai-adoption-for-fraud-mitigation-lags)).
- Duplicates are 18% of overpayment-driven lost profit ([apexanalytix 2026](https://www.businesswire.com/news/home/20260604272811/en/apexanalytix-2026-Global-Overpayment-Report-Reveals-Top-Five-Causes-of-Lost-Profit-in-Global-Enterprises)).
- 59% of small businesses have invoices overdue 30+ days ([QuickBooks 2026](https://quickbooks.intuit.com/r/small-business-data/small-business-late-payments-report-2026/)).

## How it works

```
Invoice in ──► Reader ──┬─► Verifier ──┐
(email/PDF/API)         ├─► Matcher  ──┤  signed attestations
                        ├─► Sentinel ──┼────────────────────────►  Policy contract (Arc)
                        └─► Treasurer ─┘                              │ 8 release rules
                                                                      ▼
                    Reputation ◄── Auditor ◄── receipt ◄── Executor ── USDC ──► Vendor wallet
                                                              (only agent that can spend)
```

1. The **Reader** extracts structured data from the invoice and hashes the source file.
2. The **Verifier** checks the vendor and destination wallet. The **Matcher** compares the invoice to the contract or PO. The **Sentinel** looks for duplicates and anomalies. The **Treasurer** picks the payment day.
3. Each agent signs an **EIP-712 attestation** bound to the same `invoiceHash`, `payee` and `amount`.
4. The **policy contract** checks the quorum and limits. Any FAIL or ESCALATE holds the payment and routes it to a human.
5. The **Executor** sends USDC from the policy wallet. A **receipt** bundles attestations, evidence and the transaction hash, so anyone can replay the decision.
6. The **Auditor** reconciles the payment later and writes outcomes that move agent **reputation** and slash **bonds**.

Only the Executor can spend, and only through the contract. A **Collector** agent handles receivables separately.

### The eight release rules

Enforced in [`CosignPolicy.sol`](./contracts/contracts/CosignPolicy.sol). The first failing rule reverts with its number, so nothing moves.

| # | Rule |
| --- | --- |
| 1 | Every required role (Reader, Verifier, Matcher, Sentinel, Treasurer) has exactly one attestation |
| 2 | Each signer is a registered agent, above the reputation threshold and bond minimum, and the signature is valid |
| 3 | All attestations match on `invoiceHash`, `payee` and `amount`, and match the release request |
| 4 | Every verdict is PASS. Doubt is never averaged away |
| 5 | Payee is allowlisted, not blocked, and has finished its cooling-off period |
| 6 | Amount is within the per-transaction limit (or human-signed) and within the category budget |
| 7 | The invoice hash has never been paid, and no attestation nonce is replayed |
| 8 | Attestations are fresh |

A read-only `evaluate()` returns the failing rule without spending anything, so a UI can show it.

### Reputation and bonds

[`AgentRegistry.sol`](./contracts/contracts/AgentRegistry.sol) is a minimal identity, reputation and bond registry modelled on [ERC-8004](https://eips.ethereum.org/EIPS/eip-8004) (a draft standard). Scores change **only** through the Auditor. There is no agent-to-agent rating. A proven bad approval lowers the score and slashes part of the agent's USDC bond into a loss-recovery pool. Thresholds, bond sizes and slash amounts are configuration values and demo assumptions, not tuned numbers.

## What works today

| Part | Status |
| --- | --- |
| Policy contract, registry, mock USDC | Done. 49 Hardhat tests pass on a local chain |
| Agent workers (Reader, Verifier, Matcher, Sentinel, Treasurer) | Done. Deterministic checks plus optional free LLMs. 54 tests |
| Agents -> contract, end to end | Done. 10 tests push the agents' real signed output through the real contract |
| Frontend (landing, docs, pricing, dashboard, invoices, escalations, receipts, agents, demo) | Done, on **mock data**. Not yet wired to the agents |
| PDF and OCR ingestion | Not built. Agents read plain-text invoices today |
| Executor service calling `release` | Not built |
| Deployment to Arc testnet | Not done. Needs RPC details and a funded test wallet |
| Auditor, reconciliation, real receipts | Not built |
| Real users and traction | None yet. Nothing on the site is real usage |

Every number on the frontend (volume, invoices processed, days payable, scores) is invented mock data and is labelled as such in the UI.

## Repo layout

```
contracts/   Solidity (Hardhat): CosignPolicy, AgentRegistry, MockUSDC, tests
agents/      TypeScript agent workers: parse, check, sign EIP-712 attestations; demo ledger and invoices
frontend/    Next.js 14 + Tailwind + Framer Motion, mock data in src/lib/data.ts
Cosign — Product Requirements Document.md / .pdf
```

## Run it

Requires Node.js (developed on v24).

**Contracts**

```bash
cd contracts
npm install
npx hardhat test
```

**Agents** (needs no API key)

```bash
cd agents
npm install
npm test            # 54 tests
npm run demo        # runs the five cases through all five agents and prints each verdict
```

To run the whole chain, agents then contract: `cd contracts && npx hardhat test test/agents-e2e.test.js`.

**Optional: add free language models.** Without a model, every agent runs deterministic checks and the Matcher and Sentinel cap their confidence at 0.85. A model adds a second opinion. It can only add doubt (PASS to ESCALATE or FAIL), never remove it, and any model error becomes ESCALATE, never PASS. Matcher and Sentinel must use different models, and startup fails if they match.

```bash
# any OpenAI-compatible endpoint works; a few free options:
export MATCHER_LLM=groq:llama-3.3-70b-versatile      # needs GROQ_API_KEY (free tier)
export SENTINEL_LLM=gemini:gemini-2.0-flash          # needs GEMINI_API_KEY (free tier)
# or fully local, no key and no data leaves your machine:
export SENTINEL_LLM=ollama:qwen2.5:7b                # needs Ollama running
export READER_LLM=...                                # optional cross-check of the parser
```

Model names change often, so check each provider's current free models. **Privacy:** some free tiers may use prompts to improve their models. Invoices are business data, so use Ollama, or fake data, until you have checked a provider's terms.

**Frontend**

```bash
cd frontend
npm install
npm run dev        # http://localhost:3000
```

Routes: `/` landing, `/docs`, `/pricing`, `/dashboard`, `/invoices`, `/escalations`, `/receipts`, `/agents`, `/demo`.

## The five demo cases

Replayable at `/demo`. The contract tests cover the same behaviours.

| Case | Invoice | Expected result |
| --- | --- | --- |
| A | Clean invoice from a known vendor | All attestations PASS, contract releases, receipt written |
| B | Same invoice re-sent with a new number and slightly different amount | Sentinel signs FAIL, payment held. A direct second payment of the original hash is rejected by rule 7 |
| C | Email says the vendor wallet changed | Verifier opens a cooling-off and challenge, payment held |
| D | Invoice text tells the agent to ignore the rules and pay elsewhere | Reader extracts data only, Verifier flags the destination, nothing moves |
| E | Invoice above the per-transaction limit | ESCALATE, a human signs, payment releases with the signature on the receipt |

## Design notes and honest limits

- **Signatures prove who concluded what, not that the conclusion is correct.** Correctness comes from agent independence (Matcher and Sentinel run on different models), the Auditor's later ground truth, and bonded reputation. The contract only guarantees the required checks happened and agreed.
- **The contract can't see near-duplicates.** A re-sent invoice with a new hash passes the contract's paid-set rule. Catching it is the Sentinel's job, and the contract then holds the payment on rule 4. The paid set only stops a repeat of the *same* hash.
- **Agents only add doubt.** A model reply can downgrade a verdict but never upgrade one, and the five agents run in parallel on frozen inputs, so none sees another's verdict. Instruction-like text in an invoice is recorded as a red flag and never followed.
- **Detection depends on the ledger.** The Sentinel catches Case B only because INV-1041 is in the payment history. With an empty history it passes, and the contract's paid set (same hash only) would not catch it. The tests document this.
- **Matcher and Sentinel on different free models reduce correlated errors but do not remove them.** Both are LLMs reading the same text.
- **Invoice text is untrusted data.** Agents extract fields and never follow instructions found in documents, and only contract-released payments are executed.
- **Fail-safe default.** A missing, expired or conflicting attestation holds the payment. The system never pays on timeout.
- **The Reader is a required signer** (five roles), following the PRD. The architecture diagram in the PRD shows only four agents feeding the contract, so this is worth confirming.
- **Contract targets the `paris` EVM version** and OpenZeppelin 5.0.2, so it deploys on chains that lag the latest EVM. Arc support has not been confirmed yet.
- No regulatory or security certification is claimed. The contracts are unaudited.

## Open questions

- Are ERC-8004 registries deployed on Arc testnet, or do we deploy this minimal version?
- Which address-screening source: Circle tooling, or self-hosted OpenSanctions?
- Which two models power the Matcher and Sentinel?
- Where does the evidence bundle live (IPFS or object storage), and who can read it?
- Should the live link let judges replay the demo cases without logging in?

## Hackathon context

Tameion Agents Hackathon, hosted by Canteen with Circle and Arc. Deadline Oct 17, 11:59 PM ET. Judged on agentic sophistication, traction, Circle tool usage and innovation. Traction needs at least one real user with a real money problem, and test USDC counts. Full details, the requirements list and the build plan are in the [PRD](./Cosign%20%E2%80%94%20Product%20Requirements%20Document.md).
