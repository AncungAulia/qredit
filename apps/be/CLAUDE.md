# CLAUDE.md — apps/be

The Qredit backend (api.qredit.fun): mailbox API, relayer, vault watcher, operator-window keeper, test-funds faucet. Bun + Hono + Supabase Postgres (schema `qredit`).

- Run: `bun run dev` (reads `.env`). Tests: `bun test` (PGlite in-process, no network). Types: `bun run typecheck`.
- Migrations: add `migrations/NNN_name.sql`; never edit an applied one. `bun run migrate` applies pending files; the server also applies them at boot.
- Every module takes its dependencies as arguments (db, chain adapters); keep it that way so tests stay offline.
- This process holds the relayer, treasury and operator keys and runs no AI. Engine routes require `Authorization: Bearer $ENGINE_TOKEN`.
- Read the repo-root CLAUDE.md rules; secrets only in `.env`.
