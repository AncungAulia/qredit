# Qredit contracts

- `src/LoanVault.sol` — one vault per agent business: lender capital, order escrow, supplier payments under caps, the revenue split (lenders first), and ML-DSA-87-signed policy orders (narrowing only while a loan runs).
- `src/VaultFactory.sol` — deploys and lists vaults.
- `src/spike/SenderProbe.sol` — used only by the spikes.

## Test

    forge test

Local tests replace the QoreChain PQC precompiles with stand-ins (`test/mocks/MockPqc.sol`); the real ones are exercised on testnet by `engine/spikes/src/s3-apply-order.ts`.

## Deployed on qorechain-diana

| Contract | Address | Tx |
|---|---|---|
| VaultFactory | `0xAc5324088A7735dda922c277db5A2E906c8f5b3A` | `0x11a99af52774dca850678ffd9c344012339aa7c19e11f88b60571676d70bd2af` |
| Smoke vault (script signer) | `0xF8100c2E87a61Fe201f9e43B6dF18db7DB15fC2f` | `0xc3bb7f758d81bae435861d3b46c0a8bcb17df479f6af38088321c8d97710c5fb` |
| Smoke vault (QoreX signer) | not created yet | — |
