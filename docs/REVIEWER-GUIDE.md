# Reviewer guide

Five minutes, no keys. Everything below can be re-checked by you rather than taken on trust.

## 1. What Cosign is, in one line

Five independent agents each **sign** a verdict about an invoice, and an on-chain contract on Arc releases USDC only if all five agree and eight rules hold. Models give verdicts. The contract decides.

## 2. Try it

| Do this | You should see |
| --- | --- |
| Open **/invoices**, press **Load case A**, **Run the five agents** | Five verdicts with their reasons. All PASS, "ready for the Executor" |
| Load **case D** (prompt injection) | The injected instruction is shown as data and never followed; nothing is released |
| Load **case G** (chain swap) | The Verifier signs FAIL: the vendor is registered for Arc but the invoice asks for Base |
| Load **case F** (pay on Base) | All five agents PASS and sign destination domain 6 (Base Sepolia) |
| Upload a text PDF, or paste your own invoice | Same agents. A layout we cannot read is held for a human, not guessed |
| Open **/demo** | Step-by-step replay of seven cases against the eight rules |
| Open **/onchain** and press **Re-verify now** | The page reads Arc testnet (and Base Sepolia for the cross-chain leg) and re-checks every payment, receipt and agent score. No keys |
| Point any MCP client at **/mcp** | `check_invoice`, `demo_invoices`, `onchain_proof` |

The web inbox **simulates** payment (a demo ledger). The on-chain path is a script: `executor/scripts/onchain-demo.ts`.

## 3. Re-verify the chain yourself

```bash
cd executor && npm install && npx tsx scripts/verify-onchain.ts
```

It prints each case and `ALL VERIFIED from chain state`. For the cross-chain case it checks that Arc's `TokenMessengerV2` emitted `DepositForBurn` for the right amount, recipient and domain, and, once recorded, that the destination mint created exactly that USDC for the payee.

## 4. What is real, and what is not

- **Real:** the contracts on Arc testnet; agent keys held by Circle Wallets (signatures verified by `ecrecover`); the Executor sending through Circle; a CCTP payment burned on Arc and minted on Base Sepolia (both re-checked from chain state); replayable receipts; reputation and bonds moved on-chain; 226 tests in CI, including randomized invariant tests that mutate packages and assert nothing invalid ever moves money.
- **Scripted by us:** the seven demo invoices (including every attack) and the Auditor's ground truth, including one **seeded** miss used to show a slash.
- **Scaled:** test USDC at 1/1000 of the demo amounts, because the faucet gives about 20 USDC.
- **Built, not live:** USYC. The treasury contract is deployed and tested against a mock, but Circle must entitle it before it can subscribe. We say so wherever it appears.
- **Not built:** OCR for scanned PDFs; reconciliation against real external data; payment from the public web page.
- **Traction:** see `docs/TRACTION.md`. The dashboard shows only consenting partners and starts at zero.

## 5. Where to look in the code

| Question | File |
| --- | --- |
| What stops a bad payment? | `contracts/contracts/CosignPolicy.sol` (`evaluate`, `release`) |
| Is it tested adversarially? | `contracts/test/invariants.test.js`, `contracts/test/cctp.test.js`, `contracts/test/policy.test.js` |
| How does an agent decide? | `agents/src/agents.ts`; models can only add doubt (`agents/src/llm.ts`) |
| How is a payment sent exactly once? | `executor/src/executor.ts` (evaluate first, durable record, paid-set check, lock) |
| How does cross-chain settle? | `executor/src/cctp.ts` |
| How is a result re-checked without us? | `executor/src/verify.ts`, `executor/src/receipt.ts` |
| Where does the treasury (USYC) logic live? | `contracts/contracts/CosignTreasury.sol` |
