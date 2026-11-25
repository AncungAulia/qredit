# Qredit Plan 3b: Wallet and Actions — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let any visitor act on Qredit from `apps/fe`: create a throwaway testnet wallet in the browser (or connect QoreX), lend to a business, buy a sealed report, open it in the inbox, and, as an owner, sign and apply policy orders.

**Architecture:** One signer interface with two implementations: the **test wallet** (BIP-39 phrase encrypted with WebCrypto in `localStorage`; it signs Cosmos txs hybrid with the SDK and EVM txs with viem through a scoped window) and **QoreX** (`window.qorex.native`: `enable`, `getKey`, `signArbitrary`, `signAndBroadcast`). The buyer/lender chain steps the engine already proved by script move from `engine/` into `@qredit/qore` so the engine and the browser share them. The browser reaches the Cosmos RPC and REST APIs only through the app's allowlisted proxy routes (they send no CORS headers); the EVM RPC is called directly.

**Tech Stack:** as Plan 3a (Next.js 16, React 19, Tailwind 4, shadcn on Base UI, TanStack Query, react-hook-form + zod, viem 2.58.6, `@qorechain/sdk` 0.14.0, `@qorechain/evm` 0.14.0) plus `@qorechain/qoreseal` 0.1.0, `@qorechain/qorex-types` 0.1.0, `zustand` (store factory behind a provider).

## Global Constraints

- Everything in Plan 3a's Global Constraints still applies (Bun only; testnet `qorechain-diana` / EVM 9800; fUSD `0x97143B771D34ddb9130b807b135Ae675A5a963CA` 6 decimals; honest data; formal English copy; no dividers; tabular numbers; light + dark; motion-rules; shimmer skeletons, never `animate-pulse`; components never call axios/fetch/viem directly; money and dates only through `src/lib/format.ts`; types from zod; `@/` imports only).
- **Folder layout:** routes in `apps/fe/app/`; all other code in `apps/fe/src/`; every test in `apps/fe/src/test/` mirroring the source path.
- **Keys never leave the browser.** The phrase, private keys, ML-DSA and ML-KEM secrets live only in memory (decrypted session) and encrypted in `localStorage`. Never send them to any server, never log them, never put them in a URL, never store them unencrypted. The app server (route handlers) never sees a key.
- **The test wallet is labelled as a throwaway testnet wallet** in every place it is created, unlocked or backed up (spec §14).
- **Forms:** react-hook-form + zod, `mode: "onTouched"`; amounts through the shared `NumberInput` and `parseFusd`.
- **Risky or irreversible actions** (send a transaction that moves fUSD, apply a policy order, reveal the phrase, forget the wallet) are confirmed first with `ConfirmDialog` / `ConfirmSheet` (design components `WGStX` / `knRLS`).
- **Chain action lifecycle** (design board "Chain action lifecycle" `E90aGk`): idle → confirming → waiting for the wallet → waiting for the chain → done / refused; refused shows the decoded reason (vault error name mapped to a sentence), never raw revert data.
- **The REST proxy rules from Plan 3a stay:** safe segments only, normalized URL, allowlist checked on the normalized path, GET only; the new RPC proxy accepts POST JSON-RPC with a method allowlist only.
- **Shared chain helpers go to `packages/qore`** (root CLAUDE.md); no engine module is imported by `apps/fe`.
- Repo text English; no durations or schedules in committed files; commits `feat(fe): …` etc. with body (why + tests) and `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

---

## Facts this plan relies on (checked while writing it)

- `GET`/`POST` to `https://rpc-testnet.qore.host` and REST `POST /cosmos/tx/v1beta1/txs` return **no CORS headers**: browser broadcasts need a proxy.
- `broadcastHybrid` (`packages/qore/src/tx.ts`) reads the account from REST `cosmos/auth/v1beta1/accounts/{addr}`, signs with `EthNativeSigner(acc, { signMode, rest, registry })` and broadcasts through `StargateClient.connect(rpc)`; `txEvents` polls REST `cosmos/tx/v1beta1/txs/{hash}`.
- The faucet (`POST https://api.qredit.fun/v1/faucet` `{ address: qor1… }`) sends 2 QOR (2,000,000 uqor) and 50 fUSD as the **bank coin** `erc20:0x9714…63CA`; the wallet must run `MsgConvertCoin` (`convertCoinMsg` in qore) before EVM use. One claim per address/IP per 24 h; 429 carries `retryAt`.
- Buyer setup proven by script (`engine/src/setup/demo-buyer.ts`): fund → `registerKey` (classical tx, proof of possession) → `convertFusd` → `registerSealKey` (`pqcMsg.registerKemKey`) → wait one block → `publishCard` (`signRecipientCard`, `PUT /v1/cards/{qor1}`) → per order `ensureWindow([FUSD, vault])` → approve → `buy(serviceId, envelopeHash)`.
- Sealing: `sealRequest` / `REQUEST_PURPOSE = "qredit/request/v1"`, `REPORT_PURPOSE = "qredit/report/v1"`, request aad = lowercase vault, report aad = `${vault}:${orderId}`; buyer seal keys = `deriveSealKeys({ mnemonic })` (`engine/src/agent/seal.ts`, `engine/src/setup/demo-buyer.ts`).
- Policy orders: the vault exposes `orderText(order)` (the string QoreX signs) and `signedBytes(order)`; `applyOrder(order, sig)` is callable by anyone. QoreX `signArbitrary(chainId, bech32Address, text)` returns `{ pq: { signature: base64 } … }`; the bytes of `sig.pq.signature` are what `applyOrder` takes (spike S3, `engine/spikes/src/s3-message-sig.ts`).
- QoreX's EVM provider cannot send EVM transactions; QoreX users still need the test wallet for `deposit`, `buy` and to submit `applyOrder`.
- npm has `@qorechain/qorex-types` 0.1.0 (types for `window.qorex`); no `qorex-connector` package exists.
- Lender reads: `deposits(addr)`, `lenderClaimable(addr)`, `lenderClaimed(addr)`, `state()`; actions `deposit`, `refund`, `claimLender`. Buyer: `orders(id)`, `reclaim(id)`; `Delivered(orderId, envelopeHash, …)` log is emitted by the operator's direct EVM tx.

