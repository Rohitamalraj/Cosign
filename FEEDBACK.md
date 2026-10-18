# Circle / Arc feedback

Notes from building Cosign on Arc testnet (chain 5042002) with Circle developer-controlled wallets, CCTP V2, USYC and the ERC-8004 registries. Everything here comes from something we actually hit while building.

## What worked

- **USDC as gas.** Paying fees in USDC removed a whole class of problems. The Executor, the agents and the vendor all deal in one asset, and the cost of a payment is predictable. Nobody has to hold a second token.
- **Speed.** Blocks are fast enough that a payment, its receipt and the Auditor's score updates can all happen inside one request in the web app.
- **CCTP V2 Arc to Base Sepolia.** Burn on Arc and mint on Base Sepolia worked end to end through the web app, locally and on our deployed site. Having the domain ids (Arc 26, Base Sepolia 6) fixed and documented let us put the destination domain inside what the agents sign, so a cross-chain payout cannot be redirected.
- **Developer-controlled wallets.** Moving the agents' and the Executor's keys out of our own environment into Circle wallets was the right call for a system whose point is that no single key can move money. The SDK is straightforward once the entity secret is registered.
- **Standard EVM tooling.** ethers, Solidity and Foundry worked without changes. EIP-712 verification in the policy contract needed nothing special.
- **ERC-8004 registries on Arc.** Registering five agent identities was simple, and reading them back from the chain for verification worked.
- **The block explorer API.** The Blockscout-style `/api/v2` endpoints returned contract logs reliably. We used them to list every payment our policy contract released.
- **The sample apps.** `circlefin/arc-*` gave us a clear picture of the intended patterns, especially around wallets and treasury movement.

## Where Circle / Arc can improve

### USYC access is the biggest friction
- **Whitelisting is per address, and the error does not say which.** A deposit worked once our treasury wallet was whitelisted. A redeem then reverted with `NotPermissioned` (`0x7f63bd0f`) because the **receiver**, our policy contract, was a different address that was not entitled. Nothing in the revert says which address failed or that a second address needs approval. We found it by simulating the call and then reasoning from the revert data.
- **Please document it up front.** A short page that says "every address that holds, sends or receives USYC must be entitled, including contracts that receive a redemption" would have saved a support round trip. Whitelisting more than one address in a single request would help too.
- **The 70% cap surprised us.** Our first deposit reverted because it exceeded a per-deposit cap relative to our balance. The cap is not obvious from the Teller interface, and the revert gave no hint.
- **A testnet self-serve flow would help.** For hackathon teams a self-serve entitlement for testnet USYC, or a documented test token, would let builders finish the "idle cash earns yield" flow without waiting on a ticket.

### Faucets and gas
- **Faucet amounts are small for multi-wallet systems.** A system with a deployer, an Executor, an approver, five agent signers and a treasury needs many funded addresses. Our Executor ran down to 0.29 USDC during testing, and the deployer did not have enough to top it up, so we had to claim from the faucet by hand again.
- **Please allow larger or more frequent claims,** or a documented way to request a bigger testnet allowance for a project. A programmatic faucet endpoint would let test setups fund themselves.

### RPC behaviour
- **`eth_getLogs` over a wide block range fails with an unhelpful error.** Scanning contract events across a few million blocks returned `could not coalesce error` rather than a message about the range limit. The chain is fast, so block numbers grow quickly (about 67 million at the time of writing), and a plain "range too large, max N" message would make log scanning much easier. The explorer API worked as a fallback.
- **Publish the rate limits** for the public RPC. We designed our own per-route limits without knowing the upstream ones.

### Developer-controlled wallets
- **Idempotency keys are easy to get wrong.** We reused a key across retries of the same payment and got confusing results. Our live test found it, and we changed to a key per attempt. A clear note in the docs on how a key relates to a retry versus a new transaction would help, as would an error that names a replayed key.
- **Signing typed data through the API** works, but the examples centre on transfers. More examples for EIP-712 signing from a Circle wallet, which is exactly what multi-agent and policy systems need, would be valuable.

### CCTP
- **Surface the attestation wait.** Between burn and mint there is a wait for the attestation. A documented expected time per route on testnet, and a status endpoint example, would help builders build honest progress UIs instead of guessing.
- **A worked example for "pay a vendor on another chain"** that includes who pays the mint gas on the destination chain would save time. We solved it, but it took reading several pages.

### Docs and resources
- **One page that lists all testnet addresses** (USDC, USYC Teller, CCTP contracts, ERC-8004 registries) with their domains and chain ids would remove a lot of searching.
- **Arc sample apps** cover transfers and escrow well. We would like a reference for **policy-enforced agent spending** (limits, allowlists, human approval over a threshold), since that is what most agent builders actually need.
- **Mainnet path.** The hackathon says mainnet traction counts more. A clear statement of what is needed to move a testnet project to mainnet (USYC eligibility, wallet entity setup, CCTP differences) would help teams plan.

## Summary

Arc and Circle's stack made it possible to build a real payment system, not a mock: signed verdicts, an on-chain policy, cross-chain settlement and a yield reserve all ran against live infrastructure. The friction was almost all in access and diagnostics (USYC entitlements, faucet limits, vague reverts and RPC errors), not in the design of the primitives. Clearer errors and a few up-front documentation pages would remove most of it.
