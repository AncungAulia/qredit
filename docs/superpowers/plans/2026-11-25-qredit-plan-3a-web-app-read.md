# Qredit Plan 3a: Web App Foundation and Read-Only Pages — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create `apps/fe` (app.qredit.fun) with the Qredit design system and the pages that need no wallet: the market, the business page, the proof page and the 404 page, all reading live data from the chain and from `api.qredit.fun`.

**Architecture:** A Next.js App Router app in the Bun workspace. Pages are thin; each domain lives in `src/modules/<module>` (api, components, schemas). Chain reads go through viem against the EVM RPC (CORS open) and through a small allowlisted proxy route for the Cosmos REST API (no CORS headers). Shared chain constants, ABIs and address helpers come from `@qredit/qore` (made browser-safe in Task 1). Wallet, lending, ordering, inbox and owner pages are Plan 3b; the landing page is Plan 3c.

**Tech Stack:** Bun 1.3.13, Next.js (latest, App Router, TypeScript strict, `src/`), React 19, Tailwind CSS 4, shadcn/ui (Base UI) + lucide-react, Sonner, axios + TanStack Query, zod, next-themes, viem 2, `@qorechain/sdk` 0.14.0, `@qorechain/evm` 0.14.0, Vitest + Testing Library, ESLint + Prettier.

## Global Constraints

- Package manager is **Bun** (`bun`, `bunx`). Never run npm or pnpm. Bun version for builds: 1.3.13.
- Testnet only: Cosmos chain id `qorechain-diana`, EVM chain id 9800. fUSD `0x97143B771D34ddb9130b807b135Ae675A5a963CA`, **6 decimals**. Factory `0xAc5324088A7735dda922c277db5A2E906c8f5b3A`.
- Endpoints: EVM `https://evm-testnet.qore.host`, REST `https://api-testnet.qore.host`, API `https://api.qredit.fun`.
- The REST API sends no CORS headers, so the browser reaches it only through `/api/chain/rest/...` (Task 4). The EVM RPC allows any origin and is called directly.
- No Supabase key, no private key, no mnemonic ever enters `apps/fe`. Only `NEXT_PUBLIC_*` values that are public URLs.
- **Honest data:** a failed or empty load shows its state (error with retry, empty, loading skeleton). Never show sample or default values in place of real data. A claim that cannot be checked shows "Not proven yet".
- **UI copy is formal English:** complete sentences, no contractions, no slang or idioms, no abbreviations such as "min". No technical words such as "API" outside the Proof page. Mentions of Qredit inside UI copy use the inline wordmark.
- **Design source:** `design/qredit.pen`, read only through the Pencil MCP (`mcp__pencil__execute` with `Get(id, {depth, resolveVariables:true})` and `TakeScreenshot([id])`). Do not edit the design. Frame ids are listed per task.
- **Visual rules:** monochrome with one accent (Glacier `#5CB8F5`, dark `#7CC8FA`); Geist for all text, Geist Mono only for addresses and hashes; tabular numerals for every figure; no thin divider lines in lists, cards or tables (separate with spacing); cards in a grid share structure and height; light and dark themes plus System.
- **Navigation:** top navbar Market · Lend · Inbox · Proof on tablet and desktop; bottom tab bar on phone top-level pages only; detail pages on phone have no tab bar. Lend and Inbox links exist in Plan 3a but their pages arrive in Plan 3b; until then they render the 404 page (no placeholder pages).
- **Breakpoints:** phone < 768 px, tablet 768–1279 px, desktop ≥ 1280 px. Design frames are 390, 834 and 1440 wide. No horizontal scroll at 390, 834, 1440. Touch targets 44 px on coarse pointers.
- **Motion:** follow the `motion-rules` skill: `--ease-out: cubic-bezier(0.23, 1, 0.32, 1)`, `--ease-in-out: cubic-bezier(0.77, 0, 0.175, 1)`, `--ease-drawer: cubic-bezier(0.32, 0.72, 0, 1)`; press scale 0.97 at 120 ms; enter 200 ms fade + 8 px rise; exit 150 ms; important numbers crossfade, never count up; `prefers-reduced-motion` drops movement.
- **Code rules:** SOLID, DRY; components never call axios, fetch or viem directly (module api function → hook → component); money and dates only through `src/lib/format.ts`; types come from zod (`z.infer`); `app/` files stay thin; files over ~250 lines are split; `@/` imports only.
- Repo text in English. Never mention how long anything took or a schedule in a committed file.
- Commits: conventional prefix with scope (`feat(fe): …`, `refactor(qore): …`), body says why and which tests ran, ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

---

## File map

```
packages/qore/
  src/address.ts            (modify) hex via @scure/base, no Buffer
  src/keys.ts               (modify) hex via @scure/base, no Buffer
  src/relayed.ts            (modify) base64 via @scure/base, no Buffer
  src/generated/abis.ts     (create, generated) full LoanVault + VaultFactory ABIs, factory code hash
  scripts/export-abi.ts     (create) writes src/generated/abis.ts from sc/out
  test/address.test.ts      (create)
  test/generated.test.ts    (create)
apps/fe/
  package.json, next.config.ts, tsconfig.json, eslint.config.mjs, prettier.config.mjs,
  vitest.config.mts, vitest.setup.ts, components.json, .env.example, README.md, CLAUDE.md
  public/agents/*.png       mascot art copied from design/agents
  public/empty/*.png        empty-state art copied from design/empty
  src/app/layout.tsx, Providers.tsx, globals.css, not-found.tsx, page.tsx
  src/app/agents/[slug]/page.tsx
  src/app/proof/page.tsx
  src/app/api/chain/rest/[...path]/route.ts
  src/lib/env.ts, apiClient.ts, queryClient.ts, format.ts, chain.ts, schemas.ts, utils.ts
  src/config/nav.ts, businesses.ts, attacks.ts
  src/components/ui/*       shadcn
  src/components/shared/    PageStates.tsx, Address.tsx, Amount.tsx, StateBadge.tsx, LoanBar.tsx,
                            BusinessMark.tsx, KpiTile.tsx, InlineWordmark.tsx, TxLink.tsx
  src/components/layout/    TopBar.tsx, MobileHeader.tsx, TabBar.tsx, ThemeButton.tsx, Logo.tsx, AppShell.tsx
  src/modules/market/       api/, components/, schemas/, index.ts
  src/modules/business/     api/, components/, schemas/, index.ts
  src/modules/proof/        api/, components/, checks.ts, index.ts
docs/ui-profile.md          (create)
package.json                (modify) add apps/fe to workspaces
```

---

### Task 1: Make `@qredit/qore` browser-safe and export the full ABIs

The web app imports `@qredit/qore` in the browser. Today `address.ts`, `keys.ts` and `relayed.ts` use Node's global `Buffer`, and the committed vault ABI is partial (no `orders`, `books`, `lenderClaimable`, `all`, `vaultAt`…). This task removes `Buffer` and adds generated full ABIs, without changing any existing export.

**Files:**
- Modify: `packages/qore/src/address.ts`, `packages/qore/src/keys.ts:34`, `packages/qore/src/relayed.ts:21`, `packages/qore/src/index.ts`
- Create: `packages/qore/scripts/export-abi.ts`, `packages/qore/src/generated/abis.ts`
- Test: `packages/qore/test/address.test.ts`, `packages/qore/test/generated.test.ts`

**Interfaces:**
- Produces: `LOAN_VAULT_ABI` (full, `as const`), `VAULT_FACTORY_ABI` (full, `as const`), `FACTORY_RUNTIME_CODEHASH: \`0x${string}\`` exported from `@qredit/qore`. Existing `qorToHex`, `hexToQor`, `accountFrom`, `relayedPayments` keep their signatures.

- [ ] **Step 1: Write the failing address test**

`packages/qore/test/address.test.ts`:
```ts
import { describe, expect, test } from "bun:test";
import { hexToQor, qorToHex } from "../src/address.ts";

const HEX = "0x487f449c21a48eaf9d2eb3804f511dfb7715eea9";

describe("address", () => {
  test("round-trips a 20-byte address", () => {
    const qor = hexToQor(HEX);
    expect(qor.startsWith("qor1")).toBe(true);
    expect(qorToHex(qor)).toBe(HEX);
  });
  test("accepts an upper-case hex input", () => {
    expect(qorToHex(hexToQor(HEX.toUpperCase().replace("0X", "0x")))).toBe(HEX);
  });
  test("returns null for a wrong prefix or garbage", () => {
    expect(qorToHex("cosmos1abc")).toBeNull();
    expect(qorToHex("not an address")).toBeNull();
  });
  test("does not need Buffer", () => {
    const saved = globalThis.Buffer;
    // @ts-expect-error simulate a browser
    delete globalThis.Buffer;
    try {
      expect(qorToHex(hexToQor(HEX))).toBe(HEX);
    } finally {
      globalThis.Buffer = saved;
    }
  });
});
```

- [ ] **Step 2: Run it and see the Buffer case fail**

Run: `cd packages/qore && bun test test/address.test.ts`
Expected: FAIL in "does not need Buffer" with `ReferenceError: Buffer is not defined` (the other three pass).

- [ ] **Step 3: Replace Buffer in `address.ts`, `keys.ts` and `relayed.ts`**

`packages/qore/src/address.ts`:
```ts
import { bech32, hex } from "@scure/base";

export const QOR_PREFIX = "qor";

/**
 * Address form used for comparisons: lowercase 0x (20 bytes). The businesses table stores spenders as 0x,
 * so a request's `account` (qor1...) is converted to 0x here, in this one helper. Returns null when invalid.
 */
export function qorToHex(address: string): string | null {
  try {
    const { prefix, words } = bech32.decode(address as `${string}1${string}`);
    if (prefix !== QOR_PREFIX) return null;
    const bytes = bech32.fromWords(words);
    return bytes.length === 20 ? `0x${hex.encode(bytes)}` : null;
  } catch {
    return null;
  }
}

export function hexToQor(value: string): string {
  return bech32.encode(QOR_PREFIX, bech32.toWords(hex.decode(value.slice(2).toLowerCase())));
}
```

In `packages/qore/src/keys.ts`, add `import { hex } from "@scure/base";` and replace line 34's
`Uint8Array.from(Buffer.from(spec.privateKey.slice(2), "hex"))` with `hex.decode(spec.privateKey.slice(2).toLowerCase())`.

In `packages/qore/src/relayed.ts`, add `import { base64, hex } from "@scure/base";` and replace
`` `0x${Buffer.from(data, "base64").toString("hex")}` `` with `` `0x${hex.encode(base64.decode(data))}` ``.

Then confirm nothing else uses Buffer: `grep -rn "Buffer" packages/qore/src` → no output.

- [ ] **Step 4: Run the package tests**

Run: `cd packages/qore && bun test`
Expected: all tests pass, including the existing `abi`, `chain`, `logs` and `relayed` tests.

- [ ] **Step 5: Write the ABI export script**

`packages/qore/scripts/export-abi.ts`:
```ts
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { keccak256 } from "viem";

const root = join(import.meta.dir, "..", "..", "..");
const artifact = (name: string) =>
  JSON.parse(readFileSync(join(root, "sc", "out", `${name}.sol`, `${name}.json`), "utf8")) as {
    abi: unknown[];
    deployedBytecode: { object: `0x${string}` };
  };

const vault = artifact("LoanVault");
const factory = artifact("VaultFactory");
const out = join(import.meta.dir, "..", "src", "generated");
mkdirSync(out, { recursive: true });
writeFileSync(
  join(out, "abis.ts"),
  [
    "// Generated by packages/qore/scripts/export-abi.ts from sc/out. Do not edit; run `bun run export-abi` after `forge build`.",
    `export const LOAN_VAULT_ABI = ${JSON.stringify(vault.abi, null, 2)} as const;`,
    `export const VAULT_FACTORY_ABI = ${JSON.stringify(factory.abi, null, 2)} as const;`,
    "/** keccak256 of VaultFactory's runtime bytecode (it has no immutables, so it equals the deployed code). */",
    `export const FACTORY_RUNTIME_CODEHASH = "${keccak256(factory.deployedBytecode.object)}" as const;`,
    "",
  ].join("\n"),
);
console.log("wrote src/generated/abis.ts");
```

Add to `packages/qore/package.json` scripts: `"export-abi": "bun scripts/export-abi.ts"`, and add `export * from "./generated/abis.ts";` to `packages/qore/src/index.ts`.

- [ ] **Step 6: Generate and check the factory hash against the chain**

Run:
```bash
cd sc && forge build && cd ../packages/qore && bun run export-abi
bun -e 'import {publicClientFor,TESTNET,FACTORY_ADDRESS,FACTORY_RUNTIME_CODEHASH} from "./src/index.ts"; import {keccak256} from "viem"; const c=publicClientFor(TESTNET.evm); const live=keccak256(await c.getCode({address:FACTORY_ADDRESS})); console.log(live===FACTORY_RUNTIME_CODEHASH?"MATCH":`MISMATCH live=${live}`)'
```
Expected: `MATCH`. If it prints `MISMATCH`, stop and report (the build settings differ from the deployment; the Proof page cannot claim a matching build until that is resolved).

- [ ] **Step 7: Write the generated-ABI test**