## File map

```
packages/qore/src/
  buyer.ts            (create) registerPqcKey, convertFusd, registerKemKey, signedCard, windowCovers, ensureWindow (injected sleep)
  seal.ts             (create) purposes, sealRequest, openReport, openRequest helpers, recipient resolver
  lend.ts             (create) planLend
engine/src/setup/chain.ts, seal.ts, demo-buyer.ts; engine/src/agent/seal.ts, recipient.ts   (modify) re-export/use qore
apps/fe/
  app/api/chain/rpc/route.ts                     (create) JSON-RPC proxy, method allowlist
  app/api/chain/rest/[...path]/route.ts           (modify) add tx-by-hash and any SDK paths the gate finds
  app/lend/page.tsx, app/shop/[slug]/page.tsx, app/inbox/page.tsx,
  app/inbox/[vault]/[orderId]/page.tsx, app/owner/page.tsx
  src/modules/wallet/      keystore.ts, session.ts (store factory), setup/steps.ts, signer.ts, qorex.ts,
                           api/*, components/{ConnectDialog,AccountMenu,WalletSetup,UnlockForm,CreateWalletForm,ImportWalletForm,BackupPhrase}.tsx, index.ts
  src/modules/lend/        api/, components/{LendSheet,PositionsPage,PositionCard,ClaimButton}.tsx, index.ts
  src/modules/orders/      api/, components/{NewOrderPage,OrderForm,OrderProgress}.tsx, index.ts
  src/modules/inbox/       api/, components/{InboxPage,ReportPage,ReportView}.tsx, index.ts
  src/modules/owner/       api/, components/{OwnerPage,PolicyOrderForm,OrderSignature}.tsx, index.ts
  src/components/shared/   ChainAction.tsx (lifecycle UI), ConfirmDialog.tsx (if not present), vaultErrors.ts
  src/test/...             mirrors all of the above
```

---

### Task 0: Page titles, quiet scrollbars and the Q favicon (user requests)

**Files:**
- Modify: `apps/fe/app/layout.tsx` (title template), every `apps/fe/app/**/page.tsx` and `not-found.tsx` (static `metadata.title`), `apps/fe/app/globals.css` (scrollbars)
- Create: `apps/fe/app/icon.svg` (theme-aware favicon), `apps/fe/app/apple-icon.png` (180×180), `apps/fe/app/favicon.ico` (replace the Next default; 32×32 + 16×16)
- Source: `design/brand/qredit-mark.svg` (the Corner Q mark exported from the design, viewBox 0 0 135 135)
- Test: `apps/fe/src/test/app/metadata.test.ts`

**Requirements:**
1. **Titles read `<Page> | Qredit`.** Layout: `title: { default: "Qredit", template: "%s | Qredit" }`. Static titles: `/` → "Market", `/agents/[slug]` → "Business" (keep the existing one), `/proof` → "Proof", `/lend` → "My lending", `/shop/[slug]` → "New order", `/inbox` → "Inbox", `/inbox/[vault]/[orderId]` → "Report", `/owner` → "Owner console", 404 → "Page not found". (Routes created by later tasks add their title in the same task; this task sets the template and the existing pages.)
2. **Quiet scrollbars like HelloNear's app** (source: `D:/Coding/orca-workspace/hellonear/apps/fe/src/styles/globals.css`, the "Quiet scrollbars" block): thin 6 px rounded thumb, no arrows, no track; Chrome/Safari through `::-webkit-scrollbar` only (do not set `scrollbar-width`/`scrollbar-color` for them — Chrome then falls back to the system bar with arrows on Windows); Firefox through `@supports (-moz-appearance: none) { * { scrollbar-width: thin; scrollbar-color: … transparent } }`; a `.scrollbar-on-hover` utility (thumb only while hovered or focus is inside). Colours from our tokens: `--scrollbar-thumb: color-mix(in oklab, var(--text-primary) 22%, transparent)`, `--scrollbar-thumb-hover: color-mix(in oklab, var(--text-primary) 38%, transparent)` (works in both themes because `--text-primary` flips).
3. **Favicon is the Q mark and follows the browser theme:** dark tab → white mark, light tab → black mark. `app/icon.svg` = the mark's path from `design/brand/qredit-mark.svg` with an embedded style:
   ```svg
   <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 135 135">
     <style>path{fill:#17171A}@media (prefers-color-scheme: dark){path{fill:#F4F4F2}}</style>
     <path transform="translate(-21.0937 -21.0937)" fill-rule="evenodd" d="…copy the d attribute from design/brand/qredit-mark.svg…"/>
   </svg>
   ```
   (`prefers-color-scheme` inside an SVG favicon follows the browser/OS theme, which is what colours the tab strip.) `favicon.ico` and `apple-icon.png` are raster fallbacks: black mark on transparent for the ico, black mark on `#F2F1EE` with padding for the apple icon. Generate them from the SVG with a small script (e.g. `@resvg/resvg-js` run once via `bunx`, or Python Pillow + cairosvg) — do not commit the script's dependencies; commit only the images.
- [ ] **Step 1: Test (RED)** `metadata.test.ts`: import `metadata` from `app/layout.tsx` and each existing page module; assert the template `"%s | Qredit"`, default `"Qredit"`, and each page's title string.
- [ ] **Step 2: Implement** the three items; GREEN; four checks.
- [ ] **Step 3: Browser:** tab titles read e.g. "Proof | Qredit"; the favicon is the Q (check with the browser in light and dark theme: emulate `prefers-color-scheme` in DevTools, reload); scrollbars are thin with no arrows on Windows Chrome in light and dark.
- [ ] **Step 4: Commit** `feat(fe): page titles, quiet scrollbars and the Q favicon`.

---

### Task 1: Move the buyer and lender chain steps into `@qredit/qore`

The engine's buyer/lender helpers are the proven way to do every step the browser needs. Move them into `packages/qore` (browser-safe: no `node:*`, no `Bun.*`, sleep injected), make the engine import them from there, and keep every engine test green. Pure moves plus the sleep injection; no behaviour change.

