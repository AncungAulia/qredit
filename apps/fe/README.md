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
app/            routes only (App Router root), Providers.tsx, globals.css (design tokens)
src/
  components/   ui (shadcn), shared (page states), layout
  hooks/        app-wide hooks
  lib/          apiClient, queryClient, env, format, schemas, utils
  modules/      one folder per domain, added with each feature
  test/         every unit and component test, mirroring the source tree
```

Tests live in `src/test/`, mirroring the source tree: `src/lib/format.ts` is tested in `src/test/lib/format.test.ts`, and `app/layout.tsx` in `src/test/app/layout.test.tsx`.

## Deploy

The app is hosted on Vercel at app.qredit.fun. Create one Vercel project from the Git repository and set the following in the project settings (Build and Deployment, unless noted).

| Setting                      | Value                                                                                                                         |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Framework Preset             | Next.js (detected)                                                                                                            |
| Root Directory               | `apps/fe`                                                                                                                     |
| Files outside Root Directory | Leave "Include files outside the root directory in the Build Step" on (the default). The app imports `packages/qore` from it. |
| Install Command (override)   | `cd ../.. && bun install --frozen-lockfile`                                                                                   |
| Build Command                | Default (`bun run build` also works)                                                                                          |
| Output Directory             | Default                                                                                                                       |

Why the install command is overridden: the install path follows the Root Directory, while the workspace lockfile `bun.lock` and the `workspaces` list are in the repository root. Installing from the root links `@qredit/qore` into `apps/fe`. Vercel detects Bun from `bun.lock` and uses Bun 1, so no `vercel.json` is needed. To pin a Bun release, use `bunx bun@1.3.13 install --frozen-lockfile` from the root.

Environment variables (Settings, Environment Variables; the names are in `.env.example`). The `NEXT_PUBLIC_*` values are inlined into the browser bundle at build time, so set them before the first build and redeploy after any change.

| Name                        | Production value                  |
| --------------------------- | --------------------------------- |
| `NEXT_PUBLIC_API_URL`       | `https://api.qredit.fun`          |
| `NEXT_PUBLIC_QORE_EVM_URL`  | `https://evm-testnet.qore.host`   |
| `NEXT_PUBLIC_QORE_CHAIN_ID` | `qorechain-diana`                 |
| `NEXT_PUBLIC_EXPLORER_URL`  | empty (no explorer link is shown) |
| `QORE_REST_URL`             | `https://api-testnet.qore.host`   |

Domain: in Settings, Domains, add `app.qredit.fun`. Vercel then shows a `CNAME` value for the project (for example `d1d4fc829fe7bc7c.vercel-dns-017.com`; use the exact value shown, never one from another project). In the Hostinger DNS zone of `qredit.fun`, add a record of type `CNAME`, name `app`, with that value, and remove any other `A`, `AAAA` or `CNAME` record named `app`. The backend already allows the origin `https://app.qredit.fun`.

After the first deploy, open `https://app.qredit.fun` and check that the Market page shows real data (not the error state) and that `/proof` runs its checks. The install command and the build with the workspace package are not proven on Vercel until that first deploy.

Sources: the Vercel documentation pages "Using Monorepos", "Configuring a Build" (Root Directory, Install Command), "Package Managers" (Bun detection from `bun.lock`) and "Adding and Configuring a Custom Domain" (subdomain `CNAME`).

UI values: [docs/ui-profile.md](../../docs/ui-profile.md). Contributor rules: [CLAUDE.md](./CLAUDE.md).
