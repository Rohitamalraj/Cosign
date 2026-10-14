# USYC entitlement request (text to send to Circle Support)

Circle's Arc docs say USYC on Arc testnet needs an entitlement, requested by support ticket with the wallet address
(about 24 to 48 hours). Send this, then keep the reply as evidence.

> Subject: USYC testnet entitlement request for a smart contract (Arc testnet, hackathon)
>
> Hi Circle team,
>
> We are building Cosign for the Tameion Agents Hackathon (deadline Oct 17). We would like to subscribe to and
> redeem USYC on **Arc testnet (chain 5042002)** from a **smart contract**, not an EOA, so a signed AI-agent
> order can move idle treasury USDC into USYC and back.
>
> - Address to entitle (CosignTreasury, deployed and public): `0x981142C4AC97fa7E345f5c369f3158824Ce06632`
> - USYC Teller: `0x9fdF14c5B14173D74C08Af27AebFf39240dC105A`
> - USYC Entitlements: `0xcc205224862c7641930c87679e98999d23c26113`
> - The contract is the only caller of the Teller. It calls `deposit(assets, receiver=itself)` and
>   `redeem(shares, receiver=our policy contract, account=itself)`.
> - Questions: (1) can a contract address be entitled? (2) is a USYC approval to the Teller required before
>   `redeem`? (3) are there minimums or redemption delays on testnet?
>
> Use: testnet only, no real funds. Thanks!

If Circle says contracts cannot be entitled, fall back to an entitled EOA treasury, or ship USYC as
"implemented and tested against a mock Teller, not live" (the README must say so).
