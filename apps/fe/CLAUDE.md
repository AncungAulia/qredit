# CLAUDE.md — apps/fe

Guidance for AI coding agents working in `apps/fe`. Update this file in the same commit when you change how the app works.

## What this is

The Qredit web app (Next.js, App Router), served at app.qredit.fun. It reads the QoreChain testnet and the Qredit backend and shows businesses, loans and proofs. UI values live in `docs/ui-profile.md`; the design source is `design/qredit.pen`, read only through the Pencil MCP and never edited.

## Structure

It follows the frontend-starter-kit shape: `src/app` holds thin routes only; each business domain lives in `src/modules/<module>` with `api/`, `components/` and `schemas/`; app-wide pieces live in `components/shared`, `components/ui` (shadcn on Base UI), `hooks`, `lib` and `config`. Import with `@/` only. Components never call axios, fetch or viem directly: module api function, then hook, then component. Money and dates go only through `src/lib/format.ts`. Types come from zod (`z.infer`).

## Rules

- **Honest data.** A failed or empty load shows its state (error with retry, empty, skeleton). Never show sample or default values in place of real data. A claim that cannot be checked shows "Not proven yet".
- **REST access.** The chain REST API sends no CORS headers, so the browser reaches it only through `/api/chain/rest`. The EVM RPC is called directly.
- **No secrets.** No key, mnemonic or Supabase key is ever imported, stored or read server-side in this app. Only `NEXT_PUBLIC_*` public URLs.
- **Copy.** Formal English, complete sentences, no contractions, no slang or idioms, no abbreviations such as "min". No technical words such as "API" outside the Proof page. Mentions of Qredit use the inline wordmark.
- **No dividers.** No thin divider lines in lists, cards or tables; separate with spacing. Cards in a grid share structure and height.
- **Fonts.** Geist for all text; Geist Mono only for addresses and hashes; tabular numerals for every figure.

## Motion

Follows the `motion-rules` skill. Tokens in `globals.css`: `--ease-out` cubic-bezier(0.23, 1, 0.32, 1), `--ease-in-out` cubic-bezier(0.77, 0, 0.175, 1), `--ease-drawer` cubic-bezier(0.32, 0.72, 0, 1). Press scale 0.97 at 120 ms; enter 200 ms (fade and 8 px rise); exit 150 ms; important numbers crossfade and never count up. `prefers-reduced-motion` drops movement and keeps fades. Library components (Sonner, drawer, dialog) keep their own motion.

| Moment                                     | How often        | Motion                                 |
| ------------------------------------------ | ---------------- | -------------------------------------- |
| Page navigation, tab switch, theme switch  | Many times a day | None (instant)                         |
| Cards and lists appearing after load       | Many times a day | Skeleton crossfades to content, 200 ms |
| Proof check finishing                      | Sometimes        | Status badge crossfade, 200 ms         |
| Business state changing (Raising → Active) | Rare             | Badge crossfade, no spring             |

## Notes

- `@qredit/qore` ships raw TypeScript, so `next.config.ts` lists it in `transpilePackages`.
- `components/ui/button.tsx` is customised (press feedback, coarse-pointer sizing, no `pointer-events-none` on disabled). After any `shadcn add`, check `git diff src/components/ui` and restore it.
- `src/lib/utils.ts` is hand-written (clsx and tailwind-merge) because `shadcn init` generated a re-export from an unrelated `cn` package.
