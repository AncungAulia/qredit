# CLAUDE.md — engine

Qredit's agents, simulated suppliers and the owner CLI. Bun; shared chain code comes from `@qredit/qore`.

- Owner CLI: `bun run owner <command>` (see `src/cli/owner.ts` usage). Commands are idempotent: re-running skips what already exists.
- Keys live in `engine/.keys/` (gitignored); files are created with flag `wx` and never printed. `businesses.json` (public parameters) and `deployments.json` (public addresses) are committed.
- The engine holds only agent keys, operator classical keys and supplier addresses; it never holds the relayer or treasury keys at runtime (the owner CLI uses the treasury only during setup).
- Tests: `bun test` (offline). Chain-touching commands are exercised live, never in unit tests.
- `spikes/` is the earlier testnet spike toolkit; it is not part of the workspace.
- `seal-keys <slug>|all` creates `<slug>-seal` (seed, wx), registers its ML-KEM key on the spender and uploads the signed recipient card; `src/agent/seal.ts` holds the request and report codec.
- Expiry: the agent-key link (`business create`) expires after 30 days; re-link it before then. Operator windows last about 6.9 h (17,280 blocks); the backend's window keeper renews them once `be-env` has written OPERATOR_KEYS. `ensureWindow` reuses a live window only if it covers the targets and has room, so owner commands open windows automatically; `windows` is a manual refresh.

## Agent runner and demo buyer

- Run: `bun run suppliers` and `bun run agent` (the backend must be up on `API_URL`). `engine/.env` needs `ENGINE_TOKEN` (same as `apps/be/.env`) and `OPENROUTER_API_KEY`; optional `AGENT_MODELS`, `AGENT_EFFORT`, `AGENT_EFFORT_DEEP`, `AGENT_POLL_MS`, `SUPPLIERS_URL`. The runner claims orders from `POST /v1/orders/claim` (the backend hands a claim back after 15 minutes), serves one at a time, skips vaults that are Raising or Refunded, and stops on SIGINT/SIGTERM.
- Runtime reads from the keystore: agent keys (`<slug>-agent`), operator private keys only (`<slug>-operator`.privateKey), seal seeds (`<slug>-seal`) and supplier addresses. It never reads mnemonics or recovery codes. Logs carry order ids, statuses and tx hashes, never request text or reports.
- LLM: OpenRouter with the `AGENT_MODELS` fallback list; the model only picks an enum-bounded supplier or declines. If it is unavailable or its prose is not grounded in the facts, the report uses the facts-only text and `generatedBy` is `facts-only`.
- Decline codes (`vault.decline`): 1 out of scope or bad input, 2 would lose money, 3 funds or daily cap too low, 4 buyer has no ML-KEM key, 5 request envelope missing or unreadable, 6 a supplier failed.
- Demo buyer (owner CLI): `demo-buyer init` (key from a mnemonic, funded by the treasury, ML-DSA and ML-KEM keys, card), `demo-order <slug> "<input>"` (seals, posts, approves, buys; prints the order id), `demo-report <slug> <orderId>` (opens the delivered report with the buyer keys).
- Payments relayed as `MsgExecuteEVM` emit no EVM logs; `chainPayments` adds `relayedPayments` (tx index) to the SupplierPaid logs, and the suppliers read the relayer address from `API_URL/v1/relayer` at startup. See `RESULTS.md`.
- Orders are handled one at a time per spender: the spender's auth nonce and the tool-callback mutex rely on it. Add per-spender serialization before adding any concurrency.
- Payment verification reads the tx index (`relayedPayments`, `limit`/`page` paging, newest first, bounded by the vault's start block), because `MsgExecuteEVM` emits no EVM logs. Any HTTP or parse error throws; a partial list could pay a supplier twice.
- Relay failures: only `refused` and `execution_failed` decline (code 6); `unconfirmed` and `not_broadcast` fail the order for a retry, and the next run's chain probe sees whether the payment landed. Step tags (`[relay]`, `[supplier]`, ...) appear in logs only.

## Runtime keys without key files

- `ENGINE_KEYS_JSON` (an object of `{ "<slug>-agent": {ed25519}, "<slug>-operator": {privateKey}, "<slug>-seal": {seed} }`) makes the agent runner use a read-only in-memory keystore; unset, it uses `KEYS_DIR` files as before. Bad JSON is rejected with an error that names the variable only. `runtimeBundle` in `src/runtime-keys.ts` builds it from the keystore and drops every other field (mnemonics, recovery codes).
- Supplier addresses are public and committed in `packages/qore/src/suppliers.json` (`bun run owner suppliers-json` writes it; `@qredit/qore` exports it as `SUPPLIERS` with display names in `SUPPLIER_NAMES`, so the web app reads the same addresses); spender `qor1` addresses are derived from `deployments.json`. Neither the runner nor the suppliers read spender, treasury or supplier key files.
- `bun run owner runtime-keys check` lists which runtime fields exist locally (names only). `bun --env-file=.env scripts/runtime-keys-proof.ts` rebuilds the runtime from an in-process bundle with an empty `KEYS_DIR`.