`packages/qore/test/generated.test.ts`:
```ts
import { expect, test } from "bun:test";
import { FACTORY_RUNTIME_CODEHASH, LOAN_VAULT_ABI, VAULT_FACTORY_ABI } from "../src/index.ts";

const names = (abi: readonly { type: string; name?: string }[], type: string) =>
  abi.filter((x) => x.type === type).map((x) => x.name);

test("vault ABI has the reads the web app needs", () => {
  const fns = names(LOAN_VAULT_ABI, "function");
  for (const f of ["state", "loan", "raised", "repaid", "books", "orders", "orderCount", "lenderClaimable", "deposits", "dailyCap", "spentToday", "suppliers", "paused", "lenderBps", "ownerBps", "orderTtl", "ownerPq", "spender", "operator", "servicePrice", "expectedRepaid"]) {
    expect(fns).toContain(f);
  }
});

test("factory ABI lists vaults", () => {
  expect(names(VAULT_FACTORY_ABI, "function")).toEqual(expect.arrayContaining(["all", "count", "vaultAt", "create"]));
  expect(FACTORY_RUNTIME_CODEHASH).toMatch(/^0x[0-9a-f]{64}$/);
});
```

Run: `cd packages/qore && bun test && bun run typecheck`
Expected: all pass, typecheck exits 0.

- [ ] **Step 8: Check the other workspaces still pass**

Run: `bun run typecheck && bun run test` (repo root)
Expected: every workspace passes.

- [ ] **Step 9: Commit**

```bash
git add packages/qore
git commit -m "refactor(qore): browser-safe hex helpers and full generated ABIs" -m "The web app imports @qredit/qore in the browser, which has no Buffer; @scure/base replaces it. The generated ABIs cover every vault and factory read the web app needs, and the factory code hash lets the Proof page compare the deployed factory with this build. Tests: bun test in packages/qore, root typecheck and test."
```

---

### Task 2: Scaffold `apps/fe` with the design tokens, fonts, themes and motion

**Files:**
- Create: `apps/fe/**` (scaffold), `docs/ui-profile.md`, `apps/fe/CLAUDE.md`, `apps/fe/README.md`
- Modify: root `package.json` (workspaces), root `CLAUDE.md` (layout row already names `apps/fe`; add nothing unless the row is wrong)

**Interfaces:**
- Produces: CSS variables named exactly like the Pencil tokens (`--bg`, `--surface`, `--surface-muted`, `--text-primary`, … see Step 4) mapped to Tailwind colours (`bg-surface`, `text-text-primary`, …); `ThemeProvider` from next-themes with `attribute="class"`, themes `light`/`dark`/`system`; `cn()` in `src/lib/utils.ts`.

- [ ] **Step 1: Create the app**

```bash
cd apps
bunx create-next-app@latest fe --ts --tailwind --eslint --app --src-dir --import-alias "@/*" --use-bun
cd fe
bunx shadcn@latest init
bunx shadcn@latest add button card badge skeleton sonner tabs tooltip dropdown-menu dialog drawer table --yes --overwrite
bun add axios @tanstack/react-query zod next-themes lucide-react viem@2.58.6 @qorechain/sdk@0.14.0 @qorechain/evm@0.14.0 "@qredit/qore@workspace:*"
bun add -d @tanstack/react-query-devtools prettier prettier-plugin-tailwindcss eslint-config-prettier vitest @vitejs/plugin-react jsdom @testing-library/react @testing-library/dom @testing-library/jest-dom @testing-library/user-event
```
Answer shadcn prompts with: style default, base colour neutral, CSS variables yes, component library Base UI. Delete the generated `apps/fe/.git` folder if create-next-app made one (the repo root is the git repo). Record the installed Next.js and React versions for the README.

Add `"apps/fe"` to the root `package.json` workspaces: `["apps/be", "apps/fe", "engine", "packages/*"]`, then run `bun install` at the root.

- [ ] **Step 2: Copy the starter-kit templates**

From `C:\Users\L E N O V O\.claude\skills\frontend-starter-kit\templates`:
`prettier.config.mjs`, `vitest.config.mts`, `vitest.setup.ts` → `apps/fe/`; `env.ts`, `apiClient.ts`, `queryClient.ts`, `format.ts`, `schemas.ts` → `apps/fe/src/lib/`; `Providers.tsx` → `apps/fe/src/app/`; `useMediaQuery.ts` → `apps/fe/src/hooks/`; `PageStates.tsx` → `apps/fe/src/components/shared/`. Mock mode is not used: remove the mock block from `apiClient.ts` and the banner from `Providers.tsx`. Translate any Indonesian copy in the templates to formal English. `env.ts`, `apiClient.ts` and `format.ts` are rewritten in Task 3; keep them compiling for now.

Wire Prettier into `eslint.config.mjs` (`import prettier from "eslint-config-prettier/flat";`, last in the array). Set `package.json` scripts:
```json
{ "dev": "next dev", "build": "next build", "start": "next start", "lint": "eslint .", "format": "prettier --write .",
  "typecheck": "tsc --noEmit", "test": "vitest run", "test:watch": "vitest" }
```

In `next.config.ts` add `transpilePackages: ["@qredit/qore"]`.

- [ ] **Step 3: Write `docs/ui-profile.md`**

```markdown
# UI profile (apps/fe)

| Field | Value |
|---|---|
| UI language and form of address | English, formal, complete sentences, no contractions |
| Brand color / text color on it | Primary ink `#17171A` / `#FAFAF9` (light), `#F4F4F2` / `#17171A` (dark); accent Glacier `#5CB8F5` / on-accent `#0B2A40` |
| Font | Geist; Geist Mono for addresses and hashes only |
| Theme | Light, dark and system |
| Breakpoints | phone < 768px, tablet 768–1279px, desktop ≥ 1280px |
| Number format | `1,234.56` (`en-US`), tabular numerals |
| Currency format | `0.25 fUSD` (6 decimals on chain, at most 2 shown unless smaller) |
| Date and time format | `24 Nov 2026, 18:49`; relative "2 minutes ago" in lists |
| Time zone | UTC |
| Units in use | fUSD, QOR, blocks |
| Glossary | Business (an agent business), Lender, Buyer, Owner, Report, Order, Raise, Repaid, Sealed |
| Component library | shadcn/ui (Base UI) |
| Design source / may it be edited? | design/qredit.pen (Pencil) / no |
| Backend messages safe to show as-is? | no |
```

- [ ] **Step 4: Write `globals.css` with the Pencil tokens**

Replace the colour section of `apps/fe/src/app/globals.css` with these exact values (from `GetVariables()` in `design/qredit.pen`), keep the shadcn base imports above them, and map shadcn's variables onto them:

```css
@custom-variant dark (&:where(.dark, .dark *));

:root {
  --bg: #f2f1ee; --surface: #fdfdfc; --surface-muted: #f7f6f3; --surface-hover: #efeeea;
  --border: #e4e2dd; --border-strong: #cfccc5;
  --text-primary: #17171a; --text-secondary: #55544f; --text-tertiary: #6b6a65;
  --primary: #17171a; --on-primary: #fafaf9; --primary-hover: #2c2c30;
  --accent: #5cb8f5; --on-accent: #0b2a40; --accent-soft: #e3f2fd; --accent-strong: #1a6aae; --accent-hover: #47aaee;
  --success: #1a7340; --success-soft: #e3f3e8; --warning: #945800; --warning-soft: #fbf0dc;
  --danger: #bf3220; --danger-soft: #fbe6e2; --info: #5b47c9; --info-soft: #ece8fb;
  --focus: #1a6aae; --scrim: #17171a66; --shadow: #17171a14;
  --glass: #f2f1eeb3; --glass-strong: #fdfdfcd9; --glass-edge: #ffffff99;
  --wash: #d9e9fb; --wash-soft: #edf4fd;
  --feature-bg: #17171a; --feature-label: #b0afaa; --feature-figure: #f4f4f2; --feature-unit: #8e8d88;
  --toast-bg: #17171a; --toast-fg: #f4f4f2;
  --danger-fill: #bf3220; --on-danger: #ffffff; --danger-hover: #a82b1b;
  --ease-out: cubic-bezier(0.23, 1, 0.32, 1);
  --ease-in-out: cubic-bezier(0.77, 0, 0.175, 1);
  --ease-drawer: cubic-bezier(0.32, 0.72, 0, 1);
}
.dark {
  --bg: #0e0e10; --surface: #18181b; --surface-muted: #1f1f23; --surface-hover: #26262b;
  --border: #2a2a2f; --border-strong: #3a3a40;
  --text-primary: #f4f4f2; --text-secondary: #b0afaa; --text-tertiary: #8e8d88;
  --primary: #f4f4f2; --on-primary: #17171a; --primary-hover: #ffffff;
  --accent: #7cc8fa; --on-accent: #0b2a40; --accent-soft: #132a3a; --accent-strong: #9ad5fb; --accent-hover: #95d3fb;
  --success: #5bc98a; --success-soft: #14281c; --warning: #e5a93b; --warning-soft: #2e2412;
  --danger: #f07060; --danger-soft: #321a17; --info: #a99bf0; --info-soft: #211d36;
  --focus: #7cc8fa; --scrim: #000000a6; --shadow: #00000066;
  --glass: #0e0e10b3; --glass-strong: #18181bd9; --glass-edge: #ffffff14;
  --wash: #5cb8f542; --wash-soft: #5cb8f51f;
  --feature-bg: #f4f4f2; --feature-label: #55544f; --feature-figure: #17171a; --feature-unit: #6b6a65;
  --toast-bg: #f4f4f2; --toast-fg: #17171a;
  --danger-fill: #c2412f; --on-danger: #ffffff; --danger-hover: #d04b38;
}

@theme inline {
  --color-bg: var(--bg); --color-surface: var(--surface); --color-surface-muted: var(--surface-muted);
  --color-surface-hover: var(--surface-hover); --color-border: var(--border); --color-border-strong: var(--border-strong);
  --color-text-primary: var(--text-primary); --color-text-secondary: var(--text-secondary); --color-text-tertiary: var(--text-tertiary);
  --color-primary: var(--primary); --color-on-primary: var(--on-primary); --color-primary-hover: var(--primary-hover);
  --color-accent: var(--accent); --color-on-accent: var(--on-accent); --color-accent-soft: var(--accent-soft);
  --color-accent-strong: var(--accent-strong); --color-accent-hover: var(--accent-hover);
  --color-success: var(--success); --color-success-soft: var(--success-soft); --color-warning: var(--warning);
  --color-warning-soft: var(--warning-soft); --color-danger: var(--danger); --color-danger-soft: var(--danger-soft);
  --color-info: var(--info); --color-info-soft: var(--info-soft); --color-focus: var(--focus);
  --color-feature-bg: var(--feature-bg); --color-feature-label: var(--feature-label);
  --color-feature-figure: var(--feature-figure); --color-feature-unit: var(--feature-unit);
  --color-wash: var(--wash); --color-wash-soft: var(--wash-soft); --color-glass: var(--glass); --color-glass-strong: var(--glass-strong);
  --font-sans: var(--font-geist-sans); --font-mono: var(--font-geist-mono);
  --radius-sm: 8px; --radius-md: 12px; --radius-lg: 16px; --radius-xl: 24px;
  --breakpoint-md: 768px; --breakpoint-xl: 1280px;
  /* shadcn names */
  --color-background: var(--bg); --color-foreground: var(--text-primary); --color-card: var(--surface);
  --color-card-foreground: var(--text-primary); --color-popover: var(--surface); --color-popover-foreground: var(--text-primary);
  --color-primary-foreground: var(--on-primary); --color-secondary: var(--surface-muted); --color-secondary-foreground: var(--text-primary);
  --color-muted: var(--surface-muted); --color-muted-foreground: var(--text-secondary); --color-accent-foreground: var(--on-accent);
  --color-destructive: var(--danger-fill); --color-input: var(--border); --color-ring: var(--focus);
}

@layer base {
  body { background: var(--bg); color: var(--text-primary); font-variant-numeric: tabular-nums; }
  button:not(:disabled), [role="button"]:not([aria-disabled="true"]), a[href], summary, label[for], select:not(:disabled) { cursor: pointer; }
  :disabled, [aria-disabled="true"] { cursor: not-allowed; }
  :focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
}

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { transition-property: opacity, color, background-color, border-color !important; animation: none !important; }
}
```
Remove any shadcn-generated `:root`/`.dark` colour blocks that would override these. In `components/ui/button.tsx` replace `disabled:pointer-events-none` with nothing, add `pointer-coarse:min-h-11 pointer-coarse:min-w-11` and `active:scale-[0.97] transition-transform duration-[120ms] ease-[var(--ease-out)]` to the base class.

- [ ] **Step 5: Fonts, theme provider and layout**

`bun add geist`. `apps/fe/src/app/layout.tsx`:
```tsx
import type { Metadata } from "next";
import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import { Providers } from "./Providers";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Qredit", template: "%s · Qredit" },
  description: "Credit for AI agent businesses, with limits the chain enforces.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body className="min-h-dvh font-sans antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
```
In `Providers.tsx` wrap children in `<ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>` from `next-themes`, then `QueryClientProvider`, then `<Toaster />` from `@/components/ui/sonner`.

- [ ] **Step 6: Smoke test, then write `apps/fe/CLAUDE.md` and `README.md`**

`apps/fe/src/app/layout.test.tsx`:
```tsx
import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { Providers } from "./Providers";

