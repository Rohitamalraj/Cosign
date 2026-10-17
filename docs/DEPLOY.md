# Deploying the live app

The app is a Next.js server that imports `agents/`, the Executor library and `deployments/`, so it ships as one Docker image built from the repo root. In production it **refuses to start** unless the live runtime is configured: a Postgres database, Circle credentials, and the wallet ids.

## What the server needs

| Variable | What it is | Where it comes from |
| --- | --- | --- |
| `DATABASE_URL` | Postgres connection string | Render creates it from the database in `render.yaml` |
| `CIRCLE_API_KEY`, `CIRCLE_ENTITY_SECRET` | Your Circle developer-controlled wallets credentials | Copy from `executor/.env` yourself |
| `COSIGN_CIRCLE_WALLETS` | JSON of the wallet ids (the five agents, EXECUTOR, SCREENER, AUDITOR) | `cd executor && node --env-file=.env --import tsx scripts/print-deploy-env.ts` |
| `COSIGN_RELAYER_PRIVATE_KEY` | Throwaway key that pays destination-chain gas for CCTP mints. It holds no USDC | Same script |
| `COSIGN_ADMIN_ADDRESSES` | Your MetaMask address. It signs in as admin | You |
| Optional: `COSIGN_INBOUND_TOKEN` | Shared secret for the email webhook (16+ random characters). Leave unset to keep email intake off | You (see `docs/EMAIL-INTAKE.md`) |
| Optional: `MATCHER_LLM`, `SENTINEL_LLM`, `READER_LLM`, `GROQ_API_KEY`, `GEMINI_API_KEY` | Free models | See the README |

Everything above is a secret except the admin address. Put it only in the host's environment settings. Never paste it into chat, an issue or a commit; the CI job fails a commit that contains key-shaped values.

## Render, about 15 minutes

1. On render.com: **New > Blueprint**, choose this repo. It reads `render.yaml` and creates the web service and the Postgres database.
2. Render asks for each secret above. Run the helper script to get `COSIGN_CIRCLE_WALLETS` and `COSIGN_RELAYER_PRIVATE_KEY`, copy the two Circle values from `executor/.env`, and set `COSIGN_ADMIN_ADDRESSES` to your wallet.
3. Deploy. Open `https://<service>.onrender.com/api/status`: it should say `"mode":"live"`.
4. Open the site, press **Sign in with wallet**, and sign the message. You are an admin.
5. **Vendors > Add a vendor** (a real on-chain allowlist transaction), or import the example vendors: with `DATABASE_URL` set to the Render database's external URL, run `cd frontend && npx tsx scripts/seed-example-vendors.ts`.
6. Make your wallet the on-chain approver so you can approve over-limit payments (run by the contract owner, locally): `APPROVER_ADDRESS=0xYourWallet npx hardhat run scripts/wire-live-arc.js --network arcTestnet` in `contracts/`.

## Funding

The policy contract pays the vendors, so it needs USDC: send test USDC from the Circle faucet to the policy address in `deployments/arc-testnet.json`. The Executor, screener and Auditor Circle wallets pay gas in USDC, and the relayer needs a little Base Sepolia ETH to mint cross-chain payments. `/api/status` shows the policy's balance.

## Notes

- The free Render tier sleeps when idle, so the first request can take about 30 seconds. Cross-chain settlement resumes on the next page load after a sleep.
- The cooling-off for new vendors is 10 minutes on this testnet deployment (set by `wire-live-arc.js`); the contract default is 48 hours. Change it with `COOLING_OFF_SECONDS`.
- Do not set model API keys on a public deployment unless you accept that anyone who can sign in can spend them.
- The Docker image has not been built in CI yet (no Docker daemon was available when it was written). The same steps work without Docker: `cd frontend && npm run build && npm run start` with the environment above.

## Check it

```bash
curl -s https://<service>/api/status
curl -s https://<service>/api/stats
```

Then run `frontend/scripts/e2e-live.ts` against it (see the README) to check sign-in, payment, receipts, the Auditor and permissions against the real chain.
