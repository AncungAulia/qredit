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
| — | Not deployed yet | — |