**Files:**
- Create: `packages/qore/src/buyer.ts`, `packages/qore/src/seal.ts`, `packages/qore/src/lend.ts`; export them from `packages/qore/src/index.ts`
- Modify: `engine/src/setup/chain.ts`, `engine/src/setup/seal.ts`, `engine/src/setup/demo-buyer.ts`, `engine/src/agent/seal.ts`, `engine/src/agent/recipient.ts` (import from `@qredit/qore`; keep their Node/Bun-only parts — keystore, `randomBytes` seed creation, `Bun.sleep` default — in the engine)
- Add deps to `packages/qore/package.json`: `@qorechain/qoreseal` `0.1.0`, `@qorechain/evm` `0.14.0`, `zod` `3.24.x` (same versions the engine pins; check `engine/package.json`)
- Test: `packages/qore/test/buyer.test.ts`, `packages/qore/test/seal.test.ts`, `packages/qore/test/lend.test.ts` (move the matching engine tests: `engine/test/chain.test.ts` window/planLend cases, `engine/test/seal.test.ts`, `engine/test/recipient.test.ts` — move, do not duplicate)

**Interfaces (produced):**
```ts
// buyer.ts
export type Sleep = (ms: number) => Promise<void>;
export const defaultSleep: Sleep; // setTimeout-based
export function registerPqcKey(net: Net, acc: UnifiedAccount): Promise<string | null>;        // null when already registered
export function convertFusd(net: Net, acc: UnifiedAccount, units: bigint): Promise<string>;
export function registerKemKey(net: Net, acc: UnifiedAccount, mlkemPublicKey: Uint8Array): Promise<string | null>;
export function signedCard(net: Net, acc: UnifiedAccount, keys: SealKeyPair): RecipientCard; // signRecipientCard
export function windowCovers(w: EvmWindow, targets: string[], min: { blocks: number; txs: number }, openedByUs?: Set<string>): boolean;
export type WindowOptions = { blocks?: number; maxTxs?: number; maxValue?: bigint };
export function openWindow(net: Net, acc: UnifiedAccount, targets: string[], o?: WindowOptions, sleep?: Sleep): Promise<string>;
export function ensureWindow(net: Net, acc: UnifiedAccount, targets: string[], o?: WindowOptions & { minBlocks?: number; minTxs?: number }, deps?: { status?: (acc) => Promise<EvmWindow>; open?: typeof openWindow; sleep?: Sleep }): Promise<string | null>;
export const BUYER_WINDOW: WindowOptions; // { blocks: 3600, maxTxs: 40, maxValue: 60_000_000n }
// seal.ts
export const REQUEST_PURPOSE = "qredit/request/v1"; export const REPORT_PURPOSE = "qredit/report/v1"; export const MAX_INPUT = 2000;
export const requestSchema; export type RequestBody;
export function sealRequest(o: { body: RequestBody; vault: string; recipient: SealRecipient; chainId: string }): string;
export function openReport(o: { text: string; vault: string; orderId: string; keys: SealKeyPair; chainId: string }): unknown; // throws ReportUnreadable
export class ReportUnreadable extends Error {}
export function createRecipientResolver(o: { rest: string; chainId: string; card: (qor: string) => Promise<unknown | null> }): (address0x: string) => Promise<SealRecipient | null>;
// lend.ts
export type LendPlan = { action: "skip"; reason: string } | { action: "deposit"; amount: bigint; approve: boolean };
export function planLend(v: { state: number; raised: bigint; target: bigint; balance: bigint; allowance: bigint }, requested: bigint): LendPlan;
```
`openRequest`/`sealReport` (agent side) stay in the engine but import the purposes and schema from qore. `Net` and `broadcastHybrid` already live in qore; `buyer.ts` functions take `net` instead of the engine's module-level `TESTNET` constant so the browser can pass a proxied `Net` (`rest`/`rpc` pointing at the app's proxy).

- [ ] **Step 1: Move the tests first (RED).** `git mv` the matching cases into `packages/qore/test/*.test.ts`, change imports to `../src/buyer.ts` etc. Run `cd packages/qore && bun test` — expect FAIL (modules missing).
- [ ] **Step 2: Move the code.** Create the three files by moving the functions from the engine files listed above, replacing `Bun.sleep(ms)` with the injected `sleep` (default `defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms))`), the module-level `TESTNET` with the `net` parameter, and `Buffer` with `@scure/base` `hex`. In the engine, replace the moved bodies with imports from `@qredit/qore` and pass `TESTNET` and `Bun.sleep` where the old code used them. `randomBytes`-based seed creation and the keystore stay in the engine.
- [ ] **Step 3: GREEN.** `cd packages/qore && bun test && bun run typecheck`; `cd engine && bun test && bun run typecheck`; root `bun run typecheck`. All pass, engine count unchanged (moved tests now counted in qore). `grep -rn "Bun\.\|node:\|Buffer" packages/qore/src` → no output.
- [ ] **Step 4: Commit** `refactor(qore): buyer, seal and lend steps shared by the engine and the web app` (body: why — the browser runs the same proven steps; tests run).

---

### Task 2: RPC proxy, REST additions and the in-browser broadcast gate

**Go/no-go gate.** Plan 3a proved SDK *reads* in the browser. This task proves a hybrid-signed **broadcast** from the browser: a fresh test account, funded by the faucet, registers its ML-DSA key through the proxies.

**Files:**
- Create: `apps/fe/app/api/chain/rpc/route.ts`, `apps/fe/src/lib/net.ts`
- Modify: `apps/fe/app/api/chain/rest/[...path]/route.ts` (allowlist additions), `apps/fe/CLAUDE.md`
- Create (temporary, deleted in Step 6): `apps/fe/app/broadcast-check/page.tsx`
- Test: `apps/fe/src/test/app/api/chain/rpc/route.test.ts`, `apps/fe/src/test/app/api/chain/rest/route.test.ts` (extend)