test("providers render children", () => {
  render(<Providers><p>Hello</p></Providers>);
  expect(screen.getByText("Hello")).toBeInTheDocument();
});
```
`apps/fe/CLAUDE.md` states: what the app is; that it follows the frontend-starter-kit structure (`app/` thin, `modules/<m>` with api/components/schemas); the honest-data rule; that the REST API is reached only through `/api/chain/rest`; that no key or mnemonic may ever be imported or stored server-side; the copy rules from Global Constraints; the no-divider rule; and the Motion section (the three easing tokens, press 0.97/120 ms, enter 200 ms, exit 150 ms, important numbers crossfade) with a Moments table:

| Moment | How often | Motion |
|---|---|---|
| Page navigation, tab switch, theme switch | Many times a day | None (instant) |
| Cards and lists appearing after load | Many times a day | Skeleton crossfades to content, 200 ms |
| Proof check finishing | Sometimes | Status badge crossfade, 200 ms |
| Business state changing (Raising → Active) | Rare | Badge crossfade, no spring |

`apps/fe/README.md` has the sections from the starter kit (`references/structure.md` "README sections"): what the app is, stack with the real installed versions, scripts (`bun dev`, `bun run build`, `bun run test`, `bun run typecheck`, `bun run lint`), env setup (`cp .env.example .env.local`), folder map, link to `docs/ui-profile.md`.

- [ ] **Step 7: Run all checks**

Run: `cd apps/fe && bun run typecheck && bun run lint && bun run test && bun run build`
Expected: all exit 0.

- [ ] **Step 8: Commit**

```bash
git add package.json bun.lock apps/fe docs/ui-profile.md
git commit -m "feat(fe): scaffold the web app with the Qredit tokens, Geist and themes" -m "Next.js app in the Bun workspace, shadcn on Base UI, tokens copied from design/qredit.pen for light and dark, next-themes for Light/Dark/System, motion tokens from motion-rules. Tests: typecheck, lint, vitest, next build."
```

---

### Task 3: Environment, API client, chain client, formatting and API schemas

**Files:**
- Create/replace: `apps/fe/src/lib/env.ts`, `apps/fe/src/lib/apiClient.ts`, `apps/fe/src/lib/chain.ts`, `apps/fe/src/lib/format.ts`, `apps/fe/src/lib/schemas.ts`, `apps/fe/.env.example`
- Test: `apps/fe/src/lib/format.test.ts`, `apps/fe/src/lib/schemas.test.ts`

**Interfaces:**
- Produces:
  - `env: { apiUrl: string; evmUrl: string; chainId: string; explorerUrl: string }`
  - `api` (axios instance), `ApiError` with `kind: "network" | "notFound" | "rateLimited" | "server" | "invalid"` and a formal English `message`
  - `publicClient` (viem `PublicClient` for chain 9800), `restUrl(): string` (absolute `${origin}/api/chain/rest`)
  - `formatFusd(units: bigint | string, opts?: { unit?: boolean }): string`, `parseFusd(text: string): bigint | null`, `formatBps(bps: number): string`, `formatDateTime(d: Date | number): string`, `formatRelative(d: Date | number, now?: Date | number): string`, `shortAddress(a: string): string`, `shortHash(h: string): string`
  - zod: `jsonText(schema)` helper, `businessSchema`, `Business`, `serviceSchema`, `orderSchema`, `Order`, `decisionSchema`, `Decision`

- [ ] **Step 1: Write the failing format tests**

`apps/fe/src/lib/format.test.ts`:
```ts
import { describe, expect, test } from "vitest";
import { formatBps, formatDateTime, formatFusd, formatRelative, parseFusd, shortAddress, shortHash } from "./format";

describe("fUSD", () => {
  test("formats 6-decimal units with two decimals", () => {
    expect(formatFusd(250000n)).toBe("0.25 fUSD");
    expect(formatFusd("3000000")).toBe("3.00 fUSD");
    expect(formatFusd(1234567890n, { unit: false })).toBe("1,234.57");
  });
  test("keeps precision below one cent", () => {
    expect(formatFusd(5000n)).toBe("0.005 fUSD");
    expect(formatFusd(1n)).toBe("0.000001 fUSD");
    expect(formatFusd(0n)).toBe("0.00 fUSD");
  });
  test("parses user text into units", () => {
    expect(parseFusd("0.25")).toBe(250000n);
    expect(parseFusd("1,000.5")).toBe(1000500000n);
    expect(parseFusd("0.0000001")).toBeNull();
    expect(parseFusd("abc")).toBeNull();
    expect(parseFusd("")).toBeNull();
  });
});

describe("other formats", () => {
  test("basis points", () => expect(formatBps(7000)).toBe("70%"));
  test("date and time in UTC", () => expect(formatDateTime(Date.UTC(2026, 10, 24, 18, 49))).toBe("24 Nov 2026, 18:49 UTC"));
  test("relative time", () => {
    const now = Date.UTC(2026, 10, 25, 12, 0);
    expect(formatRelative(now - 30_000, now)).toBe("just now");
    expect(formatRelative(now - 2 * 60_000, now)).toBe("2 minutes ago");
    expect(formatRelative(now - 60 * 60_000, now)).toBe("1 hour ago");
    expect(formatRelative(now - 26 * 60 * 60_000, now)).toBe("yesterday");
    expect(formatRelative(now - 3 * 24 * 60 * 60_000, now)).toBe("22 Nov 2026");
  });
  test("short forms", () => {
    expect(shortAddress("0x487f449c21a48eaf9d2eb3804f511dfb7715eea9")).toBe("0x487f…eea9");
    expect(shortAddress("qor1abcdefghijklmnopqrstuvwxyz0123456789ab")).toBe("qor1ab…89ab");
    expect(shortHash("0x2b65030eba743f8980aef7bde0b48dc4056b81a5d080a5b76ee03c34792ed85f")).toBe("0x2b65…d85f");
  });
});
```

Run: `cd apps/fe && bunx vitest run src/lib/format.test.ts`
Expected: FAIL (functions missing).

- [ ] **Step 2: Implement `format.ts`**

```ts
const DECIMALS = 6n;
const SCALE = 10n ** DECIMALS;
const LOCALE = "en-US";
const TIME_ZONE = "UTC";

const groups = (n: bigint) => n.toLocaleString(LOCALE);

/** fUSD units (6 decimals) as text: two decimals, more only when the amount needs them. */
export function formatFusd(units: bigint | string, opts: { unit?: boolean } = {}): string {
  const v = typeof units === "bigint" ? units : BigInt(units);
  const neg = v < 0n;
  const abs = neg ? -v : v;
  const whole = abs / SCALE;
  const frac = abs % SCALE;
  let text: string;
  if (frac !== 0n && frac % 10_000n !== 0n && whole === 0n) {
    text = `0.${frac.toString().padStart(6, "0").replace(/0+$/, "")}`;
  } else {
    const cents = (abs * 100n + SCALE / 2n) / SCALE;
    text = `${groups(cents / 100n)}.${(cents % 100n).toString().padStart(2, "0")}`;
  }
  return `${neg ? "-" : ""}${text}${opts.unit === false ? "" : " fUSD"}`;
}

/** User text to fUSD units; null when it is not a number or has more than 6 decimals. */
export function parseFusd(text: string): bigint | null {
  const t = text.replace(/,/g, "").trim();
  const m = /^(\d+)(?:\.(\d{1,6}))?$/.exec(t);
  if (!m) return null;
  return BigInt(m[1]) * SCALE + BigInt((m[2] ?? "").padEnd(6, "0") || "0");
}

export const formatBps = (bps: number) => `${(bps / 100).toLocaleString(LOCALE, { maximumFractionDigits: 2 })}%`;

const dateFmt = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: TIME_ZONE });
const timeFmt = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: TIME_ZONE });

export const formatDate = (d: Date | number) => dateFmt.format(d);
export const formatDateTime = (d: Date | number) => `${dateFmt.format(d)}, ${timeFmt.format(d)} UTC`;

export function formatRelative(d: Date | number, now: Date | number = Date.now()): string {
  const s = Math.floor((+now - +d) / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} ${m === 1 ? "minute" : "minutes"} ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} ${h === 1 ? "hour" : "hours"} ago`;
  if (h < 48) return "yesterday";
  return formatDate(d);
}

export const shortAddress = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
export const shortHash = (h: string) => `${h.slice(0, 6)}…${h.slice(-4)}`;
```

Run: `bunx vitest run src/lib/format.test.ts` → PASS.

- [ ] **Step 3: Write the failing schema tests (with the live API shapes)**

The live API returns `services` and `suppliers` as JSON **text**, not arrays (checked against `GET https://api.qredit.fun/v1/businesses` and `/v1/decisions`). The schemas accept both.

`apps/fe/src/lib/schemas.test.ts`:
```ts
import { expect, test } from "vitest";
import { businessSchema, decisionSchema, orderSchema } from "./schemas";

test("business with services as JSON text", () => {
  const b = businessSchema.parse({
    slug: "counterparty-check", vault: "0x37bbb37dd96a973a22ca64bc809a8bc4d54b03d4", name: "Counterparty Check",
    tagline: "Is it safe to pay this address?", services: '[{"id":0,"name":"Counterparty risk grade","priceUnits":"250000"}]',
    operator: "0xa995b8848d08320166817a2de1562b2f7be0d7ac", spender: "0x487f449c21a48eaf9d2eb3804f511dfb7715eea9", startBlock: 10673594,
  });
  expect(b.services[0]).toEqual({ id: 0, name: "Counterparty risk grade", priceUnits: 250000n });
});

test("decision with suppliers as JSON text", () => {
  const d = decisionSchema.parse({
    id: 11, vault: "0x37bbb37dd96a973a22ca64bc809a8bc4d54b03d4", orderId: "5", decision: "delivered", reason: "delivered",
    suppliers: '[{"role":"dataIndexer","amount":"50000"}]', cost: "50000", createdAt: "2026-11-24T18:49:10.776Z",
  });
  expect(d.suppliers).toEqual([{ role: "dataIndexer", amount: 50000n }]);
  expect(d.cost).toBe(50000n);
  expect(d.createdAt).toBeInstanceOf(Date);
});

test("order", () => {
  const o = orderSchema.parse({
    vault: "0x37bbb37dd96a973a22ca64bc809a8bc4d54b03d4", orderId: "5", buyer: "0xbf27a5c7c521e3e8660dbcf369ca462939773351",
    serviceId: 0, price: "250000", requestRef: `0x${"7".repeat(64)}`, deadline: 1795549723, status: "delivered",
    placedTx: `0x${"f".repeat(64)}`, placedBlock: 10683171, envelopeHash: null,
  });
  expect(o.price).toBe(250000n);
  expect(o.deadline).toBeInstanceOf(Date);
});

test("rejects an unknown status", () => {
  expect(() => decisionSchema.parse({ id: 1, vault: "0x", orderId: null, decision: "maybe", reason: "", suppliers: [], cost: "0", createdAt: "2026-01-01T00:00:00Z" })).toThrow();
});
```

Run: `bunx vitest run src/lib/schemas.test.ts` → FAIL.

- [ ] **Step 4: Implement `schemas.ts`**

```ts
import { z } from "zod";

/** Accepts a value or the same value encoded as JSON text (the API returns jsonb columns as text). */
export const jsonText = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((v) => {
    if (typeof v !== "string") return v;
    try {
      return JSON.parse(v);
    } catch {
      return v;
    }
  }, schema);

const units = z.union([z.string().regex(/^\d+$/), z.number().int().nonnegative()]).transform((v) => BigInt(v));
const hex = z.string().regex(/^0x[0-9a-fA-F]+$/).transform((v) => v.toLowerCase() as `0x${string}`);

export const serviceSchema = z.object({ id: z.number().int().nonnegative(), name: z.string(), priceUnits: units });
export type Service = z.infer<typeof serviceSchema>;

export const businessSchema = z.object({
  slug: z.string(),
  vault: hex,
  name: z.string(),
  tagline: z.string(),
  services: jsonText(z.array(serviceSchema)),
  operator: hex,
  spender: hex,
  startBlock: z.number().int(),
});
export type Business = z.infer<typeof businessSchema>;

export const orderStatus = z.enum(["open", "claimed", "delivered", "declined", "reclaimed"]);
export const orderSchema = z.object({
  vault: hex,
  orderId: z.string(),
  buyer: hex,
  serviceId: z.number().int(),
  price: units,
  requestRef: hex,
  deadline: z.number().int().transform((s) => new Date(s * 1000)),
  status: orderStatus,
  placedTx: hex,
  placedBlock: z.number().int(),
  envelopeHash: hex.nullable(),
});
export type Order = z.infer<typeof orderSchema>;

export const decisionSchema = z.object({
  id: z.number().int(),
  vault: hex,
  orderId: z.string().nullable(),
  decision: z.enum(["accepted", "declined", "delivered", "failed"]),
  reason: z.string(),
  suppliers: jsonText(z.array(z.object({ role: z.string(), amount: units }))),
  cost: units,
  createdAt: z.string().transform((s) => new Date(s)),
});
export type Decision = z.infer<typeof decisionSchema>;
```

Run: `bunx vitest run src/lib` → PASS.

- [ ] **Step 5: `env.ts`, `apiClient.ts`, `chain.ts`, `.env.example`**

`apps/fe/.env.example`:
```
NEXT_PUBLIC_API_URL=https://api.qredit.fun
NEXT_PUBLIC_QORE_EVM_URL=https://evm-testnet.qore.host
NEXT_PUBLIC_QORE_CHAIN_ID=qorechain-diana
NEXT_PUBLIC_EXPLORER_URL=
QORE_REST_URL=https://api-testnet.qore.host
```
Before writing `NEXT_PUBLIC_EXPLORER_URL`, look up the testnet explorer's transaction URL pattern on docs.qorechain.io and put its base URL here (it is used as `${explorerUrl}/tx/${hash}`; confirm the path on one real transaction). If no explorer with a stable URL exists, leave it empty and `TxLink` (Task 5) shows the hash without a link.

