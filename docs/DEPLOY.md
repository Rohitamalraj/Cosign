# Deploying the web app (so judges and partners can try it)

The app is a Next.js server that imports `agents/`, `executor/src` (for read-only verification) and `deployments/`, so it deploys best as one Docker image from the repo root.

## Render (free tier), about 10 minutes

1. Push this repo to GitHub (it already is).
2. On render.com: **New > Blueprint**, pick this repo. It reads `render.yaml`.
3. When asked for `COSIGN_AGENT_MNEMONIC`, paste a **fresh** 12-word phrase. Generate one with `node -e "console.log(require('ethers').Wallet.createRandom().mnemonic.phrase)"` in `agents/`. These keys only sign demo attestations and never hold funds. Do **not** reuse a real wallet phrase, and never a public test phrase.
4. Deploy. Open `https://<your-service>.onrender.com/onchain` and press **Re-verify now**.

Notes:

- The free tier sleeps when idle, so the first request can take about 30 seconds.
- State is kept in `/tmp` and resets on restart. That is fine for a demo ledger.
- Do **not** set `GROQ_API_KEY` / `GEMINI_API_KEY` on a public deployment unless you accept that anyone can spend them (the routes are rate limited but unauthenticated).
- The clock is pinned (`COSIGN_DEMO_NOW=2026-10-15T12:00:00Z`) so the seven demo cases give the same result for every visitor. Real invoices you paste are judged against that date too.
- The Docker image has not been built in CI yet (the Docker daemon was not available while it was written). If the build fails, the same steps work locally: `cd frontend && npm run build && COSIGN_AGENT_MNEMONIC="..." npm run start`.

## Check it

```bash
curl -s https://<your-service>/api/samples | head -c 200
curl -s -X POST https://<your-service>/mcp -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```
