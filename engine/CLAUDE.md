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
- Known live finding: a payment relayed as `MsgExecuteEVM` changes vault and token balances but emits no EVM log visible through `eth_getLogs`, so log-based payment checks (suppliers, `paidOnChain`) do not see it. See `RESULTS.md`.