**Interfaces (produced):**
- `POST /api/chain/rpc` — body is one JSON-RPC 2.0 request (no batches); `method` must be in `RPC_METHODS = ["status", "abci_query", "broadcast_tx_sync", "tx", "block"]` (trim to what the gate shows is used); forwards to `QORE_RPC_URL` (default `https://rpc-testnet.qore.host`) with `cache-control: no-store`; 400 `{error}` for anything else; body limit 64 KB.
- `browserNet(): Net` in `src/lib/net.ts` — `{ chainId: env.chainId, rest: restUrl(), rpc: rpcUrl(), evm: env.evmUrl }` where `rpcUrl() = ${window.location.origin}/api/chain/rpc`.

- [ ] **Step 1: RPC proxy tests (RED).**
```ts
// src/test/app/api/chain/rpc/route.test.ts
import { afterEach, expect, test, vi } from "vitest";
import { POST } from "../../../../../../app/api/chain/rpc/route";
afterEach(() => vi.restoreAllMocks());
const call = (body: unknown) => POST(new Request("http://x/api/chain/rpc", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } }));

test("forwards an allowed method", async () => {
  const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response('{"jsonrpc":"2.0","id":1,"result":{}}', { status: 200 }));
  const res = await call({ jsonrpc: "2.0", id: 1, method: "status", params: {} });
  expect(res.status).toBe(200);
  expect(spy.mock.calls[0][0]).toBe("https://rpc-testnet.qore.host");
  expect(res.headers.get("cache-control")).toBe("no-store");
});
test("refuses other methods, batches and bad bodies", async () => {
  expect((await call({ jsonrpc: "2.0", id: 1, method: "unsafe_flush_mempool" })).status).toBe(400);
  expect((await call([{ jsonrpc: "2.0", id: 1, method: "status" }])).status).toBe(400);
  expect((await POST(new Request("http://x", { method: "POST", body: "not json" }))).status).toBe(400);
});
```
Fix the relative import depth to the real file location.
- [ ] **Step 2: Implement** the route (parse JSON, reject arrays, check `method` against `RPC_METHODS`, reject bodies over 64 KB via `content-length` and actual length, forward with `AbortSignal.timeout(20_000)`, return upstream status/body, `no-store`) and `src/lib/net.ts`. Add `QORE_RPC_URL` (name only) to `.env.example` and the README env section. GREEN.
- [ ] **Step 3: Temporary broadcast-check page.** A client page that: generates a fresh phrase (`generateMnemonic(256)`), derives the account (`deriveUnifiedAccount(phrase, 0)`), shows the `qor1` address, calls the faucet through `api` (`POST /v1/faucet`), waits for the funds (poll REST balances), then calls `registerPqcKey(browserNet(), acc)` from `@qredit/qore` and prints the tx hash and `txEvents` result. Nothing is persisted; the phrase stays in memory only and is not displayed.
- [ ] **Step 4: Run it in Chrome** (`bun run build && bun run start`, port 3000). Record every request the page makes to `/api/chain/rest/*` and `/api/chain/rpc`. Add each needed REST path prefix to the REST allowlist (at least `cosmos/tx/v1beta1/txs/` GET for `txEvents`, plus any params/protocol-feature path `EthNativeSigner` fetches) and each RPC method to `RPC_METHODS` — minimal set, with a test per addition. Re-run until: faucet tx ok, `registerPqcKey` returns a hash, `txEvents` succeeds, console has no CORS or Buffer error. **If the broadcast cannot be made to work, stop and report BLOCKED with the exact error** (fallback per spec S4: build unsigned messages server-side is out of scope without a human decision).
- [ ] **Step 5:** Record the gate result (address, tx hash, the final allowlists) in the task report.
- [ ] **Step 6:** Delete `app/broadcast-check`, run `bun run typecheck && bun run lint && bun run test && bun run build`, document the two proxies in `apps/fe/CLAUDE.md`, commit `feat(fe): JSON-RPC proxy and the in-browser broadcast gate` (body includes the gate's tx hash).

---

### Task 3: Test-wallet keystore and session

**Files:**
- Create: `apps/fe/src/modules/wallet/keystore.ts`, `apps/fe/src/modules/wallet/session.ts`, `apps/fe/src/modules/wallet/WalletProvider.tsx`, `apps/fe/src/modules/wallet/index.ts`
- Modify: `apps/fe/app/Providers.tsx` (wrap in `WalletProvider`)
- Install: `bun add zustand` (load the `zustand` skill first, as the starter kit says)
- Test: `apps/fe/src/test/modules/wallet/keystore.test.ts`, `apps/fe/src/test/modules/wallet/session.test.ts`

**Interfaces (produced):**
```ts
// keystore.ts — pure WebCrypto, no React
export const KEYSTORE_KEY = "qredit.testWallet.v1";
export type StoredWallet = { v: 1; address: string; salt: string; iv: string; ct: string; createdAt: string }; // base64 fields, address qor1
export function encryptPhrase(phrase: string, password: string, address: string): Promise<StoredWallet>;
export function decryptPhrase(stored: StoredWallet, password: string): Promise<string>; // throws WrongPassword
export class WrongPassword extends Error {}
export function readStored(storage?: Storage): StoredWallet | null;   // try/catch, zod-validated
export function writeStored(w: StoredWallet, storage?: Storage): void;
export function forgetStored(storage?: Storage): void;
// session.ts — store factory (never a module-level create())
export type WalletSession =
  | { kind: "none" }
  | { kind: "locked"; address: string }
  | { kind: "test"; address: string; evm: `0x${string}`; account: UnifiedAccount; sealKeys: SealKeyPair }
  | { kind: "qorex"; address: string; evm: `0x${string}`; testWallet: Extract<WalletSession, { kind: "test" }> | null };
export type WalletStore = { session: WalletSession; unlock(password: string): Promise<void>; create(phrase: string, password: string): Promise<void>; lock(): void; forget(): void; connectQorex(): Promise<void>; disconnectQorex(): void };
export const createWalletStore: (deps?: { storage?: Storage; qorex?: QorexClient }) => StoreApi<WalletStore>;
export function useWallet<T>(selector: (s: WalletStore) => T): T;   // from WalletProvider context
```
Crypto parameters: PBKDF2-SHA-256, 600,000 iterations, 16-byte random salt, AES-GCM 256 with 12-byte random IV; additional data = `address` (so a swapped address fails decryption). Password rules (zod): at least 8 characters.

- [ ] **Step 1: Tests (RED).**
```ts
// src/test/modules/wallet/keystore.test.ts
import { expect, test } from "vitest";
import { decryptPhrase, encryptPhrase, readStored, WrongPassword, writeStored } from "@/modules/wallet/keystore";

const PHRASE = "abandon ".repeat(23) + "art";
test("round-trips and never stores the phrase in clear", async () => {
  const w = await encryptPhrase(PHRASE, "correct horse", "qor1test");
  expect(JSON.stringify(w)).not.toContain("abandon");
  expect(await decryptPhrase(w, "correct horse")).toBe(PHRASE);
});
test("a wrong password or a swapped address fails", async () => {
  const w = await encryptPhrase(PHRASE, "correct horse", "qor1test");
  await expect(decryptPhrase(w, "wrong pass")).rejects.toBeInstanceOf(WrongPassword);
  await expect(decryptPhrase({ ...w, address: "qor1other" }, "correct horse")).rejects.toBeInstanceOf(WrongPassword);
});
test("bad stored data reads as null", () => {
  const s = new Map<string, string>();
  const storage = { getItem: (k: string) => s.get(k) ?? null, setItem: (k: string, v: string) => void s.set(k, v), removeItem: (k: string) => void s.delete(k) } as unknown as Storage;
  s.set("qredit.testWallet.v1", "{broken");
  expect(readStored(storage)).toBeNull();
});
```
`session.test.ts`: create → session `test` with the derived address; lock → `locked`; unlock with the right password → `test`; wrong password → stays `locked` and rejects `WrongPassword`; forget → `none` and storage cleared. Use a fixed test phrase; derivation is slow (ML-DSA keygen) — set the test timeout to 30 s.
- [ ] **Step 2: Implement** keystore (WebCrypto `crypto.subtle`, base64 via `@scure/base`), session store factory with zustand `createStore`, `WalletProvider` (creates one store per mount, exposes it by context; on mount reads storage: `locked` if a stored wallet exists), `useWallet`. Derivation: `deriveUnifiedAccount(phrase, 0)` and `deriveSealKeys({ mnemonic: phrase })`. The phrase string is dropped after derivation (not kept in the store).
- [ ] **Step 3: GREEN**, then the four checks; commit `feat(fe): encrypted test-wallet keystore and wallet session`.

---

### Task 4: Test-wallet setup steps

**Files:**
- Create: `apps/fe/src/modules/wallet/setup/steps.ts`, `apps/fe/src/modules/wallet/api/wallet.api.ts`, `apps/fe/src/modules/wallet/api/useWalletStatus.ts`
- Test: `apps/fe/src/test/modules/wallet/setup/steps.test.ts`

**Interfaces (produced):**
```ts
export type SetupStep = "fund" | "registerKey" | "convert" | "registerKem" | "publishCard";
export type SetupStatus = Record<SetupStep, "done" | "todo" | "waiting">;
export type WalletChainStatus = { qor: bigint; fusdBank: bigint; fusd: bigint; pqcRegistered: boolean; kemRegistered: boolean; cardPublished: boolean };
export function readWalletStatus(acc: UnifiedAccount): Promise<WalletChainStatus>;   // REST balances, fetchPqcStatus, fetchKemKey, GET /v1/cards/{qor1}, ERC-20 balanceOf
export function setupStatus(s: WalletChainStatus): SetupStatus;                     // pure
export function nextStep(s: SetupStatus): SetupStep | null;                          // first "todo" in order
export function runStep(step: SetupStep, ctx: { acc; sealKeys; net: Net; status: WalletChainStatus }): Promise<string | null>; // tx hash, or null
export function claimFaucet(address: string): Promise<{ tx: string } | { retryAt: Date }>;
export const useWalletStatusQuery: (acc | null) => UseQueryResult<WalletChainStatus>;
```
Rules: `fund` is done when qor > 0 or any fUSD exists; `convert` is done when `fusdBank === 0n` and `fusd > 0n`; `convert` converts the whole bank balance; after `registerKem` wait one block (the `sleep` from qore) before `publishCard` (the card check reads the on-chain KEM key); `publishCard` PUTs `signedCard(...)` to `/v1/cards/{qor1}`. Each step awaits `txEvents` before returning (one account = one sequence).

- [ ] **Step 1: Tests (RED)** for `setupStatus` and `nextStep` (all combinations that matter: fresh account → fund; funded, unregistered → registerKey; registered with bank fUSD → convert; converted, no KEM → registerKem; KEM but no card → publishCard; all done → null) and for `runStep` with mocked qore functions (each step calls exactly its function with the right args; `publishCard` PUTs the card through `api`). `claimFaucet` maps 429 `{retryAt}` to `{ retryAt: Date }`.
- [ ] **Step 2: Implement**; GREEN; four checks; commit `feat(fe): resumable test-wallet setup steps`.

---

### Task 5: QoreX adapter and the signer interface

**Files:**
- Create: `apps/fe/src/modules/wallet/qorex.ts`, `apps/fe/src/modules/wallet/signer.ts`
- Install: `bun add @qorechain/qorex-types@0.1.0` (read its `.d.ts` first; type `window.qorex` from it; if its shape disagrees with the probe page `engine/spikes/web/index.html`, follow the live probe and note it)
- Test: `apps/fe/src/test/modules/wallet/qorex.test.ts`, `apps/fe/src/test/modules/wallet/signer.test.ts`

**Interfaces (produced):**
```ts
// qorex.ts
export type QorexState = "notInstalled" | "wrongNetwork" | "ready";
export type QorexClient = {
  detect(): QorexState;                                        // window.qorex?.native present; chain id check via getKey/enable error
  connect(): Promise<{ address: string; evm: `0x${string}` }>; // enable(CHAIN) then getKey(CHAIN).bech32Address; evm = qorToHex
  signArbitrary(address: string, text: string): Promise<Uint8Array>; // sig.pq.signature (base64) → bytes; throws QorexNoPqSignature if absent
  capabilities(): string[];
};
export function createQorexClient(win?: Window): QorexClient;
// signer.ts — what pages use; hides which wallet acts
export type EvmSigner = { address: `0x${string}`; send(to: `0x${string}`, data: `0x${string}`): Promise<`0x${string}`> }; // waits for receipt, throws TxReverted with decoded reason
export function evmSignerFor(session: WalletSession, net: Net): EvmSigner | null;   // test wallet only (QoreX cannot send EVM txs)
export function ensureWindowFor(session: WalletSession, targets: string[]): Promise<string | null>; // qore ensureWindow with browserNet + BUYER_WINDOW
export class TxReverted extends Error { constructor(readonly hash: `0x${string}` | null, readonly reason: string) }
```
- [ ] **Step 1: Tests (RED)** with a fake `window.qorex.native`: not installed → `notInstalled`; `enable` rejecting with a chain-not-found error → `wrongNetwork`; connect returns the bech32 and its hex; `signArbitrary` decodes base64 `pq.signature`, throws when `pq` is missing. `evmSignerFor` returns null for `none`/`locked`/QoreX-without-test-wallet; `send` decodes a revert into the vault error name (use `decodeErrorResult` with `LOAN_VAULT_ABI` + `ERC20_ABI`; map in `src/components/shared/vaultErrors.ts` to a sentence, e.g. `WideningLocked` → "The vault refuses to widen its rules until the loan is repaid.").
- [ ] **Step 2: Implement**; GREEN; checks; commit `feat(fe): QoreX adapter and one signer interface`.

---

### Task 6: Connect dialog, account menu and wallet setup UI

**Design frames:** Connect band (light): Choose `Ar6Kf` (`mUWLT`, `r0o7ej`, `mdeLy`), Connecting `QSH3U`, QoreX on mainnet `buTyG`, QoreX not installed `x3wmr9`; components `ConnectDialog` `i0gdt`, `ConnectSheet` `LeKtH`, `AccountMenu` `CJSSm` (with `ThemeSwitch` `NAI2Y`), `Account` `EPJm4`, TopBar `m9fRB` right side, MobileHeader `YBhsY` account button; New order "First time" row `Xmrbh` shows the setup steps; board "Account menu" `SPP6w`.

**Files:**
- Create: `apps/fe/src/modules/wallet/components/{ConnectDialog,CreateWalletForm,ImportWalletForm,UnlockForm,WalletSetup,AccountMenu,AccountButton,BackupPhrase}.tsx`; `apps/fe/src/components/shared/ChainAction.tsx`
- Modify: `TopBar.tsx`, `MobileHeader.tsx` (account button), `apps/fe/src/modules/wallet/index.ts`
- Test: `apps/fe/src/test/modules/wallet/components/*.test.tsx`, `apps/fe/src/test/components/shared/ChainAction.test.tsx`

**Behaviour:**
- Connect (dialog on desktop/tablet, sheet on phone via `ResponsiveDialog`): two choices — "Try without a wallet" (create or import a throwaway testnet wallet; the copy says so plainly) and "Connect QoreX" (states: connecting, wrong network — tells the user to switch QoreX to Testnet by tapping the version text seven times, not installed — link to the extension page).
- Create: generates the phrase, shows it once in `BackupPhrase` (copy button; "I saved it" checkbox), asks for a password (twice), encrypts, starts setup. Import: textarea for the phrase (validated with `validateMnemonic`), password. Unlock: password; "Forget this wallet" behind `ConfirmDialog`.
- `WalletSetup`: list of the five steps with status from `useWalletStatusQuery`, one primary button for `nextStep`, `ChainAction` per running step; the faucet's `retryAt` shows "You can ask for test funds again at {formatDateTime}."; finished → "Your test wallet is ready."
- `AccountMenu`: address (copyable), QOR and fUSD balances (`Amount size="sm"`), "Back up phrase" (password re-entry → `BackupPhrase`), "Owner console" link (only when QoreX is connected), `ThemeSwitch` (Light/Dark/System — replaces the Plan 3a theme button inside the menu; keep the top-bar `ThemeButton` as the design shows), "Lock", "Disconnect QoreX".
- `ChainAction` renders the lifecycle states with the design's copy; refused → the mapped vault error sentence; done → `TxLink`.
- [ ] **Step 1: Tests (RED):** create flow encrypts and starts setup (mock keystore + steps); unlock with a wrong password shows the field error under the field; forget asks for confirmation first; QoreX not installed and wrong network render their states; AccountMenu shows Owner console only with QoreX; `ChainAction` renders each state and a refused reason.
- [ ] **Step 2: Implement** from the frames (read them read-only with the Pencil MCP; UI copy from the frames). GREEN; four checks.
- [ ] **Step 3: Browser:** create a wallet, run the whole setup against testnet in Chrome (faucet → done), lock, unlock, reload (stays locked), forget. 390/834/1440, light/dark. Record the wallet's tx hashes in the report. Commit `feat(fe): connect, account menu and test-wallet setup`.

---

### Task 7: Lend sheet and My lending

**Design frames:** Lend band: Enter amount `LLqYn` (`fcNEB`, `NZf61`, `EN12J`), Amount too high `cAGnu`, Waiting for the wallet `p9lhD`, Raise is full `tEleT`; components `LendDialog` `yiMP8`, `LendSheet` `FUDu5`. My lending band: Normal `cvg3c` (`JPTvn`, `x2xNz2`, `Khg3N`), Empty `KGR2g`, Not connected `Q0pkyH`, Loading `rS9Tu`; `Card/Position` `w8W9J`, `Table/Positions/*` `j217qY` `U1EqUs`.

**Files:**
- Create: `apps/fe/src/modules/lend/api/{lend.api.ts,lend.keys.ts,useLend.ts}`, `apps/fe/src/modules/lend/components/{LendSheet,LendForm,PositionsPage,PositionList,ClaimButton,RefundButton}.tsx`, `apps/fe/src/modules/lend/index.ts`, `apps/fe/app/lend/page.tsx`
- Modify: `apps/fe/src/modules/business/components/BusinessPage.tsx` (Lend button opens `LendSheet` when the vault is Raising; sticky primary action on phone)
- Test: `apps/fe/src/test/modules/lend/**`

**Interfaces (produced):**
```ts
export type Position = { business: Business; vault: VaultSnapshot; deposit: bigint; claimable: bigint; claimed: bigint };
export function readPositions(evm: `0x${string}`, businesses: Business[]): Promise<Position[]>; // deposits/lenderClaimable/lenderClaimed per vault; only deposit > 0
export function lend(session, vault, amount): Promise<{ approveTx?: `0x${string}`; depositTx: `0x${string}` }>; // planLend → ensureWindowFor([FUSD, vault]) → approve if needed → deposit
export function claim(session, vault): Promise<`0x${string}`>;
export function refund(session, vault): Promise<`0x${string}`>;
```
Rules: the amount field validates against the wallet's fUSD and the room left (`target - raised`); "Amount too high" and "Raise is full" states as designed; deposit/claim/refund go through `ConfirmDialog` then `ChainAction`; after success invalidate market + positions queries and toast. Not connected → the designed state with a Connect button. Refund shows only for Refunded vaults; Claim only when `claimable > 0`.
- [ ] **Step 1: Tests (RED)** for `readPositions` (filters zero deposits, maps reads), `lend` (calls window, approve only when allowance < amount, deposit), the form validation (too high, raise full), and page states (not connected, empty, loading, list).
- [ ] **Step 2: Implement**; GREEN; checks.
- [ ] **Step 3: Browser:** lend 1 fUSD to the Raising business (Contract Auditor) from the test wallet; see it on `/lend`; record tx hashes. Commit `feat(fe): lend to a raising business and track positions`.

---

### Task 8: New order (sealed request + buy)

**Design frames:** New order band: Ready `Oxeor` (`ceOnI`, `p7fus`, `n6G61`), First time `Xmrbh`, Sealing and paying `cwFyS`, Invalid address `Hu4xR`, Order placed `f5Ksn`.

**Files:**
- Create: `apps/fe/src/modules/orders/api/{orders.api.ts,useOrders.ts}`, `apps/fe/src/modules/orders/components/{NewOrderPage,OrderForm,OrderProgress}.tsx`, `apps/fe/src/modules/orders/schemas/order.schema.ts`, `apps/fe/src/modules/orders/index.ts`, `apps/fe/app/shop/[slug]/page.tsx`
- Modify: `BusinessPage.tsx` ("Buy a report" action → `/shop/{slug}` for Active/Trapped/Repaid vaults)
- Test: `apps/fe/src/test/modules/orders/**`

**Interfaces (produced):**
```ts
export const orderInputSchema; // per service: Counterparty/Sanctions take a qor1 or 0x address (Counterparty pre-fills the buyer's own address — spec "check your own address"); Due Diligence/Auditor take a 0x contract/token address; max MAX_INPUT chars
export type PlaceOrderProgress = "sealing" | "posting" | "window" | "approving" | "buying" | "placed";
export function placeOrder(session, business: Business, serviceId: number, input: string, onProgress: (p: PlaceOrderProgress) => void): Promise<{ orderId: string; buyTx: `0x${string}` }>;
// resolve recipient (spender) → sealRequest → POST /v1/envelopes (kind "request") → compare returned hash with envelopeHash(text) → ensureWindowFor([FUSD, vault]) → approve(price) if needed → buy(serviceId, hash) → decode OrderPlaced
```
Rules: the request is sealed **in the browser**; the page shows the price read from `servicePrice` (never the API's copy); a setup that is not finished shows the "First time" state with `WalletSetup`; spender without a KEM key → an error state ("This business cannot receive sealed requests right now."), not a crash; placed → link to the report page and the inbox.
- [ ] **Step 1: Tests (RED):** input schema per service (valid/invalid address, length); `placeOrder` with mocked qore/api/signer — order of calls, hash mismatch aborts before paying, approve skipped when allowance suffices, OrderPlaced decoded; page states (first time, invalid input under the field, progress, placed).
- [ ] **Step 2: Implement**; GREEN; checks.
- [ ] **Step 3: Browser:** buy a Counterparty Check of the test wallet's own address on testnet; wait for delivery (the hosted agent delivers within minutes); record tx hashes and the order id. Commit `feat(fe): sealed orders placed from the browser`.

---

### Task 9: Inbox and report

**Design frames:** Inbox band: Normal `UnR9h` (`w0rIp6`, `RtOda`, `lwy4k`), Empty `WsYms`, Not connected `oPDIc`, Loading `XxYP7`; `Table/Inbox/*` `dSFGN` `t5gJ7b`, `Card/InboxOrder` `d8XPvl`. Report band: Opened `LQv7S`, Sealed `E51H5x`, Opening `OWQaK`, Does not match `Kc4ng`.

**Files:**
- Create: `apps/fe/src/modules/inbox/api/{inbox.api.ts,useInbox.ts}`, `apps/fe/src/modules/inbox/components/{InboxPage,InboxList,ReportPage,ReportView,ReclaimButton}.tsx`, `apps/fe/src/modules/inbox/schemas/report.schema.ts`, `apps/fe/src/modules/inbox/index.ts`, `apps/fe/app/inbox/page.tsx`, `apps/fe/app/inbox/[vault]/[orderId]/page.tsx`
- Test: `apps/fe/src/test/modules/inbox/**`

**Interfaces (produced):**
```ts
export function readMyOrders(evm: `0x${string}`, businesses: Business[]): Promise<(Order & { business: Business })[]>; // GET /v1/orders per vault, filter buyer (lowercase), newest first
export type OpenedReport = { report: unknown; envelopeHash: `0x${string}`; deliveredTx: `0x${string}` };
export function openMyReport(session, vault: `0x${string}`, orderId: string): Promise<OpenedReport>;
// 1. read the Delivered log for orderId from chain (getLogs on the vault, event Delivered, args orderId) → envelopeHash + tx
// 2. GET /v1/envelopes/{hash}; 3. envelopeHash(body) must equal the on-chain hash else throw ReportDoesNotMatch
// 4. openReport({ text, vault, orderId, keys: session.sealKeys }) (throws ReportUnreadable for an outsider)
export function reclaim(session, vault, orderId): Promise<`0x${string}`>;
```
Rules: the report renders through a zod schema per service (the shape the engine writes — read `engine/src/services/*` report types), unknown fields shown as a plain definition list, never raw JSON dumps of keys; "Does not match" state when the hash differs; a late open order (deadline passed) shows "Reclaim" behind `ConfirmDialog`; statuses use `OrderStatusBadge`; the inbox needs the test wallet (QoreX alone shows "Not connected" because it cannot open reports — say so).
- [ ] **Step 1: Tests (RED):** `readMyOrders` filtering; `openMyReport` happy path, hash mismatch → ReportDoesNotMatch, wrong keys → ReportUnreadable (use qore `sealReport`-equivalent fixture built in the test with a generated key pair); page states (sealed, opening, opened, does not match, not connected, empty).
- [ ] **Step 2: Implement**; GREEN; checks.
- [ ] **Step 3: Browser:** open the report from Task 8's order; see "Does not match" by tampering the envelope fetch in a test only (not live). Commit `feat(fe): inbox and reports opened in the browser`.

---

### Task 10: Owner console

**Design frames:** Owner band: Write an order `ZineO` (`G3iwZz`, `XqD4I`, `MyXbz`), Signing `f1Fid5`, Applied `ZLjur`, Refused `Somz9`, Not an owner `Ne0og`.

**Files:**
- Create: `apps/fe/src/modules/owner/api/{owner.api.ts,useOwner.ts}`, `apps/fe/src/modules/owner/components/{OwnerPage,PolicyOrderForm,OrderSignature}.tsx`, `apps/fe/src/modules/owner/schemas/policyOrder.schema.ts`, `apps/fe/src/modules/owner/index.ts`, `apps/fe/app/owner/page.tsx`
- Test: `apps/fe/src/test/modules/owner/**`

**Interfaces (produced):**
```ts
export const POLICY_KINDS = ["RemoveSupplier","LowerSupplierCap","LowerDailyCap","Pause","Unpause","AddSupplier","RaiseSupplierCap","RaiseDailyCap"] as const; // index = uint8 kind
export const policyOrderSchema; // kind, target (0x, required for supplier kinds), value (fUSD units, required for cap kinds), expiry (minutes from now, 5..1440)
export type PolicyOrder = { kind: number; target: `0x${string}`; value: bigint; nonce: bigint; expiry: bigint };
export function ownedVaults(ownerEvm: `0x${string}`, businesses: Business[]): Promise<Business[]>; // vault.ownerPq() === owner
export function buildOrder(vault, input): Promise<{ order: PolicyOrder; text: string }>;            // nonce = policyNonce(); text = hexToString(orderText(order))
export function simulateApply(vault, order, sig): Promise<{ ok: true } | { ok: false; reason: string }>; // eth_call applyOrder, decoded error
export function applyOrder(session, vault, order, sig): Promise<`0x${string}`>;                    // sent by the test wallet (any sender may submit)
```
Rules: needs QoreX connected (the owner's ML-DSA key is in QoreX); a QoreX account that owns no vault → "Not an owner"; signing uses `signArbitrary(address, text)`; a second path "Paste a signature made with the owner CLI" accepts a hex/base64 signature; before sending, `simulateApply` — a refusal (e.g. `WideningLocked`, `BadNonce`, `BadPqcSignature`) shows the Refused state with the mapped sentence and **does not send**; applying needs the test wallet unlocked (to pay gas) — otherwise explain and offer Connect; widening kinds show a note that they are refused until the loan is repaid.
- [ ] **Step 1: Tests (RED):** schema per kind; `buildOrder` reads nonce and text; simulate refusal stops before send; ownedVaults filter; page states.
- [ ] **Step 2: Implement**; GREEN; checks.
- [ ] **Step 3: Browser (needs the user):** the controller asks the user to connect their QoreX owner account; apply a narrowing order (e.g. LowerDailyCap by 1 unit on a vault they own) and try a widening one (expect Refused/WideningLocked, not sent). If the user's QoreX account owns no vault, record "Not an owner" verified and skip the apply. Commit `feat(fe): owner console with signed policy orders`.

---

### Task 11: Sweep, docs and deploy preparation

**Files:** any `apps/fe` file that fails a check; `apps/fe/README.md`, `apps/fe/CLAUDE.md`

- [ ] **Step 1:** Repeat Plan 3a Task 9's sweep for the new routes (`/lend`, `/shop/[slug]`, `/inbox`, `/inbox/[vault]/[orderId]`, `/owner`) and the Connect/Account overlays: 390/834/1440 × light/dark, keyboard (dialogs trap focus and return it), 44 px coarse targets, contrast, no hydration warnings, shimmer skeletons, `StaleNotice` where data refreshes.
- [ ] **Step 2:** Security pass: grep the client bundle (`.next/static`) for any env value that is not `NEXT_PUBLIC_*`; confirm no phrase/private key reaches `console`, a URL, `fetch` body to anything but the wallet's own signed tx; `localStorage` holds only `qredit.testWallet.v1` (encrypted) and UI preferences.
- [ ] **Step 3:** README: wallet section (throwaway testnet wallet, where it is stored, how to back up / forget), QoreX section (testnet switch), the proxies, env names. Commit fixes and docs.
- [ ] **Step 4: Stop and ask the user** before deploying to Vercel (outward-facing; needs their account and the Hostinger DNS record). The settings are in `apps/fe/README.md` (Plan 3a Task 9).

## Out of scope

- **Running and recording the eight unrecorded attacks** (Proof page) — a separate plan, because it runs engine scripts with the owner's keys and records evidence; it must be done before submission.
- Landing page (Plan 3c), including the scroll-velocity carousel.
- Sales reports and lender-only sealed documents (spec stretch).
