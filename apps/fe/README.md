# Qredit web app

The Qredit web app, served at app.qredit.fun. It shows businesses, loans and proofs from the QoreChain testnet and the Qredit backend.

## Stack

| Need             | Use                                                                                   | Version       |
| ---------------- | ------------------------------------------------------------------------------------- | ------------- |
| Framework        | Next.js (App Router, Turbopack), TypeScript strict                                    | 16.4.6        |
| UI runtime       | React                                                                                 | 19.3.0        |
| Styling          | Tailwind CSS                                                                          | 4.3.3         |
| Components       | shadcn/ui on Base UI (`base-nova` preset), lucide-react, Sonner                       | shadcn 4.23.0 |
| Fonts and themes | Geist (`geist` 1.9.2), next-themes 0.4.6 (light, dark, system)                        |               |
| Server data      | axios, TanStack Query 5                                                               |               |
| Chain            | viem 2.58.6, `@qorechain/sdk` and `@qorechain/evm` 0.14.0, `@qredit/qore` (workspace) |               |
| Tests            | Vitest 5.1.2, Testing Library                                                         |               |
| Lint and format  | ESLint, Prettier                                                                      |               |

## Scripts

Run from the repo root once with `bun install`, then inside `apps/fe`:

- `bun dev` starts the dev server.
- `bun run build` and `bun run start` build and serve production.
- `bun run test`, `bun run typecheck`, `bun run lint`, `bun run format`.

Environment: `cp .env.example .env.local` and fill the values. `.env.local` is never committed.

## Folder map

```
src/
  app/          routes only, Providers.tsx, globals.css (design tokens)
  components/   ui (shadcn), shared (page states), layout
  hooks/        app-wide hooks
  lib/          apiClient, queryClient, env, format, schemas, utils
  modules/      one folder per domain, added with each feature
```

UI values: [docs/ui-profile.md](../../docs/ui-profile.md). Contributor rules: [CLAUDE.md](./CLAUDE.md).
