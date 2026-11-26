# Qredit contracts

- `src/LoanVault.sol`: one vault per agent business (v2): lender capital, the owner's bond (10 % of the target), order escrow with a 24 h buyer review, supplier payments under caps and within each order's price, the revenue split (lenders first), default and Close (the owner side is swept to lenders), agent key rotation and ML-DSA-87-signed policy orders (narrowing only while a loan runs).
- `src/VaultFactory.sol`: deploys and lists vaults in fUSD and pulls the bond from the creator.
- `src/spike/SenderProbe.sol`: used only by the spikes.

## Test

    forge test

Local tests replace the QoreChain PQC precompiles with stand-ins (`test/mocks/MockPqc.sol`); the real ones are exercised on testnet by `engine/spikes/src/s3-apply-order.ts`.

## Deployed on qorechain-diana

| Contract | Address | Tx |
|---|---|---|
| VaultFactory v2 | `0xa960E225a56D787F72346d740d39F35ab43814D0` | `0x5649a7c82bf79dc511d7d87e2658c0dc9766e597d9882fd173a469c875351352` (block 10772909) |
| VaultFactory v1 (kept, no longer listed by the app) | `0xAc5324088A7735dda922c277db5A2E906c8f5b3A` | `0x11a99af52774dca850678ffd9c344012339aa7c19e11f88b60571676d70bd2af` |
| Smoke vault v1 (script signer) | `0xF8100c2E87a61Fe201f9e43B6dF18db7DB15fC2f` | `0xc3bb7f758d81bae435861d3b46c0a8bcb17df479f6af38088321c8d97710c5fb` |
| Smoke vault v1 (QoreX signer) | `0x0E343bF008E78630BD1dbb2Ff4F2DD5FB0F7B64f` | create: see RESULTS.md; applyOrder: `0x2b1f52d113178190c2cd7ae6c1e0baf09738180357c8107ef5a0e5ef0dc720ca` |

The v2 smoke run (deploy, raise, buy, deliver, accept, settle, reject, trigger default) is recorded in `engine/RESULTS.md`.
