# Cosign

**Multi-agent accounts payable where no single AI agent can move money.**

Cosign splits the AP job into eight single-purpose agents. Each one signs what it concluded about an invoice. An on-chain policy contract on [Arc](https://www.circle.com/) verifies the signatures and releases USDC only if every rule passes. Models give verdicts. The contract decides.

Built for the **Tameion Agents Hackathon**, RFB 2 (AP/AR automation), with elements of RFB 3 (vendor and agent reputation) and RFB 4 (limits enforced in a contract, not a prompt).

> **Status: work in progress.** The contracts are **deployed on Arc testnet**. The five demo cases ran on-chain end to end (agents signing and the Executor sending through **Circle Wallets**), and the Auditor has moved reputation and slashed a bond on-chain. 177 tests pass. **There are no real users yet**, and the invoice inbox in the web app pays from a simulated demo ledger. See [What works today](#what-works-today).

## For judges: verify it in 60 seconds

You do not need to trust this README. Everything about the Arc run is re-checked from the chain, with no keys:

1. **In the app:** run `cd frontend && npm install && npm run build && npm run start`, open `http://localhost:3000/onchain`, press **Re-verify now**. It reads Arc testnet and checks every case, every receipt (signatures, registry, receipt hash, human approval) and each agent's live score and bond.
2. **In a terminal:** `cd executor && npm install && npx tsx scripts/verify-onchain.ts`. Same checks, prints `ALL VERIFIED from chain state`.
3. **On the explorer:** [case A, 1.25 USDC paid](https://explorer.testnet.arc.io/tx/0x6373024565374eb2302cbd8be1c0f1ea6517d2b290dfa99553c53b051e5c1f3f) and [case E, 9.80 USDC paid after a human signature](https://explorer.testnet.arc.io/tx/0xf19f16ad66294d4e7a7995784212feaebb163757d249cb057fdfa123a949b1d6). Cases B, C and D were held by the contract, so there is no payment transaction to find.

**What is real, and what is not**

| Real | Not real, or scaled |
| --- | --- |
| Contracts on Arc testnet, real USDC token, gas in USDC | **Test money only, at 1/1000 scale** (faucet limit) |
| Agents sign through Circle-held keys; contract verifies with `ecrecover` | The five invoices are **scripted** by us, including the attacks |
| Held cases moved nothing; paid cases are in the paid set | The Auditor's ground truth is scripted; the slash is a **seeded** stand-in |
| 177 automated tests, incl. agents -> contract end to end | **No real users yet** (see `docs/TRACTION.md`) |
| Replayable receipts | The web inbox pays from a **simulated** demo ledger |

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
| Executor service (`release`, idempotency, crash recovery, receipts, HTTP API) | Done. 22 unit tests plus 22 chain tests against the real contract |
| Frontend: invoices, escalations, receipts, demo | **Wired to the real agents** through server-side API routes. Payments are recorded in a demo ledger (simulated, no chain) |
| Frontend: landing, docs, pricing | Static pages |
| Frontend: On-chain, Agents, dashboard | **Live from Arc testnet:** keyless re-verification, receipt replay, agent scores and bonds, Auditor events. Traction shows real partners only, which is zero today |
| Executor + receipt replay | Done and used on Arc through a Circle wallet (the demo script). Not triggered from the web UI |
| PDF input | **Text-based PDFs work** (upload in the inbox; 5 MB and 10 page caps, hardened pdf.js). **Scanned PDFs need OCR, which is not built** and are rejected with a clear message. Invoices in a layout the parser does not know are held for a human unless a free model is configured to propose the missing fields (see below) |
| Deployment to Arc testnet | **Done.** Registry and policy deployed against the real USDC; five demo cases run on-chain at testnet scale |
| Circle Wallets | **Used.** The five agents' signing keys and the Executor wallet are Circle developer-controlled wallets on ARC-TESTNET |
| Web inbox "Release" -> Arc | Not wired, on purpose for now: an unauthenticated public page that can trigger payments would be unsafe. The on-chain run is a script (`executor/scripts/onchain-demo.ts`) |
| Auditor | **Partly.** `contracts/scripts/audit-arc.js` writes outcomes on-chain (scores move, a bond is slashed and restored), but the ground truth is scripted. Reconciliation against real external data is not built |
| Real users and traction | **None yet.** The dashboard shows 0 until a consenting partner is added to `frontend/data/traction.json`. Playbook: `docs/TRACTION.md` |

Every number on the frontend (volume, invoices processed, days payable, scores) is invented mock data and is labelled as such in the UI.

## Live on Arc testnet

Chain `5042002`. Gas and settlement are real USDC (the token at `0x3600…0000`). Everything below is test money.

| | |
| --- | --- |
| CosignPolicy | [`0x32781b9dd9aE9ef8C6a1b8a264d3Aca0aEcc72d7`](https://explorer.testnet.arc.io/address/0x32781b9dd9aE9ef8C6a1b8a264d3Aca0aEcc72d7) |
| AgentRegistry | [`0x93dDf1BfC79B7B194FA1DA5f77d6F07Fa49AAb64`](https://explorer.testnet.arc.io/address/0x93dDf1BfC79B7B194FA1DA5f77d6F07Fa49AAb64) |
| Case A: clean invoice, 1.25 USDC paid | [`0x6373…1f3f`](https://explorer.testnet.arc.io/tx/0x6373024565374eb2302cbd8be1c0f1ea6517d2b290dfa99553c53b051e5c1f3f) |
| Case E: 9.80 USDC, above the 5 USDC limit, released with a human signature | [`0xf19f…b1d6`](https://explorer.testnet.arc.io/tx/0xf19f16ad66294d4e7a7995784212feaebb163757d249cb057fdfa123a949b1d6) |
| Cases B, C, D | Held by the contract on rule 4. No transaction was sent, and the paid set is empty for them |

What ran on-chain (all files are in [`deployments/`](./deployments)):

1. `contracts/scripts/deploy-arc.js` deployed the contracts against the real USDC and set the registry's minimum bond.
2. `executor/scripts/circle-setup.ts` created six Circle wallets (five agents and the Executor) and proved that a Circle-held key signs our EIP-712 attestation so that `ecrecover` returns the wallet address.
3. `contracts/scripts/setup-arc.js` set the Executor, human approver and screener, allowlisted the vendors, registered the five agents with 1 USDC bonds, and funded the policy contract.
4. `executor/scripts/onchain-demo.ts` ran the five cases: the agents sign through Circle, and the Executor submits `release` through Circle's contract-execution API. Receipts are in `deployments/receipts/` and replay offline.
5. `contracts/scripts/audit-arc.js` ran the Auditor: four confirmed catches raised the Sentinel and Verifier scores, one **seeded** earlier miss lowered the Sentinel's score and slashed 0.2 USDC from its bond into the recovery pool, and the operator then topped the bond back up. Transactions and reasons are in `deployments/auditor-events.json`.
6. `executor/scripts/verify-onchain.ts` (and the `/onchain` page) re-checks every result straight from the RPC, with no keys.

**Where Circle's tools are used, and where they are not** (only what has a real job here):

- **Arc and USDC**: the settlement chain and token, and USDC pays the gas.
- **Circle Wallets** (developer-controlled, EOA): custody for the agents' signing keys and the Executor key, so no raw private key exists in our process. The contract still verifies signatures with plain `ecrecover`.
- Not used: Paymaster (Arc gas is already USDC), CCTP and Gateway (Cosign settles on one chain), USYC (the policy contract holds the funds, so a yield position would need contract changes), EURC (the contract is single-token), Circle's Contracts platform (we deploy with Hardhat), and Agent Wallets, which are for agents that hold and spend funds under policies, while here the contract holds the funds and is the guardrail. These are roadmap items, not claims.

Honest notes on this run:

- **It is at testnet scale.** The faucet gives about 20 USDC, so every demo amount is the full-scale amount divided by 1,000 (1.25 USDC instead of 1,250) and the per-transaction limit is 5 USDC. See `agents/data-testnet/`.
- **The first run lost a payment to a bot.** I had derived the demo vendor addresses from the well-known public test mnemonic, and a sweeper bot moved the 1.25 USDC out within minutes. The contract and Executor behaved correctly; the mistake was in the test data. The vendor wallets are now random keys kept in a gitignored file, and the old addresses are blocked on-chain through the contract's own challenge function (visible in the transaction history). Never use a public mnemonic for addresses that will receive funds, even on testnet.
- The Executor wallet was funded from the deployer: Circle's faucet API returned "Forbidden" for our key.

## Repo layout

```
contracts/   Solidity (Hardhat): CosignPolicy, AgentRegistry, MockUSDC, tests
agents/      TypeScript agent workers: parse, check, sign EIP-712 attestations; demo ledger and invoices
executor/    The only component that spends: submits releases idempotently (local key or Circle wallet), writes replayable receipts, HTTP API
deployments/ Public addresses, the on-chain demo run, receipts and Auditor events (no keys)
docs/        TRACTION.md (how to recruit and record real design partners), DEMO-SCRIPT.md (video script)
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

**Executor**

```bash
cd executor
npm install
npm test            # 22 unit tests (validation, stores, HTTP auth)
# The chain tests run in contracts/ because they need a local EVM:
cd ../contracts && npx hardhat test test/executor.test.js
```

To run the service against a deployed contract (needs `RPC_URL`, `POLICY_ADDRESS`, a dedicated `EXECUTOR_PRIVATE_KEY` that holds gas only, and an `EXECUTOR_API_TOKEN` of 16+ characters):

```bash
cd executor && npm run serve     # listens on 127.0.0.1:8787
# POST /release  GET /releases/:hash  GET /receipts/:hash  POST /reconcile/:hash  GET /healthz
```

What the Executor does and does not do:

- It never reads an agent's opinion. It asks the contract (`evaluate`, a free view call) and sends only when the contract says it will release. The contract, not this service, is the gate.
- It never pays an invoice twice. It writes `SENDING` to disk before touching the network, checks the contract's paid set, and serializes work per invoice. A crash, a retry, a second instance with an empty store, or a transaction stuck in the mempool cannot cause a second payment.
- It refuses attestations that would expire within two minutes, measured against the chain's clock.
- Every payment gets a receipt (attestations, signatures, policy version, transaction, the contract's receipt hash). `replayReceipt()` re-verifies it from scratch with no Cosign service, and fails on any tampering.
- Over-limit payments need a human: the approver signs a typed message (`humanApprovalTypedData`) and the Executor passes it through.
- The HTTP API is bearer-token protected, loopback by default, size-limited and strictly validated. Put TLS and a real gateway in front before exposing it.

**Optional: add free language models.** Without a model, every agent runs deterministic checks and the Matcher and Sentinel cap their confidence at 0.85. A model adds a second opinion. It can only add doubt (PASS to ESCALATE or FAIL), never remove it, and any model error becomes ESCALATE, never PASS. Matcher and Sentinel must use different models, and startup fails if they match.

The `READER_LLM` model has one extra job: when the parser cannot read an invoice's layout, it **proposes values for the missing fields**. The model is never the source of truth: a field the parser already found is never overridden, and every proposed wallet, amount, invoice number, vendor and email must appear **verbatim** in the document, and dates must be real and appear in it, otherwise the value is rejected and the invoice is held. If the document names several wallets (for example an injected one), the choice is flagged as ambiguous and held. This is tested with scripted model replies only; it has not been run against a live free model yet, because that needs your API key.

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

The app imports `agents/` and runs it in server-side API routes (`/api/invoices`, `/api/invoices/:uid/decision`, `/api/samples`, `/api/reset`), so you need to run `npm install` in `agents/` too. On first load it feeds the five demo invoices through the real agents and saves the demo ledger to `frontend/.data/`. Paste an invoice or upload a text-based PDF in the inbox to run it live. Copy `frontend/.env.example` to `.env.local` to add free models.

Things to know before deploying it anywhere public:

- The API routes are unauthenticated, size-limited and rate-limited (20 requests a minute per IP). If you configure model API keys, anyone who can reach the app can spend them, so do not expose a keyed deployment without real authentication.
- `NODE_ENV=production` refuses to start without `COSIGN_AGENT_MNEMONIC`; development uses a public test mnemonic.
- "Released" in the UI means recorded in the demo ledger. The contract rules shown are a preview computed from the agents' output, not the deployed contract.

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