`apps/fe/src/lib/env.ts`:
```ts
const required = (name: string, value: string | undefined) => {
  if (!value) throw new Error(`Missing environment variable ${name}. Copy .env.example to .env.local.`);
  return value.replace(/\/$/, "");
};

export const env = {
  apiUrl: required("NEXT_PUBLIC_API_URL", process.env.NEXT_PUBLIC_API_URL),
  evmUrl: required("NEXT_PUBLIC_QORE_EVM_URL", process.env.NEXT_PUBLIC_QORE_EVM_URL),
  chainId: required("NEXT_PUBLIC_QORE_CHAIN_ID", process.env.NEXT_PUBLIC_QORE_CHAIN_ID),
  explorerUrl: (process.env.NEXT_PUBLIC_EXPLORER_URL ?? "").replace(/\/$/, ""),
} as const;
```

`apps/fe/src/lib/apiClient.ts`:
```ts
import axios, { AxiosError } from "axios";
import { env } from "./env";

export type ApiErrorKind = "network" | "notFound" | "rateLimited" | "server" | "invalid";
const MESSAGES: Record<ApiErrorKind, string> = {
  network: "Qredit could not be reached. Check your connection and try again.",
  notFound: "This item could not be found.",
  rateLimited: "Too many requests were sent. Please wait a moment and try again.",
  server: "Something went wrong on our side. Please try again.",
  invalid: "The request could not be processed.",
};

export class ApiError extends Error {
  constructor(readonly kind: ApiErrorKind, readonly status?: number) {
    super(MESSAGES[kind]);
  }
}

export const api = axios.create({ baseURL: env.apiUrl, timeout: 20_000 });

api.interceptors.response.use(undefined, (e: AxiosError) => {
  const s = e.response?.status;
  if (!s) return Promise.reject(new ApiError("network"));
  if (s === 404) return Promise.reject(new ApiError("notFound", s));
  if (s === 429) return Promise.reject(new ApiError("rateLimited", s));
  if (s >= 500) return Promise.reject(new ApiError("server", s));
  return Promise.reject(new ApiError("invalid", s));
});
```

`apps/fe/src/lib/chain.ts`:
```ts
import { publicClientFor } from "@qredit/qore";
import { env } from "./env";

export const publicClient = publicClientFor(env.evmUrl);

/** The Cosmos REST API has no CORS headers, so browser calls go through this app's proxy (src/app/api/chain/rest). */
export const restUrl = () => `${typeof window === "undefined" ? "" : window.location.origin}/api/chain/rest`;
```

- [ ] **Step 6: Run checks and commit**

Run: `cd apps/fe && bun run typecheck && bun run test && bun run lint`
Expected: all pass.
```bash
git add apps/fe
git commit -m "feat(fe): env, API and chain clients, fUSD formatting and API schemas" -m "Schemas follow the live API, which returns jsonb columns as JSON text. fUSD has 6 decimals. Tests: vitest (format, schemas), typecheck, lint."
```

---

### Task 4: REST proxy and the browser bundle gate

The SDK has never run in a browser bundle (spike S4 ran as a script), and the Cosmos REST API sends no CORS headers. This task adds an allowlisted proxy and proves the SDK reads work from a real page before any page depends on them. **This is a go/no-go gate.**

**Files:**
- Create: `apps/fe/src/app/api/chain/rest/[...path]/route.ts`, `apps/fe/src/app/api/chain/rest/route.test.ts`
- Create (temporary, deleted in Step 6): `apps/fe/src/app/bundle-check/page.tsx`

**Interfaces:**
- Produces: `GET /api/chain/rest/<path>?<query>` → the REST response body and status, for allowlisted path prefixes only; 404 `{error}` for anything else.

- [ ] **Step 1: Write the failing proxy test**

`apps/fe/src/app/api/chain/rest/route.test.ts`:
```ts
import { afterEach, expect, test, vi } from "vitest";
import { GET, isAllowedPath } from "./[...path]/route";

afterEach(() => vi.restoreAllMocks());

test("allowlist", () => {
  expect(isAllowedPath("qorechain/pqc/v1/accounts/qor1abc")).toBe(true);
  expect(isAllowedPath("cosmos/bank/v1beta1/balances/qor1abc")).toBe(true);
  expect(isAllowedPath("cosmos/tx/v1beta1/txs")).toBe(false);
  expect(isAllowedPath("../etc/passwd")).toBe(false);
});

test("forwards an allowed GET", async () => {
  const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response('{"ok":1}', { status: 200, headers: { "content-type": "application/json" } }));
  const res = await GET(new Request("http://x/api/chain/rest/cosmos/bank/v1beta1/balances/qor1abc?denom=uqor"), {
    params: Promise.resolve({ path: ["cosmos", "bank", "v1beta1", "balances", "qor1abc"] }),
  });
  expect(res.status).toBe(200);
  expect(spy.mock.calls[0][0]).toBe("https://api-testnet.qore.host/cosmos/bank/v1beta1/balances/qor1abc?denom=uqor");
});

test("refuses a path outside the allowlist", async () => {
  const res = await GET(new Request("http://x/api/chain/rest/cosmos/tx/v1beta1/txs"), { params: Promise.resolve({ path: ["cosmos", "tx", "v1beta1", "txs"] }) });
  expect(res.status).toBe(404);
});
```

Run: `bunx vitest run src/app/api` → FAIL.

- [ ] **Step 2: Find the exact REST paths the SDK reads**

The allowlist must cover the paths `fetchPqcStatus`, `fetchSpendingRules`, `fetchAuthenticators`, `fetchKemKey` and `evmWindowStatus` request. Read them from the installed packages:
```bash
grep -oE '"/(qorechain|cosmos)/[a-z0-9_/]+' node_modules/@qorechain/sdk/dist/index.js node_modules/@qorechain/evm/dist/*.js node_modules/@qorechain/qoreseal/dist/*.js 2>/dev/null | sort -u
```
(Use the `node_modules` path that exists after `bun install`; the packages are linked under `node_modules/.bun/`.) Put the distinct leading segments (for example `qorechain/pqc/`, `qorechain/abstractaccount/`, `qorechain/evm/`, `cosmos/bank/v1beta1/balances/`, `cosmos/auth/v1beta1/accounts/`) in `ALLOWED_PREFIXES`. If a path you need is not under a clear module prefix, stop and report it.

- [ ] **Step 3: Implement the proxy**

`apps/fe/src/app/api/chain/rest/[...path]/route.ts`:
```ts
const REST = (process.env.QORE_REST_URL ?? "https://api-testnet.qore.host").replace(/\/$/, "");

/** Read-only module paths the web app needs. Filled from the SDK's own request paths (Task 4 Step 2). */
export const ALLOWED_PREFIXES = [
  "qorechain/pqc/",
  "qorechain/abstractaccount/",
  "qorechain/evm/",
  "cosmos/bank/v1beta1/balances/",
  "cosmos/auth/v1beta1/accounts/",
] as const;

export const isAllowedPath = (p: string) => !p.includes("..") && ALLOWED_PREFIXES.some((x) => p.startsWith(x));

export async function GET(req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  const path = (await ctx.params).path.join("/");
  if (!isAllowedPath(path)) return Response.json({ error: "not found" }, { status: 404 });
  const query = new URL(req.url).search;
  const upstream = await fetch(`${REST}/${path}${query}`, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(15_000) });
  return new Response(upstream.body, {
    status: upstream.status,
    headers: { "content-type": upstream.headers.get("content-type") ?? "application/json", "cache-control": "public, max-age=5" },
  });
}
```
Replace the placeholder-looking prefixes above with exactly what Step 2 found (keep the list minimal). Run: `bunx vitest run src/app/api` → PASS.

- [ ] **Step 4: Bundle-check page (temporary)**

`apps/fe/src/app/bundle-check/page.tsx`:
```tsx
"use client";
import { fetchPqcStatus } from "@qorechain/sdk";
import { evmWindowStatus } from "@qorechain/evm";
import { FACTORY_ADDRESS, hexToQor, VAULT_FACTORY_ABI } from "@qredit/qore";
import { useEffect, useState } from "react";
import { publicClient, restUrl } from "@/lib/chain";

export default function BundleCheck() {
  const [lines, setLines] = useState<string[]>([]);
  useEffect(() => {
    const log = (s: string) => setLines((l) => [...l, s]);
    (async () => {
      const vaults = await publicClient.readContract({ address: FACTORY_ADDRESS, abi: VAULT_FACTORY_ABI, functionName: "all" });
      log(`factory vaults: ${vaults.length}`);
      const operator = hexToQor("0xa995b8848d08320166817a2de1562b2f7be0d7ac");
      const pq = await fetchPqcStatus({ rest: restUrl(), address: operator });
      log(`operator pqc registered: ${pq.registered}`);
      const w = await evmWindowStatus({ rest: restUrl(), address: operator });
      log(`operator window found: ${w.found}, targets: ${w.allowedTargets.join(",")}`);
    })().catch((e) => log(`FAILED: ${e instanceof Error ? e.message : String(e)}`));
  }, []);
  return <pre data-testid="out">{lines.join("\n")}</pre>;
}
```

- [ ] **Step 5: Run it in a real browser**

Run `bun run build && bun run start`, open `http://localhost:3000/bundle-check` in Claude in Chrome (or Playwright), and read the page text and console.
Expected: three lines, no `FAILED`, no `Buffer is not defined`, no CORS error in the console. Record the output in the task report.
**If it fails:** stop and report the exact error. The documented fallbacks are (a) a `globalThis.Buffer` polyfill via the `buffer` package in `Providers.tsx` for a Buffer error, (b) adding the missing path prefix for a 404 from the proxy. Any other failure is a blocker for the human.

- [ ] **Step 6: Delete the bundle-check page and commit**

```bash
rm -r apps/fe/src/app/bundle-check
git add apps/fe
git commit -m "feat(fe): allowlisted proxy for the QoreChain REST API" -m "The REST API sends no CORS headers, so browser reads go through /api/chain/rest with a read-only path allowlist. A temporary page proved in Chrome that the SDK and @qredit/qore run in the browser bundle (factory read, PQC status and window status). Tests: vitest (proxy), build, manual browser check."
```

---

### Task 5: App shell, shared display components and the 404 page

