# Archived: first live run on policy v0.1.0

These files record the first scripted run on Arc testnet against the original policy contract
`0x32781b9dd9aE9ef8C6a1b8a264d3Aca0aEcc72d7` (`policy-v0.1.0`, 11.05 USDC across cases A and E, with B, C and D held).
The transactions are still on-chain and can be opened on the explorer.

They are **not** shown on the live `/onchain` page and **not** verified by `executor/scripts/verify-onchain.ts`, because
policy v0.2.0 changed the signed format (every attestation now binds the destination chain), so these receipts use the
older EIP-712 domain version `1` and cannot be replayed with the current code. To replay them, check out commit
`d0b1745` and run its verifier. The current policy and its run are in `deployments/`.
