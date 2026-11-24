# CLAUDE.md — engine

Qredit's agents, simulated suppliers and the owner CLI. Bun; shared chain code comes from `@qredit/qore`.

- Owner CLI: `bun run owner <command>` (see `src/cli/owner.ts` usage). Commands are idempotent: re-running skips what already exists.
- Keys live in `engine/.keys/` (gitignored); files are created with flag `wx` and never printed. `businesses.json` (public parameters) and `deployments.json` (public addresses) are committed.
- The engine holds only agent keys, operator classical keys and supplier addresses; it never holds the relayer or treasury keys at runtime (the owner CLI uses the treasury only during setup).
- Tests: `bun test` (offline). Chain-touching commands are exercised live, never in unit tests.
- `spikes/` is the earlier testnet spike toolkit; it is not part of the workspace.
- `seal-keys <slug>|all` creates `<slug>-seal` (seed, wx), registers its ML-KEM key on the spender and uploads the signed recipient card; `src/agent/seal.ts` holds the request and report codec.
- Expiry: the agent-key link (`business create`) expires after 30 days; re-link it before then. Operator windows last about 6.9 h (17,280 blocks); the backend's window keeper renews them once `be-env` has written OPERATOR_KEYS. `ensureWindow` reuses a live window only if it covers the targets and has room, so owner commands open windows automatically; `windows` is a manual refresh.
