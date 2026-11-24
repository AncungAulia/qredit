# CLAUDE.md — Qredit (repo root)

Guidance for AI coding agents working in this repo. When a folder gets its own `CLAUDE.md`, read it before changing that folder, and update it in the same commit when you change how the folder works.

## What this is

Qredit is a credit market for AI agent businesses on the QoreChain testnet, built for Build Before Q-Day: The QoreChain Developer Fest (Post-Quantum AI Agents). The design is `docs/superpowers/specs/2026-11-24-qredit-design.md`; implementation plans are in `docs/superpowers/plans/`.

## Layout

| Folder | What |
|---|---|
| `apps/web` | Web app (Next.js) |
| `apps/be` | Backend: mailbox API, relayer, watcher (Supabase); holds the relayer key, no AI |
| `engine` | The agents (Mastra), simulated suppliers, owner CLI; never holds the relayer key; `engine/spikes` holds the testnet spikes |
| `sc` | Smart contracts (Foundry): `LoanVault`, `VaultFactory` |
| `docs` | Spec, plans, threat model |

## Network

Testnet only: chain id `qorechain-diana`, EVM chain id 9800. PQC precompiles in lowercase: `pqcVerify` 0x…0a01, `pqcKeyStatus` 0x…0a02. fUSD `0x97143B771D34ddb9130b807b135Ae675A5a963CA`.

## Rules

1. **Use evidence, not assumptions.** "Works", "safe" or "done" must be backed by test output, a transaction hash or a log seen in this session; otherwise write "not proven yet".
2. **Verify QoreChain facts** against the installed package types (`node_modules/@qorechain/*/dist/*.d.ts`) and docs.qorechain.io before relying on them. Pin package versions; do not upgrade mid-build.
3. **Secrets never enter git.** Keys, mnemonics, recovery codes and `.env` files stay in gitignored paths (`engine/spikes/.keys/`, `.env`). Each folder keeps a `.env.example` with names only. The Supabase service-role key lives only in `apps/be` and `engine`, never in `apps/web`.
4. **Everything in the repo is in English.** Never mention how long the project took or a day-by-day schedule in any committed file.
5. **Stop and ask when blocked.** If a test fails twice, an API differs from the plan, or an instruction is ambiguous, stop and report what you saw, what you tried and the options. Do not change scope or design on your own.

## Commits

Small commits, one logical step each, each building and passing its tests. Conventional prefix with a scope (`feat(sc): …`, `test(engine): …`, `docs: …`). The body says why and which tests ran.
