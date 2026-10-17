# Cosign

**Multi-agent accounts payable where no single AI agent can move money.**

Cosign splits the AP job into eight single-purpose agents. Each one signs what it concluded about an invoice. An on-chain policy contract on [Arc](https://www.circle.com/) verifies the signatures and releases USDC only if every rule passes. Models give verdicts. The contract decides.

Built for the **Tameion Agents Hackathon**, RFB 2 (AP/AR automation), with elements of RFB 3 (vendor and agent reputation) and RFB 4 (limits enforced in a contract, not a prompt).

> **Status: work in progress.** The contracts are **deployed on Arc testnet** (policy v0.2). All seven demo cases ran on-chain end to end. Agents sign through **Circle Wallets**, the Executor sends through Circle, and a vendor was paid **on another chain through CCTP** (USDC burned on Arc, minted on Base Sepolia, both checked from chain state). The Auditor has moved reputation and slashed a bond on-chain. The web app is now the real thing, not a simulation: you sign in with a wallet, invoices go through the live agents and the real contract, **Pay** sends a real transaction, an over-limit payment needs the approver's wallet to sign in MetaMask, vendors live in a real database and are allowlisted on-chain, and an operator's report of what really happened moves agent reputation on-chain. A live end-to-end test of all of that passes against Arc testnet. The only thing that is not real is the money (test USDC), and **there are no real users yet**. See [What works today](#what-works-today).

**What changed since the first run (policy v0.1 to v0.2):** every attestation now binds the destination chain, so five agents sign *where* the money goes, not only who gets it. An address allowlisted on Arc is not allowed on another chain. The first run (cases A to E on v0.1) is kept in [`deployments/archive/v0.1`](./deployments/archive/v0.1) and is not shown in the live verifier, because the signing format changed.

## For judges: verify it in 60 seconds

You do not need to trust this README. Everything about the Arc run is re-checked from the chain, with no keys:

1. **In the app:** run `cd frontend && npm install && npm run build && npm run start`, open `http://localhost:3000/onchain`, press **Re-verify now**. It reads Arc testnet and checks every case, every receipt (signatures, registry, receipt hash, human approval) and each agent's live score and bond.
2. **In a terminal:** `cd executor && npm install && npx tsx scripts/verify-onchain.ts`. Same checks, prints `ALL VERIFIED from chain state`.
3. **On the explorer** (policy v0.2): [case A, 1.25 USDC paid](https://explorer.testnet.arc.io/tx/0x8da891d231f415831701e66a35727efb3d738fc1ddf322b9478e66b0ead917c9); [case E, 9.80 USDC paid after a human signature](https://explorer.testnet.arc.io/tx/0xe1ce97b4b80cd1fe97ea5266ce75bfe190791abb7caa0d2193837ca5b3dde51f); [case F, 0.75 USDC burned on Arc](https://explorer.testnet.arc.io/tx/0xf05c1369ec99326c2548f975a873aa610aa42e3272cf6c33113ca66380619524) and [minted on Base Sepolia](https://sepolia.basescan.org/tx/0xdfdd8d3c7c241e4f96bc6bb0657025f16447c52ffe47256edc966572789afa1a). Cases B, C, D and G were held by the contract, so there is no payment transaction to find. The first run on the archived v0.1 policy is also still on-chain.
4. **As a tool for other agents:** the app serves a remote [MCP](https://modelcontextprotocol.io) endpoint at `/mcp` (tools `check_invoice`, `demo_invoices`, `onchain_proof`). See [Use Cosign from another agent](#use-cosign-from-another-agent).

**What is real, and what is not**

| Real | Not real, or scaled |
| --- | --- |
| Contracts on Arc testnet, real USDC token, gas in USDC | **Test money only, at 1/1000 scale** (faucet limit) |
| Agents sign through Circle-held keys; contract verifies with `ecrecover` | The seven example invoices are **written by us**, including the attacks, and the reference run on `/onchain` is a one-off we ran |
| Held cases moved nothing; paid cases are in the paid set | The Auditor's scores before the app existed came from a **scripted** run (one seeded miss). Scores now move only when a person reports an outcome |
| 269 automated tests in CI, incl. agents -> contract end to end and randomized invariant tests | **No real users yet** (see `docs/TRACTION.md`) |
| CCTP burn on Arc and mint on Base Sepolia, both re-checked from chain state | Base Sepolia is a testnet; one cross-chain payment of 0.75 USDC, scripted by us |
| USYC treasury contract, tested | **USYC is not live**: Circle must entitle the contract first (ticket text in `docs/USYC-SUPPORT-TICKET.md`) |
| Replayable receipts, re-verified in the app when you open one | The USDC is **test money** with no value |
| Wallet sign-in, database, live payment from the app, MetaMask approval, on-chain vendor allowlist, outcome reporting (`frontend/scripts/e2e-live.ts`, 20 live checks) | Vendors added with a 10-minute cooling-off here (the contract default is 48 hours) so a test can finish |

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
| 3 | All attestations match on `invoiceHash`, `payee`, `amount` and **destination chain**, and match the release request |
| 4 | Every verdict is PASS. Doubt is never averaged away |
| 5 | Payee is allowlisted **for that chain**, not blocked, and has finished its cooling-off period (a sanctions block applies on every chain) |
| 6 | Amount is within the per-transaction limit (or human-signed) and within the category budget |
| 7 | The invoice hash has never been paid, and no attestation nonce is replayed |
| 8 | Attestations are fresh |

A read-only `evaluate()` returns the failing rule without spending anything, so a UI can show it.

### Reputation and bonds

[`AgentRegistry.sol`](./contracts/contracts/AgentRegistry.sol) is a minimal identity, reputation and bond registry modelled on [ERC-8004](https://eips.ethereum.org/EIPS/eip-8004) (a draft standard). Scores change **only** through the Auditor. There is no agent-to-agent rating. A proven bad approval lowers the score and slashes part of the agent's USDC bond into a loss-recovery pool. Thresholds, bond sizes and slash amounts are configuration values and demo assumptions, not tuned numbers.

## What works today

| Part | Status |
| --- | --- |
| Policy contract, registry, treasury, mock USDC | Done. 113 Hardhat tests on a local chain, including 14 for CCTP, 12 for the treasury, randomized invariant tests and Executor recovery tests |
| Agent workers (Reader, Verifier, Matcher, Sentinel, Treasurer) | Done. Deterministic checks plus optional free LLMs. 79 tests |
| Agents -> contract, end to end | Done. Tests push the agents' real signed output through the real contract |
| Executor service (`release`, idempotency, crash recovery, receipts, HTTP API) | Done. 34 unit tests plus chain tests against the real contract |
| **CCTP cross-chain payouts** | **Live on testnet, end to end.** Case F burned 0.75 USDC on Arc and the Executor minted it on Base Sepolia after Circle attested it. The Executor resumes after a crash or a failed mint (tested), and `/onchain` shows both transactions, each re-checked from its own chain |
| **USYC treasury** | **Contract built, deployed and tested against a mock Teller.** Not live: Circle has to entitle the contract (support ticket). The Treasurer agent's invest and redeem orders are verified on-chain, redeemed USDC can only go to the policy, and the invested share is capped |
| **ERC-8004 identity** | **Live.** All five agents are registered in Arc testnet's ERC-8004 Identity Registry (ids 897330 to 897334, v2.0.0). Each agent card is stored on-chain and names the key that signs for it, and the app and verifier re-read them from the chain. We do **not** use the standard's Reputation Registry: scores and bonds stay in our own `AgentRegistry`, moved only by the Auditor |
| **Decision Lab** (`/lab`) | Done. Per agent: rules alone, model proposal, what it signed, and an interactive what-if showing a model can only add doubt |
| MCP server (`/mcp`) | Done. `check_invoice` (real agents, real contract answer, nothing stored, nothing paid), `demo_invoices`, `onchain_proof` over Streamable HTTP |
| CI | GitHub Actions runs every test suite, typechecks, builds the app and scans for committed secrets |
| **Database** | **Done.** Postgres in production (`DATABASE_URL`), the same engine in-process (PGlite) for development and tests. Vendors, agreements, payment history, invoices, sessions, outcomes, and the Executor's durable records and receipts. 25 tests |
| **Wallet sign-in and roles** | **Done.** Sign in by signing a message in MetaMask (one-time nonce, domain-bound, 12 h session in an httpOnly cookie). Roles: admin, operator, guest. Only operators and admins can pay; only admins add vendors; a guest sees only their own invoices |
| **Pay from the app** | **Done and tested live.** The Executor asks the real contract first (`evaluate`) and sends through Circle only if the eight rules pass. Cross-chain payments are completed in the background and resumed after a restart |
| **Human approval in MetaMask** | **Done and tested live.** Above the limit, the approver wallet signs an EIP-712 approval in MetaMask. The server checks that the signer is the on-chain `humanApprover` before it sends; the contract checks again. No approver key exists on the server |
| **Vendor ledger** | **Done.** Admins add vendors in the app; the wallet is allowlisted on-chain by a Circle screener wallet and waits out a cooling-off. Each vendor's real on-chain status is shown |
| **Auditor** | **Done and tested live.** An operator reports what really happened on an invoice (once). The Auditor Circle wallet writes the score changes and bond slashes to the registry. Rules in `frontend/src/server/auditor.ts` |
| Frontend | Every page reads the live system. The dashboard shows counts from the database and the chain, never invented numbers; traction shows consenting partners only (zero today) |
| PDF input | **Text-based PDFs work** (upload in the inbox; 5 MB and 10 page caps, hardened pdf.js). Scanned PDFs and images go through OCR (next rows). Invoices in a layout the parser does not know are held for a human unless a free model is configured to propose the missing fields (see below) |
| Deployment to Arc testnet | **Done.** Registry, policy v0.2 and treasury deployed against the real USDC. All seven demo cases ran on-chain on v0.2 |
| Circle Wallets | **Used.** The five agents' signing keys and the Executor wallet are Circle developer-controlled wallets on ARC-TESTNET |
| Real users and traction | **None yet.** The dashboard shows 0 until a consenting partner is added to `frontend/data/traction.json`. Playbook: `docs/TRACTION.md` |
| **OCR for scans and photos** | **Done.** PNG, JPEG and image-only PDFs are read by OCR (tesseract.js, pages rendered with pdf.js). The text is shown to a person to check and correct before the agents run, because OCR misreads characters (our own test turned `@` into `®`). 9 tests, plus a live check of the upload route |
| **Email intake** | **Done.** A webhook (Postmark inbound JSON, or a plain JSON shape) turns an email into an invoice for the agents. Secret-protected, deduplicated by message id, sender domain checked by the Verifier, and **never pays anything**. A scan attached to an email waits in an inbox for a person. 18 live checks (`frontend/scripts/e2e-email.ts`). See `docs/EMAIL-INTAKE.md` |
| Not built | Reading an IMAP mailbox directly (use a provider's inbound webhook); OCR in languages other than English; reconciliation against an external system of record (the Auditor learns from a person's report, not from a bank or ERP feed); an external sanctions feed (the block list is a setting plus the contract's challenge function) |

There is no mock data in the app. The reference run on `/onchain` and the seven example invoices are inputs and records we created, and they are labelled as ours.

## Live on Arc testnet

Chain `5042002`. Gas and settlement are real USDC (the token at `0x3600…0000`). Everything below is test money.

| | |
| --- | --- |
| CosignPolicy v0.2 (the gate) | [`0x1339aDbA32Ff3C69DD9d9f4ff645525292b43a1B`](https://explorer.testnet.arc.io/address/0x1339aDbA32Ff3C69DD9d9f4ff645525292b43a1B) |
| AgentRegistry (reused from the first run) | [`0x93dDf1BfC79B7B194FA1DA5f77d6F07Fa49AAb64`](https://explorer.testnet.arc.io/address/0x93dDf1BfC79B7B194FA1DA5f77d6F07Fa49AAb64) |
| CosignTreasury (USYC reserve, not entitled yet) | [`0x981142C4AC97fa7E345f5c369f3158824Ce06632`](https://explorer.testnet.arc.io/address/0x981142C4AC97fa7E345f5c369f3158824Ce06632) |
| Case A: clean invoice, 1.25 USDC paid | [`0x8da8…17c9`](https://explorer.testnet.arc.io/tx/0x8da891d231f415831701e66a35727efb3d738fc1ddf322b9478e66b0ead917c9) |
| Case E: 9.80 USDC, above the 5 USDC limit, released with a human signature | [`0xe1ce…de51`](https://explorer.testnet.arc.io/tx/0xe1ce97b4b80cd1fe97ea5266ce75bfe190791abb7caa0d2193837ca5b3dde51f) |
| Case F: 0.75 USDC burned on Arc for a vendor on Base Sepolia (CCTP domain 6) | burn [`0xf05c…9524`](https://explorer.testnet.arc.io/tx/0xf05c1369ec99326c2548f975a873aa610aa42e3272cf6c33113ca66380619524), mint on Base Sepolia [`0xdfdd…afa1a`](https://sepolia.basescan.org/tx/0xdfdd8d3c7c241e4f96bc6bb0657025f16447c52ffe47256edc966572789afa1a) |
| Cases B, C, D, G | Held by the contract on rule 4. No transaction was sent and the paid set is empty for them |
| Archived v0.1 policy and its run (cases A, E paid; B, C, D held) | [`0x3278…72d7`](https://explorer.testnet.arc.io/address/0x32781b9dd9aE9ef8C6a1b8a264d3Aca0aEcc72d7), case A [`0x6373…1f3f`](https://explorer.testnet.arc.io/tx/0x6373024565374eb2302cbd8be1c0f1ea6517d2b290dfa99553c53b051e5c1f3f), case E [`0xf19f…b1d6`](https://explorer.testnet.arc.io/tx/0xf19f16ad66294d4e7a7995784212feaebb163757d249cb057fdfa123a949b1d6) |

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
- **CCTP V2**: a vendor that settles on another chain. All five agents sign the destination domain; the policy contract calls `TokenMessengerV2.depositForBurn` (Standard finality, which is the only mode Arc offers as a source, and no fee); the Executor polls Circle's attestation service and submits `receiveMessage` on the destination. The relayer only pays destination gas and cannot redirect funds, because the recipient is inside Circle's signed message. The burn is checked from chain state, and the mint is checked by finding a USDC mint to the payee in its transaction.
- **USYC** (built, not live): `CosignTreasury` is the only address that talks to the Teller, so it is the only one that needs Circle's entitlement. Orders must be signed by the registered Treasurer agent. Until Circle approves it, this is tested against a mock Teller only.
- Not used: Paymaster (Arc gas is already USDC), Gateway and x402 (an invoice payout is not a micropayment), EURC (the contract is single-token), Circle's Contracts platform (we deploy with Hardhat), and Agent Wallets, which are for agents that hold and spend funds under policies, while here the contract holds the funds and is the guardrail. These are roadmap items, not claims.

Honest notes on this run:

- **It is at testnet scale.** The faucet gives about 20 USDC, so every demo amount is the full-scale amount divided by 1,000 (1.25 USDC instead of 1,250) and the per-transaction limit is 5 USDC. See `agents/data-testnet/`.
- **The first run lost a payment to a bot.** I had derived the demo vendor addresses from the well-known public test mnemonic, and a sweeper bot moved the 1.25 USDC out within minutes. The contract and Executor behaved correctly; the mistake was in the test data. The vendor wallets are now random keys kept in a gitignored file, and the old addresses are blocked on-chain through the contract's own challenge function (visible in the transaction history). Never use a public mnemonic for addresses that will receive funds, even on testnet.
- The Executor wallet was funded from the deployer: Circle's faucet API returned "Forbidden" for our key.

## Repo layout

```
contracts/   Solidity (Hardhat): CosignPolicy (with CCTP), AgentRegistry, CosignTreasury (USYC), mocks, tests incl. invariants
.github/     CI: all test suites, typecheck, app build, secret scan
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
npm test            # 88 tests
npm run demo        # runs the demo cases through all five agents and prints each verdict
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

The `READER_LLM` model has one extra job: when the parser cannot read an invoice's layout, it **proposes values for the missing fields**. The model is never the source of truth: a field the parser already found is never overridden, and every proposed wallet, amount, invoice number, vendor and email must appear **verbatim** in the document, and dates must be real and appear in it, otherwise the value is rejected and the invoice is held. If the document names several wallets (for example an injected one), the choice is flagged as ambiguous and held. This is tested with scripted model replies in the unit tests, and has also been run against live free models (`agents/scripts/models-check.ts`, Groq `openai/gpt-oss-120b` for the Reader and Matcher, Groq `qwen/qwen3.8-27b` for the Sentinel). That live run is what showed that a prompt calling the field `payee` made a model return the company name instead of the wallet, and that showing a model a rate rounded to two decimals (0.12 instead of 0.125) makes it flag a correct invoice. Both were fixed; with the fixes, a clean invoice passes every model, a near-duplicate and a prompt-injection invoice are held, and an invoice in an unknown layout is read by the model and verified against the document text.

```bash
# any OpenAI-compatible endpoint works; a few free options:
export MATCHER_LLM=groq:openai/gpt-oss-120b          # needs GROQ_API_KEY (free tier)
export SENTINEL_LLM=groq:qwen/qwen3.8-27b            # a different model family on the same key (or use gemini: / openrouter:)
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
npm test           # 34 tests: database, wallet sign-in, Auditor rules, email intake
```

Routes: `/` landing, `/docs`, `/pricing`, `/dashboard`, `/invoices`, `/escalations`, `/receipts`, `/vendors`, `/agents`, `/lab`, `/demo`, `/onchain`, and the MCP endpoint `/mcp`.

**Two modes.** With Circle credentials and the deployment record present the server is **live**: agents sign through Circle, the real contract answers, Pay sends a real transaction. Without them (a fresh clone, local development only) it is **preview**: the agents still run and sign with local keys, but nothing can be paid, and the UI says "Preview · no chain" in the header. A production server without the live runtime refuses to run. To run live locally without copying secrets, set `COSIGN_LOAD_ENV_FILE=../executor/.env` and `COSIGN_ADMIN_ADDRESSES=<your wallet>`.

**First steps in the app:** sign in with MetaMask (an address listed in `COSIGN_ADMIN_ADDRESSES` is an admin) -> Vendors -> add a vendor (a real on-chain allowlist transaction, then a cooling-off) -> Invoices -> run an invoice -> Pay. The example vendors from our testnet run can be imported with `npx tsx scripts/seed-example-vendors.ts`. To let your wallet approve over-limit payments, make it the on-chain approver: `APPROVER_ADDRESS=0x... npx hardhat run scripts/wire-live-arc.js --network arcTestnet` (run by the contract owner).

**Prove it works against the real chain:** `E2E_BASE_URL=... E2E_ADMIN_KEY=... E2E_APPROVER_KEY=... npx tsx scripts/e2e-live.ts` runs 20 checks (sign-in, pay, receipt replay, Auditor writes, approver signature, permissions, vendor registration).

Deploying: see [`docs/DEPLOY.md`](./docs/DEPLOY.md). Things to know before it is public:

- Sign-in is by wallet; only operators and admins can pay, only admins can add vendors, and a guest sees only their own invoices. Anonymous callers can use the MCP `check_invoice` tool, which never stores or pays anything.
- Rate limits are per IP and in memory. If you configure model API keys, anyone who can sign in can spend them, so keep the allowlist of who may sign in in mind.
- The server holds Circle API credentials. Anyone who gets them can move whatever the Circle wallets hold (test gas and nothing else, here). Put them only in your host's secret settings.

## Use Cosign from another agent

The app exposes a stateless remote MCP endpoint (Streamable HTTP). For example, in Claude Code:

```bash
claude mcp add --transport http cosign https://<your-deployment>/mcp
```

Tools: `check_invoice` (the real five agents and the real contract's answer; nothing is stored and nothing is paid), `demo_invoices` (seven labelled examples), `onchain_proof` (the recorded Arc run, re-verified now). Invoice text is passed as untrusted data. The endpoint is rate limited and size limited and has no authentication, so do not give a keyed deployment (with model API keys) a public address without adding it.

## The seven example invoices

We wrote these, including the attacks. They are inputs: nothing is pre-recorded, and `/demo` runs the real agents when you press Run. The contract tests cover the same behaviours.

| Case | Invoice | Expected result |
| --- | --- | --- |
| A | Clean invoice from a known vendor | All attestations PASS, contract releases, receipt written |
| B | Same invoice re-sent with a new number and slightly different amount | Sentinel signs FAIL, payment held. A direct second payment of the original hash is rejected by rule 7 |
| C | Email says the vendor wallet changed | Verifier opens a cooling-off and challenge, payment held |
| D | Invoice text tells the agent to ignore the rules and pay elsewhere | Reader extracts data only, Verifier flags the destination, nothing moves |
| E | Invoice above the per-transaction limit | ESCALATE, a human signs, payment releases with the signature on the receipt |
| F | A vendor registered on Base Sepolia asks to be paid there | All five agents sign destination domain 6; the policy burns USDC on Arc through CCTP; Circle attests; the mint lands on Base |
| G | A vendor registered for Arc only asks to be paid on Base Sepolia | The Verifier signs FAIL (a changed chain is a classic redirect), so nothing moves |

## Design notes and honest limits

- **Signatures prove who concluded what, not that the conclusion is correct.** Correctness comes from agent independence (Matcher and Sentinel run on different models), the Auditor's later ground truth, and bonded reputation. The contract only guarantees the required checks happened and agreed.
- **The contract can't see near-duplicates.** A re-sent invoice with a new hash passes the contract's paid-set rule. Catching it is the Sentinel's job, and the contract then holds the payment on rule 4. The paid set only stops a repeat of the *same* hash.
- **Agents only add doubt.** A model reply can downgrade a verdict but never upgrade one, and the five agents run in parallel on frozen inputs, so none sees another's verdict. Instruction-like text in an invoice is recorded as a red flag and never followed.
- **Detection depends on the ledger.** The Sentinel catches Case B only because INV-1041 is in the payment history. With an empty history it passes, and the contract's paid set (same hash only) would not catch it. The tests document this.
- **Matcher and Sentinel on different free models reduce correlated errors but do not remove them.** Both are LLMs reading the same text.
- **Invoice text is untrusted data.** Agents extract fields and never follow instructions found in documents, and only contract-released payments are executed.
- **Fail-safe default.** A missing, expired or conflicting attestation holds the payment. The system never pays on timeout.
- **The Reader is a required signer** (five roles), following the PRD. The architecture diagram in the PRD shows only four agents feeding the contract, so this is worth confirming.
- **Contract targets the `paris` EVM version** and OpenZeppelin 5.0.2. It deploys and runs on Arc testnet.
- **Cross-chain is Standard finality, one hop.** The burn is atomic with the release (if Circle ever charged a fee the burn would revert and nothing would move), but the mint is a separate, permissionless step that the Executor completes. Between the two, the USDC is burned and not spendable by anyone else, but the payee does not have it yet.
- No regulatory or security certification is claimed. The contracts are unaudited.

## Open questions

- ERC-8004: the Identity Registry exists on Arc testnet and the agents are registered in it. Open: whether to also write Auditor outcomes to the standard Reputation Registry (it forbids feedback from an agent's owner, so the Auditor would need a separate address).
- Which address-screening source: Circle tooling, or self-hosted OpenSanctions?
- Which two models power the Matcher and Sentinel?
- Where does the evidence bundle live (IPFS or object storage), and who can read it?
- Should the live link let judges replay the demo cases without logging in?

## Hackathon context

Tameion Agents Hackathon, hosted by Canteen with Circle and Arc. Deadline Oct 17, 11:59 PM ET. Judged on agentic sophistication, traction, Circle tool usage and innovation. Traction needs at least one real user with a real money problem, and test USDC counts. Full details, the requirements list and the build plan are in the [PRD](./Cosign%20%E2%80%94%20Product%20Requirements%20Document.md).