**Design frames** (read with the Pencil MCP): Components `OdxqX` (TopBar `m9fRB`, MobileHeader `YBhsY`, TabBar `mBKgH`, Button/Icon/Theme `SVi3D`, Logo/Wordmark `D7fVY`, Logo/Wordmark/Inline `DVdGm`, Badge/* `hkL41 kO07H Z5HhyI brCMZ jPsry f8cIrX`, Address `stKt8`, Amount `j4ISk`, LoanBar/Raising `BqHSy`, LoanBar/Repaying `qvEdA`, Link/Transaction `orQWO`, BusinessMark `TMqKS`, KpiTile `adjMt`, KpiTile/Feature `h6EhCS`, KpiTile/Soft `Y4j8aL`, State/* `DKqz7 DIV9Y RrnEH x0htm Nxr0T`); 404 bands "Page not found" `b0HWn` and "Page not found · Dark" `ilsRv`.

**Files:**
- Create: `apps/fe/src/config/nav.ts`, `apps/fe/src/config/businesses.ts`
- Create: `apps/fe/src/components/layout/{AppShell,TopBar,MobileHeader,TabBar,ThemeButton,Logo}.tsx`
- Create: `apps/fe/src/components/shared/{Address,Amount,StateBadge,LoanBar,BusinessMark,KpiTile,InlineWordmark,TxLink}.tsx`, update `PageStates.tsx`
- Create: `apps/fe/src/app/not-found.tsx`; copy images to `apps/fe/public/agents/` and `apps/fe/public/empty/`
- Test: `apps/fe/src/components/shared/StateBadge.test.tsx`, `LoanBar.test.tsx`, `Address.test.tsx`, `apps/fe/src/components/layout/TopBar.test.tsx`

**Interfaces:**
- Produces:
  - `NAV: { href: string; label: "Market" | "Lend" | "Inbox" | "Proof"; icon: LucideIcon }[]`
  - `AGENT_ART: Record<string, "counterparty" | "sanctions" | "diligence" | "auditor">` keyed by business slug
  - `VaultStateName = "Raising" | "Active" | "Trapped" | "Repaid" | "Refunded"`, `vaultStateName(n: number): VaultStateName`
  - `<StateBadge state={VaultStateName} />`, `<LoanBar raised repaid target totalOwed state />` (bigints), `<Address value kind?="evm"|"qor" />`, `<Amount units unit? />`, `<BusinessMark slug size />`, `<KpiTile label value unit variant?="default"|"feature"|"soft" />`, `<InlineWordmark />`, `<TxLink hash />`
  - `<AppShell>` used by every page; `<PageStates>` exports `ErrorState({ onRetry, title?, message? })`, `EmptyState({ art, title, message, action? })`, `ListSkeleton({ rows })`
  - `not-found.tsx` renders the 404 design with no active nav tab.

- [ ] **Step 1: Copy the art**

```bash
mkdir -p apps/fe/public/agents apps/fe/public/empty
cp design/agents/*-light.png design/agents/*-dark.png apps/fe/public/agents/
cp design/empty/*.png apps/fe/public/empty/
```

- [ ] **Step 2: Config**

`apps/fe/src/config/nav.ts`:
```ts
import { Inbox, LayoutGrid, ShieldCheck, Wallet, type LucideIcon } from "lucide-react";

export const NAV: { href: string; label: "Market" | "Lend" | "Inbox" | "Proof"; icon: LucideIcon }[] = [
  { href: "/", label: "Market", icon: LayoutGrid },
  { href: "/lend", label: "Lend", icon: Wallet },
  { href: "/inbox", label: "Inbox", icon: Inbox },
  { href: "/proof", label: "Proof", icon: ShieldCheck },
];

export const isActive = (href: string, pathname: string) => (href === "/" ? pathname === "/" || pathname.startsWith("/agents") : pathname.startsWith(href));
```
Use the icons the design's TabBar `mBKgH` shows; if they differ from the four above, use the design's (lucide names are listed in each icon node's `iconFontName`).

`apps/fe/src/config/businesses.ts`:
```ts
export const AGENT_ART = {
  "counterparty-check": "counterparty",
  "sanctions-screen": "sanctions",
  "due-diligence": "diligence",
  "contract-auditor": "auditor",
} as const satisfies Record<string, "counterparty" | "sanctions" | "diligence" | "auditor">;
```

- [ ] **Step 3: Write failing tests for StateBadge, LoanBar and Address**

`apps/fe/src/components/shared/StateBadge.test.tsx`:
```tsx
import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { StateBadge, vaultStateName } from "./StateBadge";

test("maps chain numbers to names", () => {
  expect([0, 1, 2, 3, 4].map(vaultStateName)).toEqual(["Raising", "Active", "Trapped", "Repaid", "Refunded"]);
});

test.each([
  ["Raising", "Raising"],
  ["Active", "Repaying"],
  ["Trapped", "Behind schedule"],
  ["Repaid", "Repaid"],
  ["Refunded", "Refunded"],
] as const)("%s reads as %s", (state, label) => {
  render(<StateBadge state={state} />);
  expect(screen.getByText(label)).toBeInTheDocument();
});
```
Before finalising the labels, read the badge texts used on the BusinessCard instances in the Market frame `e8pd7o` (`Get` with `resolveInstances:true`, look at `WMVGd` text) and use the design's exact words; update the test if they differ.

`apps/fe/src/components/shared/LoanBar.test.tsx`:
```tsx
import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { LoanBar } from "./LoanBar";

test("raising shows raised of target", () => {
  render(<LoanBar state="Raising" raised={20_000_000n} target={50_000_000n} repaid={0n} totalOwed={55_000_000n} />);
  expect(screen.getByText("20.00 fUSD")).toBeInTheDocument();
  expect(screen.getByText(/of 50.00 fUSD raised/)).toBeInTheDocument();
  expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "40");
});

test("repaying shows repaid of total owed", () => {
  render(<LoanBar state="Active" raised={50_000_000n} target={50_000_000n} repaid={11_000_000n} totalOwed={55_000_000n} />);
  expect(screen.getByText("11.00 fUSD")).toBeInTheDocument();
  expect(screen.getByText(/of 55.00 fUSD repaid/)).toBeInTheDocument();
  expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "20");
});
```

`apps/fe/src/components/shared/Address.test.tsx`:
```tsx
import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { Address } from "./Address";

test("shows the short form and keeps the full value for copy and title", () => {
  render(<Address value="0x487f449c21a48eaf9d2eb3804f511dfb7715eea9" />);
  const el = screen.getByText("0x487f…eea9");
  expect(el).toHaveAttribute("title", "0x487f449c21a48eaf9d2eb3804f511dfb7715eea9");
  expect(el.className).toContain("font-mono");
});

test("can show the qor1 form of an EVM address", () => {
  render(<Address value="0x487f449c21a48eaf9d2eb3804f511dfb7715eea9" kind="qor" />);
  expect(screen.getByText(/^qor1/)).toBeInTheDocument();
});
```
Run: `bunx vitest run src/components` → FAIL.

- [ ] **Step 4: Implement the shared components**

`apps/fe/src/components/shared/StateBadge.tsx`:
```tsx
import { cn } from "@/lib/utils";

export type VaultStateName = "Raising" | "Active" | "Trapped" | "Repaid" | "Refunded";
const NAMES: VaultStateName[] = ["Raising", "Active", "Trapped", "Repaid", "Refunded"];
export const vaultStateName = (n: number): VaultStateName => NAMES[n] ?? "Raising";

const LOOK: Record<VaultStateName, { label: string; className: string }> = {
  Raising: { label: "Raising", className: "bg-accent-soft text-accent-strong" },
  Active: { label: "Repaying", className: "bg-surface-muted text-text-secondary" },
  Trapped: { label: "Behind schedule", className: "bg-warning-soft text-warning" },
  Repaid: { label: "Repaid", className: "bg-success-soft text-success" },
  Refunded: { label: "Refunded", className: "bg-surface-muted text-text-secondary" },
};

export function StateBadge({ state, className }: { state: VaultStateName; className?: string }) {
  const l = LOOK[state];
  return (
    <span className={cn("inline-flex h-7 items-center rounded-full px-3 text-sm transition-opacity duration-200", l.className, className)}>
      {l.label}
    </span>
  );
}
```
Match the colour pairs to the design's Badge components (`Badge/Proven` for Raising, `Badge/Neutral` for Repaying, `Badge/Warning`, `Badge/Success`); the icon each badge shows in the design (lucide) goes before the label.

`apps/fe/src/components/shared/LoanBar.tsx`:
```tsx
import { formatFusd } from "@/lib/format";
import type { VaultStateName } from "./StateBadge";

type Props = { state: VaultStateName; raised: bigint; target: bigint; repaid: bigint; totalOwed: bigint };

const pct = (part: bigint, whole: bigint) => (whole === 0n ? 0 : Number((part * 100n) / whole));

export function LoanBar({ state, raised, target, repaid, totalOwed }: Props) {
  const raising = state === "Raising" || state === "Refunded";
  const value = raising ? raised : repaid;
  const whole = raising ? target : totalOwed;
  const p = Math.min(100, pct(value, whole));
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline gap-2">
        <span className="text-lg text-text-primary">{formatFusd(value)}</span>
        <span className="text-sm text-text-secondary">of {formatFusd(whole)} {raising ? "raised" : "repaid"}</span>
      </div>
      <div role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={p} className="h-2 overflow-hidden rounded-full bg-surface-muted">
        <div className={raising ? "h-full rounded-full bg-accent" : "h-full rounded-full bg-primary"} style={{ width: `${p}%` }} />
      </div>
    </div>
  );
}
```

`apps/fe/src/components/shared/Address.tsx`:
```tsx
import { hexToQor } from "@qredit/qore";
import { shortAddress } from "@/lib/format";
import { cn } from "@/lib/utils";

export function Address({ value, kind = "evm", className }: { value: string; kind?: "evm" | "qor"; className?: string }) {
  const full = kind === "qor" && value.startsWith("0x") ? hexToQor(value) : value;
  return (
    <span title={full} className={cn("font-mono text-sm text-text-secondary", className)}>
      {shortAddress(full)}
    </span>
  );
}
```

`Amount.tsx`: renders `formatFusd(units, { unit: false })` in a `tabular-nums` span plus a smaller `fUSD` unit span (design `Amount` `j4ISk`: figure then unit in `text-secondary`). `KpiTile.tsx`: label, figure (size from design: 56 on desktop feature, 24 on phone soft), unit; variants `default` (surface), `feature` (`bg-feature-bg` with `text-feature-label/figure/unit` and the SoftArt image from the design's KpiTile/Feature), `soft` (wash gradient). `BusinessMark.tsx`: `<Image src={`/agents/${AGENT_ART[slug]}-light.png`} className="dark:hidden" />` plus the `-dark.png` with `hidden dark:block`, inside a rounded square of the design size, `alt=""` (decorative; the name is next to it). `InlineWordmark.tsx`: the Corner Q mark as an inline SVG path (export `Logo/Wordmark/Inline` `DVdGm` with `Export([...], "svg", ...)` and inline the path) followed by "redit". `TxLink.tsx`: `shortHash(hash)` in mono; when `env.explorerUrl` is set, an `<a target="_blank" rel="noreferrer">` to `${env.explorerUrl}/tx/${hash}` with an external-link icon, else plain text.

Update `PageStates.tsx`: `EmptyState` takes `art: "error" | "waiting" | "search" | "lending" | "wallet" | "reports" | "owner" | "notfound"` and shows `/empty/${art}-light.png` and `-dark.png` (light/dark switch like BusinessMark) at 128 px, title and message, optional action; `ErrorState` uses the `error` art with title "This page could not be loaded." and a "Try again" button calling `onRetry`; `ListSkeleton` renders `rows` skeleton rows that match the row height of the list it replaces.

Run: `bunx vitest run src/components` → PASS.

- [ ] **Step 5: Layout components**

Build `TopBar` (desktop/tablet: Logo left, NAV centre as pills with the active one filled per `Nav/Active` `X35ri`, ThemeButton right), `MobileHeader` (phone: Logo left, ThemeButton right; on detail pages a back button and title instead of the logo, per the Business Phone frame `UNBEI`), `TabBar` (phone, fixed bottom, four tabs, safe-area padding, only on top-level routes `/`, `/lend`, `/inbox`, `/proof`), `ThemeButton` (icon button 44 px on touch: Moon in light, Sun in dark; click toggles between light and dark via `useTheme().setTheme`; render nothing until mounted to avoid a hydration mismatch), `AppShell` (`<TopBar className="hidden md:flex" />`, `<MobileHeader className="md:hidden" />`, `<main className="mx-auto w-full max-w-[1200px] px-4 md:px-8 xl:px-0">`, TabBar on phone). The navbar is sticky with the glass background (`bg-glass backdrop-blur`) after the page scrolls, per the design's TopBar.

`apps/fe/src/components/layout/TopBar.test.tsx`:
```tsx
import { render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { TopBar } from "./TopBar";

vi.mock("next/navigation", () => ({ usePathname: () => "/agents/counterparty-check" }));
vi.mock("next-themes", () => ({ useTheme: () => ({ resolvedTheme: "light", setTheme: vi.fn() }) }));

test("marks Market active on a business page and links all four sections", () => {
  render(<TopBar />);
  expect(screen.getByRole("link", { name: "Market" })).toHaveAttribute("aria-current", "page");
  for (const label of ["Lend", "Inbox", "Proof"]) expect(screen.getByRole("link", { name: label })).not.toHaveAttribute("aria-current");
});
```

- [ ] **Step 6: The 404 page**

`apps/fe/src/app/not-found.tsx` renders `AppShell` with no active tab (pathname matching nothing) and `EmptyState art="notfound" title="This page does not exist." message="The link may be wrong, or the page may have moved." action={<Button render={<Link href="/" />}>Go to the market</Button>}` — use the exact copy from the "Page not found" band `b0HWn`.

- [ ] **Step 7: Checks and commit**

Run: `cd apps/fe && bun run typecheck && bun run lint && bun run test && bun run build`
Expected: all pass.
```bash
git add apps/fe
git commit -m "feat(fe): app shell, shared display components and the 404 page" -m "Top navbar, phone header and tab bar, theme button, badges, loan bar, addresses, amounts, KPI tiles, agent marks and empty states from the design. Tests: vitest (badge, loan bar, address, top bar), typecheck, lint, build."
```

---

### Task 6: Market page

**Design frames:** Market Normal `WtlQU` (Desktop `e8pd7o`, Tablet `k0hGVb`, Phone `EfKYK`), Loading `nD2Nw`, Error `D9yJYo`; BusinessCard `KZxOP`.

**Files:**
- Create: `apps/fe/src/modules/market/api/market.api.ts`, `market.keys.ts`, `useMarketQuery.ts`
- Create: `apps/fe/src/modules/market/schemas/vault.schema.ts`
- Create: `apps/fe/src/modules/market/components/{MarketPage,MarketKpis,BusinessCard,BusinessGrid}.tsx`, `index.ts`
- Modify: `apps/fe/src/app/page.tsx`
- Test: `apps/fe/src/modules/market/api/market.api.test.ts`, `apps/fe/src/modules/market/components/MarketPage.test.tsx`

**Interfaces:**
- Consumes: `api`, `publicClient`, `businessSchema`, `orderSchema`, `LOAN_VAULT_ABI`, `vaultStateName`, `StateBadge`, `LoanBar`, `BusinessMark`, `KpiTile`, `PageStates`.
- Produces:
  - `type VaultSnapshot = { state: VaultStateName; raised: bigint; repaid: bigint; target: bigint; totalOwed: bigint; installment: bigint; period: bigint; raiseDeadline: Date; paused: boolean }`
  - `getBusinesses(): Promise<Business[]>`, `getBusiness(slug): Promise<Business>` (throws `ApiError("notFound")`)
  - `readVaultSnapshot(vault: \`0x${string}\`): Promise<VaultSnapshot>`
  - `getOrders(vault): Promise<Order[]>`
  - `type MarketEntry = { business: Business; vault: VaultSnapshot; lastOrderAt: Date | null; ordersDelivered: number }`
  - `getMarket(): Promise<MarketEntry[]>`
  - `marketKeys = { all: ["market"], business: (slug) => ["market", "business", slug], vault: (v) => ["market", "vault", v], orders: (v) => ["market", "orders", v] }`
  - `useMarketQuery()`, `useBusinessQuery(slug)`, `useVaultQuery(vault)`, `useOrdersQuery(vault)`; `index.ts` exports these hooks, `BusinessCard`, `MarketPage`, and the types.

- [ ] **Step 1: Write the failing api test**

`apps/fe/src/modules/market/api/market.api.test.ts`:
```ts
import { beforeEach, expect, test, vi } from "vitest";

const readContract = vi.fn();
vi.mock("@/lib/chain", () => ({ publicClient: { multicall: undefined, readContract: (...a: unknown[]) => readContract(...a) } }));
const get = vi.fn();
vi.mock("@/lib/apiClient", () => ({ api: { get: (...a: unknown[]) => get(...a) } }));

import { readVaultSnapshot, toMarketEntry } from "./market.api";

beforeEach(() => vi.clearAllMocks());

test("reads and names the vault state", async () => {
  readContract.mockImplementation(({ functionName }: { functionName: string }) => {
    const values: Record<string, unknown> = {
      state: 1, raised: 50_000_000n, repaid: 11_000_000n, paused: false,
      loan: [50_000_000n, 55_000_000n, 1795500000n, 3600n, 600n, 5_000_000n],
    };
    return Promise.resolve(values[functionName]);
  });
  const s = await readVaultSnapshot("0x37bbb37dd96a973a22ca64bc809a8bc4d54b03d4");
  expect(s.state).toBe("Active");
  expect(s.target).toBe(50_000_000n);
  expect(s.totalOwed).toBe(55_000_000n);
  expect(s.raiseDeadline).toEqual(new Date(1795500000 * 1000));
});

test("summarises orders for a card", () => {
  const e = toMarketEntry(
    { slug: "a", vault: "0x1", name: "A", tagline: "", services: [], operator: "0x2", spender: "0x3", startBlock: 1 } as never,
    { state: "Active" } as never,
    [
      { status: "delivered", placedBlock: 10, deadline: new Date(2000) },
      { status: "open", placedBlock: 12, deadline: new Date(3000) },
    ] as never,
  );
  expect(e.ordersDelivered).toBe(1);
});
```

Run: `bunx vitest run src/modules/market` → FAIL.

- [ ] **Step 2: Implement the api**

`apps/fe/src/modules/market/api/market.api.ts`:
```ts
import { LOAN_VAULT_ABI } from "@qredit/qore";
import { z } from "zod";
import { vaultStateName } from "@/components/shared/StateBadge";
import { api } from "@/lib/apiClient";
import { publicClient } from "@/lib/chain";
import { businessSchema, orderSchema, type Business, type Order } from "@/lib/schemas";
import type { VaultSnapshot } from "../schemas/vault.schema";

type Hex = `0x${string}`;

export async function getBusinesses(): Promise<Business[]> {
  const { data } = await api.get("/v1/businesses");
  return z.array(businessSchema).parse(data);
}

export async function getBusiness(slug: string): Promise<Business> {
  const { data } = await api.get(`/v1/businesses/${encodeURIComponent(slug)}`);
  return businessSchema.parse(data);
}

export async function getOrders(vault: Hex): Promise<Order[]> {
  const { data } = await api.get("/v1/orders", { params: { vault } });
  return z.array(orderSchema).parse(data);
}

const read = <T>(address: Hex, functionName: string) =>
  publicClient.readContract({ address, abi: LOAN_VAULT_ABI, functionName } as never) as Promise<T>;

export async function readVaultSnapshot(vault: Hex): Promise<VaultSnapshot> {
  const [state, raised, repaid, paused, loan] = await Promise.all([
    read<number>(vault, "state"),
    read<bigint>(vault, "raised"),
    read<bigint>(vault, "repaid"),
    read<boolean>(vault, "paused"),
    read<readonly [bigint, bigint, bigint, bigint, bigint, bigint]>(vault, "loan"),
  ]);
  const [target, totalOwed, raiseDeadline, period, , installment] = loan;
  return {
    state: vaultStateName(Number(state)), raised, repaid, paused, target, totalOwed, installment, period,
    raiseDeadline: new Date(Number(raiseDeadline) * 1000),
  };
}

export type MarketEntry = { business: Business; vault: VaultSnapshot; lastOrderAt: Date | null; ordersDelivered: number };

export function toMarketEntry(business: Business, vault: VaultSnapshot, orders: Order[]): MarketEntry {
  return {
    business,
    vault,
    ordersDelivered: orders.filter((o) => o.status === "delivered").length,
    lastOrderAt: null,
  };
}

export async function getMarket(): Promise<MarketEntry[]> {
  const businesses = await getBusinesses();
  return Promise.all(
    businesses.map(async (b) => {
      const [vault, orders] = await Promise.all([readVaultSnapshot(b.vault), getOrders(b.vault)]);
      return toMarketEntry(b, vault, orders);
    }),
  );
}
```
The order rows carry a block number, not a time; the Market card does not show "last order" unless the design does. Check the BusinessCard `KZxOP` texts: if the design shows a last-order time, read the block's timestamp with `publicClient.getBlock({ blockNumber })` for the newest order only and set `lastOrderAt`; otherwise delete the `lastOrderAt` field and its test reference. Verify the order of fields in `loan()` against `LOAN_VAULT_ABI` (`target, totalOwed, raiseDeadline, period, grace, installment`) before relying on the destructuring.

`schemas/vault.schema.ts` exports the `VaultSnapshot` type from the Interfaces block. `market.keys.ts` and `useMarketQuery.ts` follow the starter-kit example module: `useMarketQuery = () => useQuery({ queryKey: marketKeys.all, queryFn: getMarket, refetchInterval: 15_000 })`; `useBusinessQuery(slug)`, `useVaultQuery(vault)` (refetch 15 s), `useOrdersQuery(vault)` (refetch 15 s).

Run: `bunx vitest run src/modules/market` → PASS.

- [ ] **Step 3: Components and page, with a state test**

Build from the design frames:
- `BusinessCard` (`KZxOP`): BusinessMark left; name and tagline to its right (both fill the width and wrap); StateBadge top right; LoanBar under; price of service 0 ("From 0.25 fUSD"). The whole card is a `Link` to `/agents/${slug}`; hover lifts the surface colour (`hover:bg-surface-hover` under `@media (hover:hover)`), press scale 0.98.
- `MarketKpis`: the KPI row the Market frame shows (read the labels from `e8pd7o`; values computed from the entries: total raised, total repaid, businesses repaying, reports delivered).
- `BusinessGrid`: 2 columns on desktop and tablet, 1 on phone, equal card heights (`grid auto-rows-fr`).
- `MarketPage`: page title and description from the frame, then KPIs, then the grid; loading → `ListSkeleton`/card skeletons shaped like the Loading frame `nD2Nw`; error → `ErrorState onRetry={refetch}` per `D9yJYo`; empty list → `EmptyState art="search" title="No businesses are listed yet."`.
- `app/page.tsx`: `export default function Page() { return <AppShell><MarketPage /></AppShell>; }`

`apps/fe/src/modules/market/components/MarketPage.test.tsx`:
```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";

const getMarket = vi.fn();
vi.mock("../api/market.api", () => ({ getMarket: () => getMarket() }));
import { MarketPage } from "./MarketPage";

const wrap = (ui: React.ReactNode) =>
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>);

test("shows an error state with retry when the load fails", async () => {
  getMarket.mockRejectedValue(new Error("down"));
  wrap(<MarketPage />);
  expect(await screen.findByRole("button", { name: "Try again" })).toBeInTheDocument();
});

test("shows the empty state for no businesses", async () => {
  getMarket.mockResolvedValue([]);
  wrap(<MarketPage />);
  expect(await screen.findByText("No businesses are listed yet.")).toBeInTheDocument();
});

test("shows a card per business", async () => {
  getMarket.mockResolvedValue([
    {
      business: { slug: "counterparty-check", vault: "0x1", name: "Counterparty Check", tagline: "Is it safe to pay this address?", services: [{ id: 0, name: "Grade", priceUnits: 250000n }], operator: "0x2", spender: "0x3", startBlock: 1 },
      vault: { state: "Active", raised: 50_000_000n, repaid: 11_000_000n, target: 50_000_000n, totalOwed: 55_000_000n, installment: 1n, period: 1n, raiseDeadline: new Date(0), paused: false },
      lastOrderAt: null, ordersDelivered: 2,
    },
  ]);
  wrap(<MarketPage />);
  expect(await screen.findByRole("link", { name: /Counterparty Check/ })).toHaveAttribute("href", "/agents/counterparty-check");
});
```

Run: `bunx vitest run src/modules/market` → PASS.

- [ ] **Step 4: Check in the browser against the design**

Run `bun dev`, open `http://localhost:3000/` in Claude in Chrome at 1440, 834 and 390 wide, in light and dark. Compare with `TakeScreenshot(["e8pd7o"])`, `(["k0hGVb"])`, `(["EfKYK"])`. Expected: four live businesses with their real states (Counterparty Check repaying, Sanctions Screen repaid, Due Diligence behind schedule, Contract Auditor raising, unless the chain says otherwise), no horizontal scroll, no hydration warning in the console. Throttle the network to Offline in DevTools once to see the error state.

- [ ] **Step 5: Commit**

```bash
git add apps/fe
git commit -m "feat(fe): market page with live loan states" -m "Businesses come from the API; loan state, raised and repaid are read from each vault. Loading, error and empty states follow the design. Tests: vitest (market api, market page states), typecheck, lint, build; checked in Chrome at 390/834/1440 in light and dark."
```

---

### Task 7: Business page

**Design frames:** Business Normal `W45icI` (Desktop `dhbE4`, Tablet `UXoyM`, Phone `UNBEI`), Raising `ZNp17`, Loading `e5itrK`, Not found `vChvM`; components Row/Decision `snx4D`, Table/Orders/* `UvVLE HVC67`, StatCard `vvvqX`.

**Files:**
- Create: `apps/fe/src/modules/business/api/{business.api.ts,business.keys.ts,useBusinessPage.ts}`
- Create: `apps/fe/src/modules/business/components/{BusinessPage,BusinessHeader,LoanTerms,VaultRules,ActivityTable,DecisionLog,ProvenCard}.tsx`, `index.ts`
- Create: `apps/fe/src/app/agents/[slug]/page.tsx`
- Test: `apps/fe/src/modules/business/api/business.api.test.ts`, `apps/fe/src/modules/business/components/BusinessPage.test.tsx`

**Interfaces:**
- Consumes: market hooks (`useBusinessQuery`, `useVaultQuery`, `useOrdersQuery` from `@/modules/market`), `VAULT_FACTORY_ABI`, `LOAN_VAULT_ABI`, `decisionSchema`, `ProvenCard` uses `useProofQuery(business)` from `@/modules/proof` (Task 8; until Task 8 lands, render `ProvenCard` only after Task 8 — build this task's page without it and add it in Task 8 Step 5).
- Produces:
  - `type VaultRules = { suppliers: { address: \`0x${string}\`; allowed: boolean; perTxCap: bigint }[]; dailyCap: bigint; spentToday: bigint; lenderBps: number; ownerBps: number; orderTtlSeconds: number }`
  - `readVaultRules(business: Business): Promise<VaultRules>` — supplier addresses come from the vault's creation call: the factory's `VaultCreated` log in block `business.startBlock`, its transaction decoded with `VAULT_FACTORY_ABI` (`create(Init)`), then each supplier's current `suppliers(address)` read from the vault (a policy order may have removed or lowered one).
  - `getDecisions(vault, limit = 50): Promise<Decision[]>`
  - `useRulesQuery(business)`, `useDecisionsQuery(vault)`

- [ ] **Step 1: Write the failing rules test**

`apps/fe/src/modules/business/api/business.api.test.ts`:
```ts
import { encodeFunctionData } from "viem";
import { beforeEach, expect, test, vi } from "vitest";
import { VAULT_FACTORY_ABI } from "@qredit/qore";

const chain = { getLogs: vi.fn(), getTransaction: vi.fn(), readContract: vi.fn() };
vi.mock("@/lib/chain", () => ({ publicClient: chain }));
vi.mock("@/lib/apiClient", () => ({ api: { get: vi.fn() } }));
import { readVaultRules } from "./business.api";

const S1 = "0x1111111111111111111111111111111111111111";
const S2 = "0x2222222222222222222222222222222222222222";
const VAULT = "0x37bbb37dd96a973a22ca64bc809a8bc4d54b03d4";

beforeEach(() => vi.clearAllMocks());

test("suppliers come from the creation call, caps from the vault now", async () => {
  const init = {
    token: S1, spender: S1, operator: S1, ownerPq: S1, ownerPayout: S1, cosmosChainId: "qorechain-diana", lenderBps: 7000, ownerBps: 2000,
    dailyCap: 2_000_000n, orderTtl: 3600n,
    loan: { target: 1n, totalOwed: 1n, raiseDeadline: 1n, period: 1n, grace: 1n, installment: 1n },
    suppliers: [S1, S2], supplierCaps: [100_000n, 200_000n], servicePrices: [250_000n],
  } as const;
  chain.getLogs.mockResolvedValue([{ args: { vault: VAULT }, transactionHash: "0xabc" }]);
  chain.getTransaction.mockResolvedValue({ input: encodeFunctionData({ abi: VAULT_FACTORY_ABI, functionName: "create", args: [init] }) });
  chain.readContract.mockImplementation(({ functionName, args }: { functionName: string; args?: unknown[] }) => {
    if (functionName === "suppliers") return Promise.resolve(args?.[0] === S1 ? [true, 100_000n] : [false, 0n]);
    const v: Record<string, unknown> = { dailyCap: 2_000_000n, spentToday: 50_000n, lenderBps: 7000, ownerBps: 2000, orderTtl: 3600n };
    return Promise.resolve(v[functionName]);
  });
  const r = await readVaultRules({ vault: VAULT, startBlock: 100 } as never);
  expect(chain.getLogs.mock.calls[0][0]).toMatchObject({ fromBlock: 100n, toBlock: 100n });
  expect(r.suppliers).toEqual([
    { address: S1, allowed: true, perTxCap: 100_000n },
    { address: S2, allowed: false, perTxCap: 0n },
  ]);
  expect(r).toMatchObject({ dailyCap: 2_000_000n, spentToday: 50_000n, lenderBps: 7000, ownerBps: 2000, orderTtlSeconds: 3600 });
});
```
Check the exact field names of the `Init` struct in `VAULT_FACTORY_ABI` (they come from `sc/src/VaultFactory.sol`) and align the test's `init` object with them.

Run: `bunx vitest run src/modules/business` → FAIL.

- [ ] **Step 2: Implement `business.api.ts`**

```ts
import { FACTORY_ADDRESS, LOAN_VAULT_ABI, VAULT_FACTORY_ABI } from "@qredit/qore";
import { decodeFunctionData, getAbiItem } from "viem";
import { z } from "zod";
import { api } from "@/lib/apiClient";
import { publicClient } from "@/lib/chain";
import { decisionSchema, type Business, type Decision } from "@/lib/schemas";

type Hex = `0x${string}`;
export type VaultRules = {
  suppliers: { address: Hex; allowed: boolean; perTxCap: bigint }[];
  dailyCap: bigint; spentToday: bigint; lenderBps: number; ownerBps: number; orderTtlSeconds: number;
};

const VAULT_CREATED = getAbiItem({ abi: VAULT_FACTORY_ABI, name: "VaultCreated" });

async function creationSuppliers(b: Pick<Business, "vault" | "startBlock">): Promise<Hex[]> {
  const block = BigInt(b.startBlock);
  const logs = await publicClient.getLogs({ address: FACTORY_ADDRESS, event: VAULT_CREATED, args: { vault: b.vault }, fromBlock: block, toBlock: block });
  const log = logs[0];
  if (!log) throw new Error("The vault creation could not be found on chain.");
  const tx = await publicClient.getTransaction({ hash: log.transactionHash! });
  const call = decodeFunctionData({ abi: VAULT_FACTORY_ABI, data: tx.input });
  const init = (call.args as readonly [{ suppliers: readonly Hex[] }])[0];
  return init.suppliers.map((s) => s.toLowerCase() as Hex);
}

const read = <T>(address: Hex, functionName: string, args?: unknown[]) =>
  publicClient.readContract({ address, abi: LOAN_VAULT_ABI, functionName, args } as never) as Promise<T>;

export async function readVaultRules(b: Pick<Business, "vault" | "startBlock">): Promise<VaultRules> {
  const [addresses, dailyCap, spentToday, lenderBps, ownerBps, orderTtl] = await Promise.all([
    creationSuppliers(b),
    read<bigint>(b.vault, "dailyCap"),
    read<bigint>(b.vault, "spentToday"),
    read<number>(b.vault, "lenderBps"),
    read<number>(b.vault, "ownerBps"),
    read<bigint>(b.vault, "orderTtl"),
  ]);
  const suppliers = await Promise.all(
    addresses.map(async (address) => {
      const [allowed, perTxCap] = await read<readonly [boolean, bigint]>(b.vault, "suppliers", [address]);
      return { address, allowed, perTxCap };
    }),
  );
  return { suppliers, dailyCap, spentToday, lenderBps: Number(lenderBps), ownerBps: Number(ownerBps), orderTtlSeconds: Number(orderTtl) };
}

export async function getDecisions(vault: Hex, limit = 50): Promise<Decision[]> {
  const { data } = await api.get("/v1/decisions", { params: { vault, limit } });
  return z.array(decisionSchema).parse(data);
}
```
`spentToday` is stale after a UTC day rolls over until the next payment (the vault resets it lazily using `dayIndex`); read `dayIndex` too and show 0 when `dayIndex` is not today's index (`Math.floor(Date.now()/86400000)`) — confirm the index formula in `sc/src/LoanVault.sol` first, and add that case to the test.

Hooks in `useBusinessPage.ts`: `useRulesQuery(business)` (`staleTime: 60_000`), `useDecisionsQuery(vault)` (`refetchInterval: 15_000`).

Run: `bunx vitest run src/modules/business` → PASS.

- [ ] **Step 3: Components**

From the Business frames (`dhbE4`, `UXoyM`, `UNBEI`; Raising `CWcUW`):
- `BusinessHeader`: BusinessMark, name, StateBadge, tagline; phone layout per memory rule (icon + name on one row, badge and description below at the left edge).
- `LoanTerms`: KPI tiles for the loan (target, total owed, installment per period, raised/repaid via LoanBar, raise deadline when Raising), using `formatFusd`, `formatDateTime`, and the period in hours ("Every 1 hour").
- `VaultRules`: daily cap with spent today, split ("70% to lenders, 20% to the owner, 10% for operating costs" — compute opex as `10000 - lenderBps - ownerBps`), order time limit, supplier list (Address + per-payment cap; a removed supplier shows "Removed by a signed order").
- `ActivityTable`: orders for this vault (Table/Orders on desktop and tablet; stacked rows on phone per `Row/Order/Stacked` `Zfsty`): service name from `business.services`, status badge, price, buyer address, placed transaction link. No divider lines.
- `DecisionLog`: Row/Decision `snx4D` list: decision, reason, suppliers bought with amounts, cost, relative time. On desktop the column fills the page height (design change of the decision log column `eZ6u8`).
- `BusinessPage`: composes the above; loading skeleton per `e5itrK`; a `notFound` ApiError → the Not found frame `vChvM` (EmptyState `notfound`, "This business does not exist.", link back to the market); other errors → ErrorState. On phone there is no TabBar on this page; the primary action area is empty in Plan 3a (Lend and Order buttons arrive in Plan 3b).
- `app/agents/[slug]/page.tsx`:
```tsx
import { AppShell } from "@/components/layout/AppShell";
import { BusinessPage } from "@/modules/business";

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <AppShell><BusinessPage slug={slug} /></AppShell>;
}
```

`apps/fe/src/modules/business/components/BusinessPage.test.tsx`:
```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { ApiError } from "@/lib/apiClient";

vi.mock("@/modules/market", async (orig) => ({
  ...(await orig<object>()),
  useBusinessQuery: () => ({ isPending: false, isError: true, error: new ApiError("notFound", 404), refetch: vi.fn() }),
}));
import { BusinessPage } from "./BusinessPage";

test("an unknown slug shows the not-found state", () => {
  render(<QueryClientProvider client={new QueryClient()}><BusinessPage slug="nope" /></QueryClientProvider>);
  expect(screen.getByText("This business does not exist.")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /market/i })).toHaveAttribute("href", "/");
});
```

Run: `bunx vitest run src/modules/business` → PASS.

- [ ] **Step 4: Browser check**

Open `/agents/counterparty-check`, `/agents/contract-auditor` (Raising) and `/agents/nope` at 1440/834/390 in light and dark; compare with the frames above. Expected: real suppliers and caps, real orders and decisions, Raising layout for the auditor, not-found state for `nope`, no horizontal scroll, no hydration warning.

- [ ] **Step 5: Commit**

```bash
git add apps/fe
git commit -m "feat(fe): business page with loan terms, vault rules, activity and decision log" -m "Supplier addresses come from the vault's creation call and their caps from the vault now, so a removed supplier shows as removed. Tests: vitest (rules reader, not-found state), typecheck, lint, build; checked in Chrome at 390/834/1440."
```

---

### Task 8: Proof page and the "N of N proven" card

**Design frames:** Proof Claims `fEarZ` (Desktop `Wdr2S`, Tablet `W8jZ7D`, Phone `wYc6b`), Attacks `jrbwa` (`c0jfR`, `S0tXtN`, `WRzjc`); components Row/Proof `katTh`, Card/Attack `nSToj`.

**Files:**
- Create: `apps/fe/src/modules/proof/checks.ts`, `apps/fe/src/modules/proof/api/{proof.api.ts,proof.keys.ts,useProofQuery.ts}`
- Create: `apps/fe/src/modules/proof/components/{ProofPage,ClaimList,AttackList,ProvenCard}.tsx`, `index.ts`
- Create: `apps/fe/src/config/attacks.ts`, `apps/fe/src/app/proof/page.tsx`
- Modify: `apps/fe/src/modules/business/components/BusinessPage.tsx` (add `ProvenCard`)
- Test: `apps/fe/src/modules/proof/checks.test.ts`, `apps/fe/src/modules/proof/components/ProofPage.test.tsx`

**Interfaces:**
- Consumes: `restUrl()`, `publicClient`, `fetchPqcStatus`, `fetchSpendingRules` (`@qorechain/sdk`), `evmWindowStatus` (`@qorechain/evm`), `hexToQor`, `PAY_SUPPLIER_SELECTOR`, `FACTORY_ADDRESS`, `FACTORY_RUNTIME_CODEHASH`, `VAULT_FACTORY_ABI`, `LOAN_VAULT_ABI`, `ERC20_ABI`, `FUSD_ADDRESS`.
- Produces:
  - `type CheckId = "factory" | "ownerKey" | "spenderRule" | "operatorWindow" | "books" | "widening"`
  - `type CheckResult = { id: CheckId; status: "proven" | "failed" | "unknown"; detail: string }`
  - pure judges in `checks.ts`: `judgeFactory(inFactory: boolean, codeHash: string, expected: string)`, `judgeOwnerKey(s: { registered: boolean; possessionProven?: boolean })`, `judgeSpenderRule(rules: { allowedEvmCalls: string[] }[], vault: string, selector: string)`, `judgeOperatorWindow(w: { found: boolean; live: boolean; allowedTargets: string[] }, vault: string)`, `judgeBooks(books: readonly bigint[], balance: bigint)`, `judgeWidening(state: VaultStateName)` — each returns a `CheckResult`.
  - `runChecks(business: Business): Promise<CheckResult[]>` (each check isolated: a failed fetch gives `status: "unknown", detail: "This could not be checked right now."`).
  - `useProofQuery(business)`; `<ProvenCard business />` ("4 of 6 proven" with the list), `<ProofPage tab />`.
  - `ATTACKS: { id: string; title: string; stoppedBy: string; txHash: \`0x${string}\` | null }[]`

- [ ] **Step 1: Write the failing judge tests**

`apps/fe/src/modules/proof/checks.test.ts`:
```ts
import { describe, expect, test } from "vitest";
import { judgeBooks, judgeFactory, judgeOperatorWindow, judgeOwnerKey, judgeSpenderRule, judgeWidening } from "./checks";

const VAULT = "0x37bbb37dd96a973a22ca64bc809a8bc4d54b03d4";
const SEL = "0xdeadbeef";

describe("checks", () => {
  test("factory", () => {
    expect(judgeFactory(true, "0xaa", "0xaa").status).toBe("proven");
    expect(judgeFactory(false, "0xaa", "0xaa").status).toBe("failed");
    expect(judgeFactory(true, "0xbb", "0xaa").status).toBe("failed");
  });
  test("owner key must be registered and proven", () => {
    expect(judgeOwnerKey({ registered: true, possessionProven: true }).status).toBe("proven");
    expect(judgeOwnerKey({ registered: true, possessionProven: false }).status).toBe("failed");
    expect(judgeOwnerKey({ registered: true }).status).toBe("unknown");
    expect(judgeOwnerKey({ registered: false }).status).toBe("failed");
  });
  test("spender rule allows only paySupplier on this vault", () => {
    expect(judgeSpenderRule([{ allowedEvmCalls: [`${VAULT}/${SEL}`] }], VAULT, SEL).status).toBe("proven");
    expect(judgeSpenderRule([{ allowedEvmCalls: [`${VAULT.toUpperCase().replace("0X", "0x")}/${SEL}`] }], VAULT, SEL).status).toBe("proven");
    expect(judgeSpenderRule([{ allowedEvmCalls: [`${VAULT}/${SEL}`, `${VAULT}/0x12345678`] }], VAULT, SEL).status).toBe("failed");
    expect(judgeSpenderRule([{ allowedEvmCalls: [] }], VAULT, SEL).status).toBe("failed");
    expect(judgeSpenderRule([], VAULT, SEL).status).toBe("failed");
  });
  test("operator window reaches only the vault", () => {
    expect(judgeOperatorWindow({ found: true, live: true, allowedTargets: [VAULT] }, VAULT).status).toBe("proven");
    expect(judgeOperatorWindow({ found: true, live: true, allowedTargets: [] }, VAULT).status).toBe("failed");
    expect(judgeOperatorWindow({ found: true, live: true, allowedTargets: [VAULT, "0x1"] }, VAULT).status).toBe("failed");
    expect(judgeOperatorWindow({ found: false, live: false, allowedTargets: [] }, VAULT)).toMatchObject({ status: "unknown" });
  });
  test("books equal the fUSD balance", () => {
    expect(judgeBooks([1n, 2n, 3n, 4n, 5n], 15n).status).toBe("proven");
    expect(judgeBooks([1n, 2n, 3n, 4n, 5n], 16n).status).toBe("failed");
  });
  test("widening", () => {
    expect(judgeWidening("Active").status).toBe("proven");
    expect(judgeWidening("Trapped").status).toBe("proven");
    expect(judgeWidening("Repaid")).toMatchObject({ status: "proven", detail: "The loan is repaid, so the owner may widen the rules again." });
  });
});
```

Run: `bunx vitest run src/modules/proof` → FAIL.

- [ ] **Step 2: Implement `checks.ts`**

```ts
import type { VaultStateName } from "@/components/shared/StateBadge";

export type CheckId = "factory" | "ownerKey" | "spenderRule" | "operatorWindow" | "books" | "widening";
export type CheckResult = { id: CheckId; status: "proven" | "failed" | "unknown"; detail: string };

export const CHECK_TITLES: Record<CheckId, string> = {
  factory: "The vault was created by the published Qredit factory.",
  ownerKey: "The owner's ML-DSA-87 key is registered and proven.",
  spenderRule: "The agent key may only pay listed suppliers through this vault.",
  operatorWindow: "The operator key can reach only this vault.",
  books: "The vault's books equal its fUSD balance.",
  widening: "The rules cannot be widened while the loan runs.",
};

const r = (id: CheckId, status: CheckResult["status"], detail: string): CheckResult => ({ id, status, detail });
const lower = (s: string) => s.toLowerCase();

export const judgeFactory = (inFactory: boolean, codeHash: string, expected: string) =>
  !inFactory
    ? r("factory", "failed", "The factory does not list this vault.")
    : lower(codeHash) !== lower(expected)
      ? r("factory", "failed", "The factory on chain does not match the published build.")
      : r("factory", "proven", "The factory lists this vault, and its code matches the published build.");

export function judgeOwnerKey(s: { registered: boolean; possessionProven?: boolean }): CheckResult {
  if (!s.registered) return r("ownerKey", "failed", "The owner has no registered post-quantum key.");
  if (s.possessionProven === undefined) return r("ownerKey", "unknown", "The chain did not report whether the key was proven.");
  return s.possessionProven
    ? r("ownerKey", "proven", "The key is registered with a proof of possession.")
    : r("ownerKey", "failed", "The key is registered without a proof of possession.");
}

export function judgeSpenderRule(rules: { allowedEvmCalls: string[] }[], vault: string, selector: string): CheckResult {
  const expected = `${lower(vault)}/${lower(selector)}`;
  const calls = rules.flatMap((x) => x.allowedEvmCalls.map(lower));
  if (rules.length === 0 || calls.length === 0) return r("spenderRule", "failed", "No spending rule limits the agent key's calls.");
  return calls.every((c) => c === expected)
    ? r("spenderRule", "proven", "Every rule allows only paySupplier on this vault.")
    : r("spenderRule", "failed", "A rule allows a call other than paySupplier on this vault.");
}

export function judgeOperatorWindow(w: { found: boolean; live: boolean; allowedTargets: string[] }, vault: string): CheckResult {
  if (!w.found || !w.live) return r("operatorWindow", "unknown", "The operator has no open window right now, so it cannot send anything.");
  const t = w.allowedTargets.map(lower);
  return t.length === 1 && t[0] === lower(vault)
    ? r("operatorWindow", "proven", "The open window lists this vault as its only target.")
    : r("operatorWindow", "failed", "The open window allows other targets.");
}

export function judgeBooks(books: readonly bigint[], balance: bigint): CheckResult {
  const sum = books.reduce((a, b) => a + b, 0n);
  return sum === balance
    ? r("books", "proven", "Escrow, lender pool, owner share, operating funds and held funds add up to the balance.")
    : r("books", "failed", "The books do not add up to the vault's balance.");
}

export const judgeWidening = (state: VaultStateName): CheckResult =>
  state === "Repaid"
    ? r("widening", "proven", "The loan is repaid, so the owner may widen the rules again.")
    : r("widening", "proven", "The loan is not repaid, so the vault refuses every widening order.");
```
The `widening` check reports the contract's rule for the current state; the contract test `WideningLocked` is the evidence that the rule holds. If you think it should be `unknown` for some state, raise it in your report instead of changing it.

Run: `bunx vitest run src/modules/proof/checks.test.ts` → PASS.

- [ ] **Step 3: Implement `runChecks`**

`apps/fe/src/modules/proof/api/proof.api.ts`:
```ts
import { evmWindowStatus } from "@qorechain/evm";
import { fetchPqcStatus, fetchSpendingRules } from "@qorechain/sdk";
import { ERC20_ABI, FACTORY_ADDRESS, FACTORY_RUNTIME_CODEHASH, FUSD_ADDRESS, hexToQor, LOAN_VAULT_ABI, PAY_SUPPLIER_SELECTOR, VAULT_FACTORY_ABI } from "@qredit/qore";
import { keccak256 } from "viem";
import { vaultStateName } from "@/components/shared/StateBadge";
import { publicClient, restUrl } from "@/lib/chain";
import type { Business } from "@/lib/schemas";
import {
  judgeBooks, judgeFactory, judgeOperatorWindow, judgeOwnerKey, judgeSpenderRule, judgeWidening, type CheckId, type CheckResult,
} from "../checks";

const UNKNOWN = "This could not be checked right now.";
const guard = async (id: CheckId, run: () => Promise<CheckResult>): Promise<CheckResult> => {
  try {
    return await run();
  } catch {
    return { id, status: "unknown", detail: UNKNOWN };
  }
};

export async function runChecks(b: Business): Promise<CheckResult[]> {
  const vault = b.vault;
  const ownerPq = (await publicClient.readContract({ address: vault, abi: LOAN_VAULT_ABI, functionName: "ownerPq" })) as `0x${string}`;
  return Promise.all([
    guard("factory", async () => {
      const [all, code] = await Promise.all([
        publicClient.readContract({ address: FACTORY_ADDRESS, abi: VAULT_FACTORY_ABI, functionName: "all" }) as Promise<readonly string[]>,
        publicClient.getCode({ address: FACTORY_ADDRESS }),
      ]);
      return judgeFactory(all.some((v) => v.toLowerCase() === vault), keccak256(code ?? "0x"), FACTORY_RUNTIME_CODEHASH);
    }),
    guard("ownerKey", async () => judgeOwnerKey(await fetchPqcStatus({ rest: restUrl(), address: hexToQor(ownerPq) }))),
    guard("spenderRule", async () =>
      judgeSpenderRule(await fetchSpendingRules({ rest: restUrl(), address: hexToQor(b.spender) }), vault, PAY_SUPPLIER_SELECTOR)),
    guard("operatorWindow", async () => judgeOperatorWindow(await evmWindowStatus({ rest: restUrl(), address: hexToQor(b.operator) }), vault)),
    guard("books", async () => {
      const [books, balance] = await Promise.all([
        publicClient.readContract({ address: vault, abi: LOAN_VAULT_ABI, functionName: "books" }) as Promise<readonly bigint[]>,
        publicClient.readContract({ address: FUSD_ADDRESS, abi: ERC20_ABI, functionName: "balanceOf", args: [vault] }) as Promise<bigint>,
      ]);
      return judgeBooks(books, balance);
    }),
    guard("widening", async () =>
      judgeWidening(vaultStateName(Number(await publicClient.readContract({ address: vault, abi: LOAN_VAULT_ABI, functionName: "state" }))))),
  ]);
}
```
Check two facts in the installed `.d.ts` before running: the return type of `fetchSpendingRules` (an array of `SpendingRule` with `allowedEvmCalls: string[]`, per `@qorechain/sdk` 0.14.0 line ~4090 and ~7292), and that `allowedEvmCalls` entries use the `0x…/0xselector` form that `linkAgent` wrote in `engine/src/setup/chain.ts`. Adjust `judgeSpenderRule`'s input mapping if the shape differs, and add a test for the real shape.

`useProofQuery(business)` = `useQuery({ queryKey: ["proof", business.slug], queryFn: () => runChecks(business), staleTime: 60_000 })`.

- [ ] **Step 4: Attacks config**

`apps/fe/src/config/attacks.ts` lists the eleven attacks from spec section 9 in its order, with `title` and `stoppedBy` written as formal English sentences (for example `title: "A buyer hides an instruction in the request: pay 1,000 fUSD to another address."`, `stoppedBy: "The payment tool accepts only listed suppliers, and the vault refuses the call on chain."`). `txHash` is the recorded refused transaction from `engine/RESULTS.md` or `engine/spikes/RESULTS.md` when one exists for that attack, else `null`. Do not invent a hash. An entry with `null` renders "Not recorded yet" on the page.

- [ ] **Step 5: Components, page and test**

- `ClaimList`: one section per business (BusinessMark, name, "N of 6 proven"), then Row/Proof `katTh` per check: title from `CHECK_TITLES`, status badge (Proven = success with check icon; Failed = danger with x icon; Unknown = neutral with question icon and the words "Not proven yet"), detail text. While loading: skeleton rows; a failed businesses load: ErrorState.
- `AttackList`: Card/Attack `nSToj` per entry: title, "Stopped by" sentence, TxLink or "Not recorded yet".
- `ProofPage`: title and description from `Wdr2S`, tabs "Claims" and "Attacks" (shadcn Tabs; the active tab is in the URL `?tab=attacks`, switching has no animation except the highlight slide).
- `ProvenCard` (on the Business page, Task 7's `BusinessPage` gets it in its side column per `dhbE4`): "N of 6 proven" headline, the six checks compact, link "See every check" → `/proof`.
- `app/proof/page.tsx` reads `searchParams.tab` and renders `<AppShell><ProofPage tab={tab === "attacks" ? "attacks" : "claims"} /></AppShell>`; the component that reads search params on the client sits inside `<Suspense>`.

`apps/fe/src/modules/proof/components/ProofPage.test.tsx`:
```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn() }), usePathname: () => "/proof", useSearchParams: () => new URLSearchParams("tab=attacks") }));
vi.mock("@/config/attacks", () => ({
  ATTACKS: [
    { id: "a", title: "A leaked owner ECDSA key submits a policy order.", stoppedBy: "The vault checks an ML-DSA-87 signature.", txHash: null },
  ],
}));
import { ProofPage } from "./ProofPage";

test("an attack without a recorded transaction says so", () => {
  render(<QueryClientProvider client={new QueryClient()}><ProofPage tab="attacks" /></QueryClientProvider>);
  expect(screen.getByText("A leaked owner ECDSA key submits a policy order.")).toBeInTheDocument();
  expect(screen.getByText("Not recorded yet")).toBeInTheDocument();
});
```

Run: `cd apps/fe && bun run test && bun run typecheck && bun run lint && bun run build` → all pass.

- [ ] **Step 6: Browser check**

Open `/proof`, `/proof?tab=attacks` and `/agents/counterparty-check` at 1440/834/390 in light and dark. Expected: every check shows a real status from the chain (not all "Not proven yet"; if a check is `failed`, report it with its detail instead of changing the code), attacks list matches the spec, no console errors, no horizontal scroll.

- [ ] **Step 7: Commit**

```bash
git add apps/fe
git commit -m "feat(fe): proof page and proven card with live on-chain checks" -m "Six checks per business: factory build, owner key proof, spender rule, operator window, books against balance, widening lock. A check that cannot run shows Not proven yet. Tests: vitest (judges, attacks state), typecheck, lint, build; checked in Chrome."
```

---

### Task 9: Responsive and accessibility pass, then deployment

**Files:**
- Modify: any `apps/fe` component that fails a check below
- Create: `apps/fe/vercel.json` only if Step 3 needs it

- [ ] **Step 1: Full page sweep**

For each of `/`, `/agents/counterparty-check`, `/agents/contract-auditor`, `/agents/nope`, `/proof`, `/proof?tab=attacks`, `/lend` (404 until Plan 3b), check in Claude in Chrome at 390, 834 and 1440, in light and dark:
- no horizontal scroll (`document.documentElement.scrollWidth <= innerWidth`);
- every state fills its card or page (not squeezed at the top);
- keyboard: Tab reaches every link and button with a visible focus ring;
- touch targets ≥ 44 px when emulating a touch device;
- contrast of body text ≥ 4.5:1 in both themes (spot-check the secondary text on surface-muted);
- console: no hydration warning, no error.
Fix what fails, re-run `bun run test && bun run build`.

- [ ] **Step 2: Commit the fixes**

```bash
git add apps/fe
git commit -m "fix(fe): responsive and accessibility fixes from the page sweep" -m "Checked every Plan 3a page at 390/834/1440 in light and dark, with keyboard and touch emulation. Tests: vitest, build."
```
(Skip this commit if nothing needed fixing; say so in the report.)

- [ ] **Step 3: Prepare Vercel**

The app is hosted on Vercel at app.qredit.fun (spec section 5). Write the project settings into `apps/fe/README.md` under "Deploy": root directory `apps/fe`, install command `bun install` (run from the repo root by Vercel's monorepo detection), build command `bun run build`, environment variables from `.env.example`, domain `app.qredit.fun` (a CNAME at Hostinger pointing to Vercel's target). Add `vercel.json` only if Vercel cannot detect Bun from the lockfile. Commit:
```bash
git add apps/fe/README.md   # plus apps/fe/vercel.json if you created it
git commit -m "docs(fe): Vercel deployment settings" -m "Root directory, Bun install and build, environment variables and the app.qredit.fun domain. No tests (docs only)."
```

- [ ] **Step 4: Stop and ask before deploying**

Creating the Vercel project, setting its variables and adding the DNS record are outward-facing and need the user's accounts. Report the exact settings from Step 3 and ask the user whether to proceed and how (they create the project in the Vercel dashboard, or they authorise the Vercel CLI in this session). After the deploy, open `https://app.qredit.fun` and repeat the Step 1 checks on the live site, and confirm `https://api.qredit.fun` CORS accepts the origin (it already lists `https://app.qredit.fun`).

---

## Out of scope (later plans)

- **Plan 3b — wallet and actions:** in-browser test wallet (encrypted phrase, faucet, ML-DSA and ML-KEM registration, recipient card, scoped window), QoreX connect, account menu with the theme switch, Lend sheet and My lending, New order (sealed request + `buy`), Inbox and Report (open sealed reports), Owner console (signed policy orders), Connect dialog states.
- **Plan 3c — landing page** `apps/landing` at qredit.fun.
- The `@qorechain/qorex-*` connector dependency (spec section 3) belongs to Plan 3b, where QoreX is used.
