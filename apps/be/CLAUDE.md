# CLAUDE.md — apps/be

The Qredit backend (api.qredit.fun): mailbox API, relayer, vault watcher, operator-window keeper, test-funds faucet. Bun + Hono + Supabase Postgres (schema `qredit`).

- Run: `bun run dev` (reads `.env`). Tests: `bun test` (PGlite in-process, no network). Types: `bun run typecheck`.
- Migrations: add `migrations/NNN_name.sql`; never edit an applied one. `bun run migrate` applies pending files; the server also applies them at boot.
- Every module takes its dependencies as arguments (db, chain adapters); keep it that way so tests stay offline.
- This process holds the relayer, treasury and operator keys and runs no AI. Engine routes require `Authorization: Bearer $ENGINE_TOKEN`.
- Read the repo-root CLAUDE.md rules; secrets only in `.env`.

## Smoke test on qorechain-diana

- `/health`, `/v1/relayer`, `/v1/envelopes` answered against Supabase (schema `qredit`, migration 001 applied).
- `/v1/faucet` sent test QOR and faucet fUSD in one hybrid `MsgSend`: tx `1184BE3C661EF9F07C37C1C29944E0E2BDB73E5104713571BED3D3E3524C612E`; a second call within the cooldown answered 429.
- Relay and window renewal are exercised end to end in the engine plan, once the agent vaults exist.

## Public exposure

- Client ip = the `x-forwarded-for` entry the trusted proxy appended (`TRUSTED_PROXY_HOPS`, default 1; 0 ignores the header), else the socket peer. Leftmost entries are never trusted. The origin must be reachable only through the proxy, otherwise a direct caller can set the header.
- Body limits: 300 KB for `POST /v1/envelopes`, 16 KB elsewhere (413); `Bun.serve` caps at 512 KB.
- Rate limits (`RATE_ENVELOPES_PER_MIN` 30, `RATE_CARDS_PER_MIN` 10, `RATE_FAUCET_PER_MIN` 5, per client ip, 429 with `retryAfter`) are in memory and **per instance**: this is a single-instance deployment; scaling out needs a shared store. Engine-authenticated envelope posts are not limited.
- The faucet also has a global cap (`FAUCET_DAILY_CAP`, default 200 grants per rolling 24 h, 503 when reached). A grant is cancelled only when nothing was broadcast (`BroadcastRefused`); once a hash may exist it is never released.
- `/v1/decisions` (GET) is public by design: the decision log is a transparency feature and contains no private data.
