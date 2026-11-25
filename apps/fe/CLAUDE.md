# CLAUDE.md — apps/fe

Guidance for AI coding agents working in `apps/fe`. Update this file in the same commit when you change how the app works.

## What this is

The Qredit web app (Next.js, App Router), served at app.qredit.fun. It reads the QoreChain testnet and the Qredit backend and shows businesses, loans and proofs. UI values live in `docs/ui-profile.md`; the design source is `design/qredit.pen`, read only through the Pencil MCP and never edited.

## Structure

It follows the frontend-starter-kit shape: `app/` at the app root holds thin routes only; everything else lives in `src/`, and each business domain lives in `src/modules/<module>` with `api/`, `components/` and `schemas/`; app-wide pieces live in `components/shared`, `components/ui` (shadcn on Base UI), `hooks`, `lib` and `config`. Import with `@/` only. Components never call axios, fetch or viem directly: module api function, then hook, then component. Money and dates go only through `src/lib/format.ts`. Types come from zod (`z.infer`).

## Rules

- **Honest data.** A failed or empty load shows its state (error with retry, empty, skeleton). Never show sample or default values in place of real data. A claim that cannot be checked shows "Not proven yet".
- **REST access.** The chain REST API sends no CORS headers, so the browser reaches it only through `/api/chain/rest`. The EVM RPC is called directly.
- **Tests live in `src/test/`, mirroring the source tree.** `src/lib/format.ts` is tested in `src/test/lib/format.test.ts`; `app/layout.tsx` in `src/test/app/layout.test.tsx`. No `*.test.*` file lives anywhere else. Import code under test with `@/` when it sits in `src`, and with a relative path when it sits in `app/`.
- **No secrets.** No key, mnemonic or Supabase key is ever imported, stored or read server-side in this app. Only `NEXT_PUBLIC_*` public URLs.
- **Copy.** Formal English, complete sentences, no contractions, no slang or idioms, no abbreviations such as "min". No technical words such as "API" outside the Proof page. Mentions of Qredit use the inline wordmark.
- **No dividers.** No thin divider lines in lists, cards or tables; separate with spacing. Cards in a grid share structure and height.
- **Address inside a link: keep copyable off.** `Address` has no copy button by default so it can sit inside a link card without nesting a button in a link. Pages opt in with `copyable`.
- **Touch and focus.** Interactive elements are 44 px on coarse pointers; every one uses `focusRing` from `src/lib/utils.ts`.
- **Fonts.** Geist for all text; Geist Mono only for addresses and hashes; tabular numerals for every figure.

## Motion

Follows the `motion-rules` skill. Tokens in `globals.css`: `--ease-out` cubic-bezier(0.23, 1, 0.32, 1), `--ease-in-out` cubic-bezier(0.77, 0, 0.175, 1), `--ease-drawer` cubic-bezier(0.32, 0.72, 0, 1). Press scale 0.97 at 120 ms; enter 200 ms (fade and 8 px rise); exit 150 ms; important numbers crossfade and never count up. `prefers-reduced-motion` drops movement and keeps fades. Library components (Sonner, drawer, dialog) keep their own motion.

| Moment                                     | How often        | Motion                                 |
| ------------------------------------------ | ---------------- | -------------------------------------- |
| Page navigation, tab switch, theme switch  | Many times a day | None (instant)                         |
| Cards and lists appearing after load       | Many times a day | Skeleton crossfades to content, 200 ms |
| Proof check finishing                      | Sometimes        | Status badge crossfade, 200 ms         |
| Business state changing (Raising → Active) | Rare             | Badge crossfade, no spring             |

Skeletons shimmer (slow linear sweep, `animate-shimmer` in `globals.css`), never pulse; always use the `Skeleton` component. Reduced motion shows them static.

## Notes

- `@qredit/qore` ships raw TypeScript, so `next.config.ts` lists it in `transpilePackages`.
- `components/ui/button.tsx` is customised (press feedback, coarse-pointer sizing, no `pointer-events-none` on disabled). After any `shadcn add`, check `git diff src/components/ui` and restore it.
- `src/lib/utils.ts` is hand-written (clsx and tailwind-merge) because `shadcn init` generated a re-export from an unrelated `cn` package.
- `public/agents`, `public/empty` and `public/art` hold the images copied from `design/` (agent marks, state art, KPI feature art); each has a light and a dark file that the component switches with `dark:`. `src/config/wordmark.ts` holds the outlined wordmark paths exported from the design.
- `AppShell` wraps every page: top bar from tablet up, phone header, and the phone tab bar on top-level routes only. The page area is a flex column so `EmptyState` and `ErrorState` fill it. The not-found page passes `pathname=""` because the server cannot see the address of an unmatched route; without it the client marks a section active and adds the tab bar, which is a hydration mismatch.
- `src/modules/market` holds the Market page: `api/` (api functions, keys, hooks), `lib/` (pure totals and filter helpers), `components/`, `schemas/`. Loan state, raised, repaid and lender share are read from each vault on chain; businesses and orders come from the Qredit backend; the time of an order is the timestamp of its block. The filter lives in the address (`?state=`).
- Shared helpers: `lib/vaultState.ts` (chain state number to name), `lib/chain.ts` `readVault` (typed vault reads, the only place for the ABI cast), `lib/serviceName.ts`, `components/shared/StaleNotice.tsx` (shown when a query has data and `isRefetchError`, so old figures never look live), `countDelivered` in the market module (count plus a `capped` flag; a capped count is shown as "at least"). "Total lent" counts only Active, Trapped and Repaid vaults. The REST proxy refuses any path segment that is empty, a dot segment, or holds `%`, `/`, `\`, `?` or `#`, and sends `no-store` for non-2xx answers.
- Run the dev server on port 3000: the backend allows only `http://localhost:3000`, `https://app.qredit.fun` and `https://qredit.fun` as origins, so another port shows the error state.
- `src/modules/business` holds the Business page (`/agents/[slug]`): header, loan figures and terms from the vault, spending rules, orders, services and the decision log. Supplier addresses are decoded once from the vault's creation call (cached for good); their current caps and the daily cap come from the vault. Limitation: a signed policy order can add a supplier after the creation, and such a supplier is not listed, so the copy says "created with" and never claims the list is exclusive. A section that fails shows its own error and the rest of the page stays. Supplier names come from `@qredit/qore` (`SUPPLIERS`, `SUPPLIER_NAMES`, generated address file `packages/qore/src/suppliers.json`); an unknown address shows as an address. `OrderStatusBadge` lives in `components/shared` because Market and Business both use it. The backend returns at most `ORDERS_LIMIT` (100) newest orders per vault, so a count made from the list says "in the latest 100 orders" when the list is that long.
- `src/modules/proof` holds the Proof page (`/proof`, tabs Claims and Attacks in `?tab=`) and the "N of 6 proven" card on the Business page. `checks.ts` has the pure judges (one per check), `api/proof.api.ts` runs the six checks against the chain (each isolated: a check that cannot run is `unknown` and shows "Not proven yet", never a pass), and `useProofQuery` shares one query key per business between the page and the card. The factory code hash is cached for good. REST reads go through `restUrl()` and its allowlisted proxy. The business list is the Market query. `src/config/attacks.ts` lists the eleven attacks of the spec; `txHash` is set only where `engine/RESULTS.md` or `engine/spikes/RESULTS.md` records a transaction that shows that attack stopped (an EVM hash links to the explorer, a Cosmos hash shows as text); otherwise it is `null` and the card says "Not recorded yet". A failing check is reported as it is, never changed to pass.
