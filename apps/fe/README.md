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

Environment: `cp .env.example .env.local` and fill the values listed under Environment variables. `.env.local` is never committed.

## Environment variables

`.env.example` lists the names only. All of these are public addresses (no secret), and the values are the same for local development and production. The `NEXT_PUBLIC_*` values are inlined into the browser bundle at build time.

| Name                        | Value                             |
| --------------------------- | --------------------------------- |
| `NEXT_PUBLIC_API_URL`       | `https://api.qredit.fun`          |
| `NEXT_PUBLIC_QORE_EVM_URL`  | `https://evm-testnet.qore.host`   |
| `NEXT_PUBLIC_QORE_CHAIN_ID` | `qorechain-diana`                 |
| `NEXT_PUBLIC_EXPLORER_URL`  | empty (no explorer link is shown); testnet: `https://dashboard.qorechain.io/explorer` (it opens on Mainnet; pick Testnet once in its top-right toggle) |
| `QORE_REST_URL`             | `https://api-testnet.qore.host`   |
| `QORE_RPC_URL`              | `https://rpc-testnet.qore.host`   |

The server-only names (`QORE_REST_URL`, `QORE_RPC_URL`) are read by the two proxies and never reach the browser bundle. No key, phrase or Supabase key is used anywhere in this app.

## Pages

| Route                          | What it shows                                                                                  |
| ------------------------------ | ---------------------------------------------------------------------------------------------- |
| `/`                            | Market: businesses, totals and the loan state read from each vault                             |
| `/agents/[slug]`               | One business: loan figures, rules, orders, services, decision log, "Buy a report"               |
| `/shop/[slug]`                 | New order: the request is sealed in the browser, then paid in fUSD from the test wallet         |
| `/lend`                        | My lending: positions, lend, claim and refund (test wallet)                                     |
| `/inbox`                       | Orders placed by the test wallet and their sealed reports                                      |
| `/inbox/[vault]/[orderId]`     | One report, opened in the browser with the wallet's inbox key; reclaim after the deadline       |
| `/owner`                       | Owner console: signed policy orders (QoreX signs, the test wallet submits)                      |
| `/proof`                       | Proof checks against the chain, and the attack list                                            |

## Test wallet

The test wallet is a throwaway testnet wallet. It holds no real money and exists only to try Qredit.

- **What it is.** A wallet made in the browser from a 24-word recovery phrase. It signs every transaction the app sends (lend, buy, claim, refund, reclaim and submitting a policy order), also when QoreX is connected, because QoreX cannot send EVM transactions.
- **Where it is stored.** Only in this browser, in `localStorage` under the key `qredit.testWallet.v1`. The record holds the address, a salt, an initialisation vector and the encrypted secret. Nothing is sent to a server. Disconnect (in the account menu) keeps this record and sets `qredit.testWallet.disconnected`, so the app shows Connect instead of Locked until the wallet is unlocked again. The theme and the time of the next allowed faucet claim (kept in `sessionStorage`) are the only other values the app stores.
- **Encryption.** The password goes through PBKDF2 (600,000 rounds) to an AES-GCM key, and the address is bound as additional data. The phrase is shown once at creation and is never kept: after the keys are derived, only the encrypted record and the unlocked session in memory remain. A page reload locks the wallet.
- **Back up.** Account menu, "Back up phrase": confirm, enter the password, then the phrase is shown. Write it down; it cannot be recovered from Qredit.
- **Forget.** The unlock view offers "Forget this wallet", which deletes the record from this browser after a confirmation. Without the phrase the wallet is gone.
- **Faucet limit.** The faucet gives 2 QOR and 50 fUSD once per address and network address in 24 hours. When it answers that the limit is reached, the setup shows the time of the next claim. The wallet can also be funded from QoreX by sending QOR and fUSD to the wallet address shown in the account menu.
- **Setup.** Five resumable steps: get test funds, register the post-quantum key, prepare fUSD for payments, register the inbox key, publish the inbox card. Each step can be repeated safely.

## QoreX

QoreX is the browser wallet extension of QoreChain. Qredit uses it to identify a business owner and to sign policy orders in the Owner console. Switch it to the testnet first: open QoreX and tap the version text seven times. If QoreX is missing or rejects the connection, the app says so and offers the test wallet.

## Proxies

The chain nodes send no CORS headers, so the browser reaches them through two route handlers. Both forward only what the app needs and answer `no-store` for errors. The EVM RPC is called directly.

- **REST, `GET /api/chain/rest/<path>`** (upstream `QORE_REST_URL`). GET only. A path must start with one of: `qorechain/pqc/v1/account/`, `qorechain/pqc/v1/kem/`, `qorechain/pqc/v1/evm_window/`, `qorechain/abstractaccount/v1/accounts/`, `cosmos/bank/v1beta1/balances/`, `cosmos/auth/v1beta1/accounts/`, `cosmos/tx/v1beta1/txs/`, `cosmos/upgrade/v1beta1/applied_plan/`, or equal `qorechain/pqc/v1/protocol_features`. A segment that is empty, a dot segment, or that holds `%`, `/`, `\`, `?` or `#` is refused.
- **JSON-RPC, `POST /api/chain/rpc`** (upstream `QORE_RPC_URL`). One request per call (no batches, at most 64 KB). The method must be `status`, `broadcast_tx_sync` or `tx_search`; `tx_search` accepts only a `tx.hash='<64 hex>'` query with at most 10 results per page. Only signed transactions pass through it.

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

Environment variables (Settings, Environment Variables): set every name from the table under Environment variables above. Set them before the first build and redeploy after any change, because the `NEXT_PUBLIC_*` values are inlined at build time.

Domain: in Settings, Domains, add `app.qredit.fun`. Vercel then shows a `CNAME` value for the project (for example `d1d4fc829fe7bc7c.vercel-dns-017.com`; use the exact value shown, never one from another project). In the Hostinger DNS zone of `qredit.fun`, add a record of type `CNAME`, name `app`, with that value, and remove any other `A`, `AAAA` or `CNAME` record named `app`. The backend already allows the origin `https://app.qredit.fun`.

After the first deploy, open `https://app.qredit.fun` and check that the Market page shows real data (not the error state) and that `/proof` runs its checks. The install command and the build with the workspace package are not proven on Vercel until that first deploy.

Sources: the Vercel documentation pages "Using Monorepos", "Configuring a Build" (Root Directory, Install Command), "Package Managers" (Bun detection from `bun.lock`) and "Adding and Configuring a Custom Domain" (subdomain `CNAME`).

UI values: [docs/ui-profile.md](../../docs/ui-profile.md). Contributor rules: [CLAUDE.md](./CLAUDE.md).
