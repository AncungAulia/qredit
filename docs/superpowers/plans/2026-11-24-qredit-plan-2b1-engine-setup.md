# Qredit Plan 2b-1: Shared chain package, owner CLI, live businesses — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract the chain helpers into a shared package, build the owner CLI in `engine/`, create the production accounts and the four agent businesses on testnet (vaults, linked agent keys, operator windows), fund three loans, and run the simulated suppliers that the agents will pay.

**Architecture:** A Bun workspace adds `packages/qore` (network, keys, hybrid broadcast, MsgConvertCoin, ABIs, addresses, envelope hash), used by both `apps/be` and `engine`. `engine/` gets an owner CLI (`bun src/cli/owner.ts <command>`) whose commands are thin wrappers over small, tested setup functions; public business parameters live in `engine/businesses.json`, deployed addresses in `engine/deployments.json`, keys in gitignored `engine/.keys/`. Suppliers are one Hono app that returns data only after it sees its `SupplierPaid` event on chain.

**Tech Stack:** Bun 1.3 workspaces, TypeScript, viem 2, @qorechain/sdk 0.14.0, @qorechain/evm 0.14.0, cosmjs-types 0.11.0, @scure/base 2.4.0, @noble/curves 1.9, Hono 4.6, zod 3.24.

**Spec:** `docs/superpowers/specs/2026-11-24-qredit-design.md` (sections 5–7, 14). Proven patterns: `engine/spikes/src/{s1-authenticator,s5-fusd,erc20,lib}.ts`, `engine/spikes/RESULTS.md`.

## Global Constraints

- Testnet `qorechain-diana`; REST `https://api-testnet.qore.host`; RPC `https://rpc-testnet.qore.host`; EVM RPC `https://evm-testnet.qore.host`; EVM chain id 9800.
- VaultFactory `0xAc5324088A7735dda922c277db5A2E906c8f5b3A`. fUSD ERC-20 `0x97143B771D34ddb9130b807b135Ae675A5a963CA`, 6 decimals; bank denom `erc20:0x97143B771D34ddb9130b807b135Ae675A5a963CA`. `MsgConvertCoin` needs the custom type from `engine/spikes/src/erc20.ts`.
- Vault owner (`ownerPq`, `ownerPayout`) for all four businesses: the human's QoreX account, configured as `OWNER_ADDRESS` (0x) in `engine/.env` — never hard-coded.
- Agent key: ed25519, linked to the business's spender account with permissions `["evm"]`, expiry 30 days, spending rule `{ id: "agent", enabled: true, perTxLimit: "1000000", dailyLimit: "5000000", allowedDenoms: ["uqor"], allowedEvmCalls: ["<vault lowercase>/<paySupplier selector>"] }` (spike S1 pattern).
- Operator window: `allowedTargets = [vault]`, 17,280 blocks, `maxTxs` 500, `maxValue` 25,000,000 uqor; opened by the operator's own hybrid tx. Treasury window: `allowedTargets = [factory, fUSD, every vault]` (≤ 16).
- Wait for `txEvents(hash)` (or an EVM receipt) before the next send from the same account. Wait ~10 s after opening a window before its first EVM tx.
- Secrets: key files only in `engine/.keys/` (gitignored, files written with flag `wx`); `.env` files gitignored; commands never print private keys, mnemonics or recovery codes. Addresses and tx hashes are public.
- Engineering standards: SOLID, DRY (one chain package), ACID where state changes in steps, idempotent commands (re-running skips what exists), small reusable typed functions, tests for every pure function.
- Pin versions; English only; no durations or schedules in committed files. Commits: one per task, scopes `qore`, `engine`, `be`; bodies end `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## File Structure

```
package.json                     workspace root (private): workspaces apps/be, engine, packages/*
bun.lock                         single workspace lockfile (replaces apps/be/bun.lock)
packages/qore/
  package.json, tsconfig.json
  src/index.ts                   re-exports
  src/net.ts                     Net, TESTNET, viem chain, public/wallet clients
  src/keys.ts                    KeySpec, parseKeySpec, parseKeyList, accountFrom   (moved from apps/be/src/chain/keys.ts)
  src/tx.ts                      broadcastHybrid (+registry option), txEvents, executionFailure, serial, BroadcastRefused, TxUnconfirmed   (moved from apps/be/src/chain/tx.ts)
  src/erc20.ts                   MsgConvertCoin type, convertCoinMsg, qoreRegistry   (from engine/spikes/src/erc20.ts)
  src/abi.ts                     VAULT_ABI, VAULT_EVENTS, FACTORY_ABI, ERC20_ABI, PAY_SUPPLIER_SELECTOR, addresses   (vault.ts moved + extended)
  src/address.ts                 qorToHex, hexToQor   (moved from apps/be/src/chain/address.ts)
  src/hash.ts                    envelopeHash   (moved from apps/be/src/lib/hash.ts)
  test/*.test.ts                 moved chain tests + new ones
engine/
  package.json, tsconfig.json, CLAUDE.md, .env.example
  businesses.json                public business parameters (committed)
  deployments.json               deployed addresses and blocks (committed, written by the CLI)
  src/config.ts                  env parsing
  src/keystore.ts                engine/.keys JSON files
  src/setup/businesses.ts        businesses.json schema, vault Init builder
  src/setup/accounts.ts          production account set
  src/setup/chain.ts             fund, convert, window, link, create vault, lend (thin chain calls)
  src/setup/deployments.ts       deployments.json read/write
  src/cli/owner.ts               command router
  src/suppliers/app.ts           supplier HTTP app (payment-gated data)
  src/suppliers/server.ts        Bun.serve entry
  test/*.test.ts
```

---

### Task 1: Bun workspace and `packages/qore`

**Files:**
- Create: `package.json` (root), `packages/qore/package.json`, `packages/qore/tsconfig.json`, `packages/qore/src/{index,net,erc20,abi}.ts`, `packages/qore/test/abi.test.ts`
- Move (git mv): `apps/be/src/chain/keys.ts` → `packages/qore/src/keys.ts`; `apps/be/src/chain/tx.ts` → `packages/qore/src/tx.ts`; `apps/be/src/chain/address.ts` → `packages/qore/src/address.ts`; `apps/be/src/lib/hash.ts` → `packages/qore/src/hash.ts`; `apps/be/src/chain/vault.ts` → `packages/qore/src/abi.ts`; `apps/be/test/chain/chain.test.ts` → `packages/qore/test/chain.test.ts`
- Modify: every `apps/be` import of the moved modules → `@qredit/qore`; `apps/be/package.json` (add `"@qredit/qore": "workspace:*"`, drop deps now only used by qore if unused)
- Delete: `apps/be/bun.lock` (replaced by the root lockfile)

**Interfaces:**
- Produces (`@qredit/qore`): everything the moved files exported, unchanged names, plus:
  - `net.ts`: `type Net = { chainId: string; rest: string; rpc: string }`; `TESTNET: Net & { evm: string }`; `qoreChain(evm: string)` (viem `Chain`, id 9800); `publicClientFor(evm: string): PublicClient`; `walletFor(privateKey: \`0x${string}\`, evm: string): WalletClient`
  - `tx.ts`: `broadcastHybrid(net, acc, messages, opts?: { memo?; gas?; feeUqor?; registry?: Registry })`
  - `erc20.ts`: `MSG_CONVERT_COIN`, `MsgConvertCoinType`, `convertCoinMsg(senderQor: string, receiverHex: string, units: bigint): EncodeObject`, `qoreRegistry(): Registry`
  - `abi.ts`: `FACTORY_ADDRESS`, `FUSD_ADDRESS`, `FUSD_DENOM`, `VAULT_EVENTS` (now also `SupplierPaid`), `VAULT_ABI` (functions below), `FACTORY_ABI`, `ERC20_ABI`, `PAY_SUPPLIER_SELECTOR`

- [ ] **Step 1: Create the root `package.json`**

```json
{
  "name": "qredit",
  "private": true,
  "workspaces": ["apps/be", "engine", "packages/*"],
  "scripts": {
    "test": "bun --filter '*' test",
    "typecheck": "bun --filter '*' typecheck"
  }
}
```

- [ ] **Step 2: Create `packages/qore/package.json` and `tsconfig.json`**

```json
{
  "name": "@qredit/qore",
  "private": true,
  "type": "module",
  "main": "src/index.ts",
  "types": "src/index.ts",
  "scripts": { "test": "bun test", "typecheck": "tsc --noEmit" }
}
```

`packages/qore/tsconfig.json` is identical to `apps/be/tsconfig.json`.

Run (repo root): `rm apps/be/bun.lock && cd packages/qore && bun add @qorechain/sdk@0.14.0 @qorechain/evm@0.14.0 @cosmjs/stargate@0.39 @cosmjs/proto-signing@0.39 cosmjs-types@0.11.0 viem@2 @scure/base@2.4.0 && bun add -d typescript@5 @types/bun && cd ../.. && bun install`
Expected: one `bun.lock` at the root; `node_modules/@qredit/qore` links to `packages/qore`.

- [ ] **Step 3: Move the shared modules with `git mv`** (paths in Files above), then create `packages/qore/src/erc20.ts` with the exact content of `engine/spikes/src/erc20.ts` plus:

```ts
import type { EncodeObject, Registry } from "@cosmjs/proto-signing";
import { qorechainRegistry } from "@qorechain/sdk";

/** Bank coin → ERC-20 for the same account (hybrid-signed by the sender). */
export function convertCoinMsg(senderQor: string, receiverHex: string, units: bigint): EncodeObject {
  return {
    typeUrl: MSG_CONVERT_COIN,
    value: { coin: { denom: "erc20:0x97143B771D34ddb9130b807b135Ae675A5a963CA", amount: units.toString() }, receiver: receiverHex, sender: senderQor },
  };
}

/** The SDK registry plus the types the SDK does not ship. */
export const qoreRegistry = (): Registry => qorechainRegistry([[MSG_CONVERT_COIN, MsgConvertCoinType]]);
```

In `tx.ts`, add `registry?: Registry` to `broadcastHybrid`'s `opts` and pass it to `new EthNativeSigner(acc, { signMode: "hybrid", rest: net.rest, registry: opts.registry })` (the spike did exactly this).

- [ ] **Step 4: Write `packages/qore/src/abi.ts`** (replaces the moved `vault.ts` content; keep `VAULT_EVENTS` and `PAY_SUPPLIER_SELECTOR` exactly, add the rest):

```ts
import { parseAbi, toFunctionSelector } from "viem";

export const FACTORY_ADDRESS = "0xAc5324088A7735dda922c277db5A2E906c8f5b3A" as const;
export const FUSD_ADDRESS = "0x97143B771D34ddb9130b807b135Ae675A5a963CA" as const;
export const FUSD_DENOM = "erc20:0x97143B771D34ddb9130b807b135Ae675A5a963CA";

export const VAULT_EVENTS = parseAbi([
  "event OrderPlaced(uint256 indexed orderId, address indexed buyer, uint256 serviceId, uint256 price, bytes32 requestRef, uint256 deadline)",
  "event Delivered(uint256 indexed orderId, bytes32 envelopeHash, uint256 toLenders, uint256 toOwner, uint256 toOpex)",
  "event Declined(uint256 indexed orderId, uint8 reasonCode)",
  "event Reclaimed(uint256 indexed orderId)",
]);

export const SUPPLIER_PAID_EVENT = parseAbi(["event SupplierPaid(address indexed supplier, uint256 amount, uint256 indexed orderId)"]);

export const VAULT_ABI = parseAbi([
  "struct LoanTerms { uint256 target; uint256 totalOwed; uint64 raiseDeadline; uint64 period; uint64 grace; uint256 installment; }",
  "struct Init { address token; address spender; address operator; address ownerPq; address ownerPayout; string cosmosChainId; uint16 lenderBps; uint16 ownerBps; uint256 dailyCap; uint64 orderTtl; LoanTerms loan; address[] suppliers; uint256[] supplierCaps; uint256[] servicePrices; }",
  "function deposit(uint256 amount)",
  "function buy(uint256 serviceId, bytes32 requestRef) returns (uint256)",
  "function deliver(uint256 orderId, bytes32 envelopeHash)",
  "function decline(uint256 orderId, uint8 reasonCode)",
  "function paySupplier(address supplier, uint256 amount, uint256 orderId)",
  "function claimLender()",
  "function state() view returns (uint8)",
  "function raised() view returns (uint256)",
  "function repaid() view returns (uint256)",
  "function opexBalance() view returns (uint256)",
  "function servicePrice(uint256 serviceId) view returns (uint256)",
  "function serviceCount() view returns (uint256)",
  "function spender() view returns (address)",
  "function operator() view returns (address)",
  "function ownerPq() view returns (address)",
]);

export const FACTORY_ABI = parseAbi([
  "struct LoanTerms { uint256 target; uint256 totalOwed; uint64 raiseDeadline; uint64 period; uint64 grace; uint256 installment; }",
  "struct Init { address token; address spender; address operator; address ownerPq; address ownerPayout; string cosmosChainId; uint16 lenderBps; uint16 ownerBps; uint256 dailyCap; uint64 orderTtl; LoanTerms loan; address[] suppliers; uint256[] supplierCaps; uint256[] servicePrices; }",
  "function create(Init init) returns (address)",
  "function count() view returns (uint256)",
  "event VaultCreated(address indexed vault, address indexed ownerPq, address spender, address operator, uint256 index)",
]);

export const ERC20_ABI = parseAbi([
  "function approve(address spender, uint256 amount) returns (bool)",
  "function transfer(address to, uint256 amount) returns (bool)",
  "function balanceOf(address owner) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
]);

export const PAY_SUPPLIER_SELECTOR = toFunctionSelector("paySupplier(address,uint256,uint256)");
```

- [ ] **Step 5: Write `packages/qore/src/net.ts` and `index.ts`**

```ts
// net.ts
import { createPublicClient, createWalletClient, defineChain, http, type PublicClient, type WalletClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";

export type Net = { chainId: string; rest: string; rpc: string };

export const TESTNET: Net & { evm: string } = {
  chainId: "qorechain-diana",
  rest: "https://api-testnet.qore.host",
  rpc: "https://rpc-testnet.qore.host",
  evm: "https://evm-testnet.qore.host",
};

export const qoreChain = (evm: string) =>
  defineChain({ id: 9800, name: "QoreChain testnet (diana)", nativeCurrency: { name: "QOR", symbol: "QOR", decimals: 18 }, rpcUrls: { default: { http: [evm] } } });

export const publicClientFor = (evm: string): PublicClient => createPublicClient({ chain: qoreChain(evm), transport: http(evm) }) as PublicClient;

export const walletFor = (privateKey: `0x${string}`, evm: string): WalletClient =>
  createWalletClient({ account: privateKeyToAccount(privateKey), chain: qoreChain(evm), transport: http(evm) });
```

```ts
// index.ts
export * from "./abi.ts";
export * from "./address.ts";
export * from "./erc20.ts";
export * from "./hash.ts";
export * from "./keys.ts";
export * from "./net.ts";
export * from "./tx.ts";
```

If `tx.ts` declared its own `Net` type, remove it there and import it from `net.ts` (one definition).

- [ ] **Step 6: Write `packages/qore/test/abi.test.ts`**

```ts
import { describe, expect, test } from "bun:test";
import { encodeFunctionData } from "viem";
import { convertCoinMsg, FACTORY_ABI, FUSD_DENOM, MsgConvertCoinType, PAY_SUPPLIER_SELECTOR, qoreRegistry, VAULT_ABI } from "../src/index.ts";

describe("abi", () => {
  test("paySupplier calldata starts with the selector and is 100 bytes", () => {
    const data = encodeFunctionData({ abi: VAULT_ABI, functionName: "paySupplier", args: ["0x00000000000000000000000000000000000000cc", 1n, 2n] });
    expect(data.slice(0, 10)).toBe(PAY_SUPPLIER_SELECTOR);
    expect((data.length - 2) / 2).toBe(100);
  });
  test("factory create encodes an Init tuple", () => {
    const data = encodeFunctionData({ abi: FACTORY_ABI, functionName: "create", args: [{
      token: "0x97143B771D34ddb9130b807b135Ae675A5a963CA", spender: "0x0000000000000000000000000000000000000001", operator: "0x0000000000000000000000000000000000000002",
      ownerPq: "0x0000000000000000000000000000000000000003", ownerPayout: "0x0000000000000000000000000000000000000003", cosmosChainId: "qorechain-diana",
      lenderBps: 3000, ownerBps: 2000, dailyCap: 1n, orderTtl: 3600n,
      loan: { target: 1n, totalOwed: 1n, raiseDeadline: 2n, period: 1n, grace: 0n, installment: 1n },
      suppliers: [], supplierCaps: [], servicePrices: [1n],
    }] });
    expect(data.startsWith("0x")).toBe(true);
  });
});

describe("MsgConvertCoin", () => {
  test("round-trips through the registry", () => {
    const msg = convertCoinMsg("qor1sender", "0x00000000000000000000000000000000000000aa", 300_000_000n);
    expect(msg.value.coin.denom).toBe(FUSD_DENOM);
    const bytes = MsgConvertCoinType.encode(MsgConvertCoinType.fromPartial(msg.value)).finish();
    expect(MsgConvertCoinType.decode(bytes)).toEqual({ coin: { denom: FUSD_DENOM, amount: "300000000" }, receiver: "0x00000000000000000000000000000000000000aa", sender: "qor1sender" });
    expect(qoreRegistry().lookupType("/cosmos.evm.erc20.v1.MsgConvertCoin")).toBeDefined();
  });
});
```

- [ ] **Step 7: Repoint `apps/be` and verify both packages**

Replace imports in `apps/be` of `../chain/*`, `../../chain/*`, `../lib/hash.ts` etc. with `@qredit/qore` (keep `apps/be/src/chain/` empty → delete the folder). Add `"@qredit/qore": "workspace:*"` to `apps/be/package.json` dependencies and `bun install` at the root.

Run (root): `cd packages/qore && bun test && bun run typecheck && cd ../../apps/be && bun test && bun run typecheck`
Expected: qore — moved chain tests + 3 new pass; apps/be — 94 − (moved chain tests) pass, 0 fail; both typechecks clean.

- [ ] **Step 8: Commit**

```bash
git add package.json bun.lock packages/qore apps/be
git commit -m "refactor(qore): share chain helpers between the backend and the engine"
```

---

### Task 2: Engine scaffold, config, keystore and business parameters

**Files:**
- Create: `engine/package.json`, `engine/tsconfig.json`, `engine/CLAUDE.md`, `engine/.env.example`, `engine/businesses.json`, `engine/src/config.ts`, `engine/src/keystore.ts`, `engine/src/setup/businesses.ts`, `engine/test/keystore.test.ts`, `engine/test/businesses.test.ts`
- Modify: `.gitignore` (add `engine/.keys/`)

**Interfaces:**
- Produces:
  - `loadEngineConfig(env?): EngineConfig` with `OWNER_ADDRESS` (0x, required), `API_URL` (default `http://localhost:8787`), `ENGINE_TOKEN` (min 32, required for API calls), `GEMINI_API_KEY` (optional here), `KEYS_DIR` (default `<engine>/.keys`)
  - `keystore(dir)`: `{ has(name): boolean; read(name): Record<string,string>; write(name, data): void /* flag wx */; list(): string[] }`
  - `type BusinessParams` (zod-inferred from `businesses.json`), `loadBusinesses(path?): BusinessParams[]`, `vaultInit(b: BusinessParams, roles: { spender; operator; ownerPq; suppliers: Record<SupplierRole, \`0x${string}\`> }, nowSeconds: number)` → the `Init` object for `FACTORY_ABI.create`

- [ ] **Step 1: Scaffold**

`engine/package.json`:
```json
{
  "name": "@qredit/engine",
  "private": true,
  "type": "module",
  "scripts": {
    "owner": "bun --env-file=.env src/cli/owner.ts",
    "suppliers": "bun --env-file=.env src/suppliers/server.ts",
    "test": "bun test",
    "typecheck": "tsc --noEmit"
  }
}
```
Run (in `engine/`): `bun add @qredit/qore@workspace:* hono@4.6 zod@3.24 viem@2 @qorechain/sdk@0.14.0 @qorechain/evm@0.14.0 @noble/curves@1.9 && bun add -d typescript@5 @types/bun` (root lockfile updates). `engine/tsconfig.json` = `apps/be/tsconfig.json`. The existing `engine/spikes/` keeps its own `package.json` and is not part of the workspace.

Append to `.gitignore`: `engine/.keys/`.

`engine/.env.example`:
```dotenv
# The vault owner: your QoreX account's 0x address (its ML-DSA-87 key signs policy orders).
OWNER_ADDRESS=
# Backend API and the shared engine token (same value as apps/be/.env ENGINE_TOKEN).
API_URL=http://localhost:8787
ENGINE_TOKEN=
# LLM for the agents (Plan 2b-2).
GEMINI_API_KEY=
```

`engine/CLAUDE.md`:
```markdown
# CLAUDE.md — engine

Qredit's agents, simulated suppliers and the owner CLI. Bun; shared chain code comes from `@qredit/qore`.

- Owner CLI: `bun run owner <command>` (see `src/cli/owner.ts` usage). Commands are idempotent: re-running skips what already exists.
- Keys live in `engine/.keys/` (gitignored); files are created with flag `wx` and never printed. `businesses.json` (public parameters) and `deployments.json` (public addresses) are committed.
- The engine holds only agent keys, operator classical keys and supplier addresses; it never holds the relayer or treasury keys at runtime (the owner CLI uses the treasury only during setup).
- Tests: `bun test` (offline). Chain-touching commands are exercised live, never in unit tests.
- `spikes/` is the earlier testnet spike toolkit; it is not part of the workspace.
```

- [ ] **Step 2: Write `engine/businesses.json`** (amounts in fUSD base units, 6 decimals; periods in seconds)

```json
{
  "suppliers": {
    "dataIndexer": { "name": "Data Indexer", "priceUnits": "50000" },
    "listOracle": { "name": "List Oracle", "priceUnits": "100000" },
    "computeBasic": { "name": "Compute Basic", "priceUnits": "500000" },
    "computeDeep": { "name": "Compute Deep", "priceUnits": "1500000" }
  },
  "businesses": [
    {
      "slug": "counterparty-check",
      "name": "Counterparty Check",
      "tagline": "Is it safe to pay this address? A Q-Day-aware risk grade, sealed to you.",
      "services": [{ "id": 0, "name": "Counterparty risk grade", "priceUnits": "250000" }],
      "suppliers": [{ "role": "dataIndexer", "capUnits": "200000" }],
      "split": { "lenderBps": 3000, "ownerBps": 2000 },
      "dailyCapUnits": "20000000",
      "orderTtlSeconds": 3600,
      "loan": { "targetUnits": "50000000", "totalOwedUnits": "55000000", "raiseSeconds": 1209600, "periodSeconds": 86400, "graceSeconds": 86400, "installmentUnits": "1000000" },
      "demoState": "active"
    },
    {
      "slug": "sanctions-screen",
      "name": "Sanctions Screen",
      "tagline": "Screen an address against a sanctions list before you deal with it.",
      "services": [{ "id": 0, "name": "Sanctions screen", "priceUnits": "500000" }],
      "suppliers": [{ "role": "listOracle", "capUnits": "300000" }],
      "split": { "lenderBps": 8000, "ownerBps": 1000 },
      "dailyCapUnits": "10000000",
      "orderTtlSeconds": 3600,
      "loan": { "targetUnits": "2000000", "totalOwedUnits": "2200000", "raiseSeconds": 1209600, "periodSeconds": 86400, "graceSeconds": 86400, "installmentUnits": "500000" },
      "demoState": "repaid"
    },
    {
      "slug": "due-diligence",
      "name": "Due Diligence",
      "tagline": "A cited risk report on a token or contract before you trade it.",
      "services": [{ "id": 0, "name": "Due diligence report", "priceUnits": "3000000" }],
      "suppliers": [{ "role": "dataIndexer", "capUnits": "200000" }, { "role": "computeBasic", "capUnits": "1000000" }, { "role": "computeDeep", "capUnits": "2000000" }],
      "split": { "lenderBps": 3000, "ownerBps": 2000 },
      "dailyCapUnits": "15000000",
      "orderTtlSeconds": 3600,
      "loan": { "targetUnits": "20000000", "totalOwedUnits": "22000000", "raiseSeconds": 1209600, "periodSeconds": 3600, "graceSeconds": 0, "installmentUnits": "1000000" },
      "demoState": "trapped"
    },
    {
      "slug": "contract-auditor",
      "name": "Contract Auditor",
      "tagline": "Finds ECDSA dependencies and post-quantum gaps in a contract, sealed to its owner.",
      "services": [{ "id": 0, "name": "Contract audit", "priceUnits": "5000000" }],
      "suppliers": [{ "role": "computeBasic", "capUnits": "1000000" }, { "role": "computeDeep", "capUnits": "2000000" }],
      "split": { "lenderBps": 3000, "ownerBps": 2000 },
      "dailyCapUnits": "20000000",
      "orderTtlSeconds": 7200,
      "loan": { "targetUnits": "100000000", "totalOwedUnits": "110000000", "raiseSeconds": 1209600, "periodSeconds": 86400, "graceSeconds": 86400, "installmentUnits": "5000000" },
      "demoState": "raising"
    }
  ]
}
```

- [ ] **Step 3: Write the failing tests**

`engine/test/keystore.test.ts`:
```ts
import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { keystore } from "../src/keystore.ts";

describe("keystore", () => {
  test("writes once, reads back, lists", () => {
    const ks = keystore(mkdtempSync(join(tmpdir(), "qredit-keys-")));
    expect(ks.has("relayer")).toBe(false);
    ks.write("relayer", { mnemonic: "a b c" });
    expect(ks.has("relayer")).toBe(true);
    expect(ks.read("relayer")).toEqual({ mnemonic: "a b c" });
    expect(() => ks.write("relayer", { mnemonic: "x" })).toThrow();
    expect(ks.list()).toEqual(["relayer"]);
  });
  test("rejects names that could escape the folder", () => {
    const ks = keystore(mkdtempSync(join(tmpdir(), "qredit-keys-")));
    expect(() => ks.write("../evil", {})).toThrow();
    expect(() => ks.read("a/b")).toThrow();
  });
});
```

`engine/test/businesses.test.ts`:
```ts
import { describe, expect, test } from "bun:test";
import { loadBusinesses, vaultInit } from "../src/setup/businesses.ts";

const roles = {
  spender: "0x0000000000000000000000000000000000000001" as const,
  operator: "0x0000000000000000000000000000000000000002" as const,
  ownerPq: "0x0000000000000000000000000000000000000003" as const,
  suppliers: {
    dataIndexer: "0x00000000000000000000000000000000000000d1" as const,
    listOracle: "0x00000000000000000000000000000000000000d2" as const,
    computeBasic: "0x00000000000000000000000000000000000000d3" as const,
    computeDeep: "0x00000000000000000000000000000000000000d4" as const,
  },
};

describe("businesses.json", () => {
  test("loads four businesses with valid parameters", () => {
    const list = loadBusinesses();
    expect(list.map((b) => b.slug)).toEqual(["counterparty-check", "sanctions-screen", "due-diligence", "contract-auditor"]);
    for (const b of list) expect(b.split.lenderBps + b.split.ownerBps).toBeLessThanOrEqual(10_000);
  });

  test("vaultInit maps parameters to the factory Init", () => {
    const due = loadBusinesses().find((b) => b.slug === "due-diligence")!;
    const init = vaultInit(due, roles, 1_000_000);
    expect(init.cosmosChainId).toBe("qorechain-diana");
    expect(init.ownerPq).toBe(roles.ownerPq);
    expect(init.ownerPayout).toBe(roles.ownerPq);
    expect(init.suppliers).toEqual([roles.suppliers.dataIndexer, roles.suppliers.computeBasic, roles.suppliers.computeDeep]);
    expect(init.supplierCaps).toEqual([200_000n, 1_000_000n, 2_000_000n]);
    expect(init.servicePrices).toEqual([3_000_000n]);
    expect(init.loan.raiseDeadline).toBe(1_000_000n + 1_209_600n);
    expect(init.loan.period).toBe(3600n);
    expect(init.orderTtl).toBe(3600n);
  });
});
```

- [ ] **Step 4: Run them to verify they fail**

Run (in `engine/`): `bun test`
Expected: FAIL, modules not found.

- [ ] **Step 5: Write `engine/src/config.ts`, `engine/src/keystore.ts`, `engine/src/setup/businesses.ts`**

```ts
// config.ts
import { join } from "node:path";
import { z } from "zod";

const schema = z.object({
  OWNER_ADDRESS: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  API_URL: z.string().url().default("http://localhost:8787"),
  ENGINE_TOKEN: z.string().min(32).optional(),
  GEMINI_API_KEY: z.string().optional(),
  KEYS_DIR: z.string().default(join(import.meta.dir, "..", ".keys")),
});
export type EngineConfig = z.infer<typeof schema>;
export const loadEngineConfig = (env: Record<string, string | undefined> = process.env): EngineConfig => schema.parse(env);
```

```ts
// keystore.ts
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const NAME = /^[a-z0-9][a-z0-9-]{0,62}$/;

export function keystore(dir: string) {
  const file = (name: string) => {
    if (!NAME.test(name)) throw new Error(`invalid key name "${name}"`);
    return join(dir, `${name}.json`);
  };
  return {
    has: (name: string) => existsSync(file(name)),
    read: (name: string): Record<string, string> => JSON.parse(readFileSync(file(name), "utf8")),
    write: (name: string, data: Record<string, string>) => {
      mkdirSync(dir, { recursive: true });
      writeFileSync(file(name), JSON.stringify(data, null, 2), { flag: "wx", mode: 0o600 });
    },
    list: () => (existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -5)).sort() : []),
  };
}
export type Keystore = ReturnType<typeof keystore>;
```

```ts
// setup/businesses.ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { FUSD_ADDRESS } from "@qredit/qore";
import { z } from "zod";

const units = z.string().regex(/^[0-9]+$/);
const roleEnum = z.enum(["dataIndexer", "listOracle", "computeBasic", "computeDeep"]);
export type SupplierRole = z.infer<typeof roleEnum>;

const business = z.object({
  slug: z.string().regex(/^[a-z0-9-]{2,40}$/),
  name: z.string(),
  tagline: z.string(),
  services: z.array(z.object({ id: z.number().int().nonnegative(), name: z.string(), priceUnits: units })).min(1),
  suppliers: z.array(z.object({ role: roleEnum, capUnits: units })).min(1),
  split: z.object({ lenderBps: z.number().int().min(0).max(10_000), ownerBps: z.number().int().min(0).max(10_000) }),
  dailyCapUnits: units,
  orderTtlSeconds: z.number().int().positive(),
  loan: z.object({
    targetUnits: units, totalOwedUnits: units, raiseSeconds: z.number().int().positive(),
    periodSeconds: z.number().int().positive(), graceSeconds: z.number().int().nonnegative(), installmentUnits: units,
  }),
  demoState: z.enum(["raising", "active", "trapped", "repaid"]),
});
const file = z.object({
  suppliers: z.record(roleEnum, z.object({ name: z.string(), priceUnits: units })),
  businesses: z.array(business),
});
export type BusinessParams = z.infer<typeof business>;
export type SupplierCatalog = z.infer<typeof file>["suppliers"];

const DEFAULT_PATH = join(import.meta.dir, "..", "..", "businesses.json");
export const loadCatalog = (path = DEFAULT_PATH) => file.parse(JSON.parse(readFileSync(path, "utf8")));
export const loadBusinesses = (path = DEFAULT_PATH): BusinessParams[] => loadCatalog(path).businesses;

type Hex = `0x${string}`;
export function vaultInit(
  b: BusinessParams,
  roles: { spender: Hex; operator: Hex; ownerPq: Hex; suppliers: Record<SupplierRole, Hex> },
  nowSeconds: number,
) {
  return {
    token: FUSD_ADDRESS as Hex,
    spender: roles.spender,
    operator: roles.operator,
    ownerPq: roles.ownerPq,
    ownerPayout: roles.ownerPq,
    cosmosChainId: "qorechain-diana",
    lenderBps: b.split.lenderBps,
    ownerBps: b.split.ownerBps,
    dailyCap: BigInt(b.dailyCapUnits),
    orderTtl: BigInt(b.orderTtlSeconds),
    loan: {
      target: BigInt(b.loan.targetUnits),
      totalOwed: BigInt(b.loan.totalOwedUnits),
      raiseDeadline: BigInt(nowSeconds + b.loan.raiseSeconds),
      period: BigInt(b.loan.periodSeconds),
      grace: BigInt(b.loan.graceSeconds),
      installment: BigInt(b.loan.installmentUnits),
    },
    suppliers: b.suppliers.map((s) => roles.suppliers[s.role]),
    supplierCaps: b.suppliers.map((s) => BigInt(s.capUnits)),
    servicePrices: b.services.map((s) => BigInt(s.priceUnits)),
  };
}
```

- [ ] **Step 6: Run tests and typecheck**

Run (in `engine/`): `bun test && bun run typecheck`
Expected: 4 pass.

- [ ] **Step 7: Commit**

```bash
git add .gitignore bun.lock engine/package.json engine/tsconfig.json engine/CLAUDE.md engine/.env.example engine/businesses.json engine/src engine/test
git commit -m "feat(engine): scaffold the engine with its keystore and business parameters"
```

---

### Task 3: Production accounts and funding commands

**Files:**
- Create: `engine/src/setup/accounts.ts`, `engine/src/setup/chain.ts`, `engine/src/cli/owner.ts`, `engine/test/accounts.test.ts`

**Interfaces:**
- Consumes: `keystore`, `loadBusinesses` (Task 2); `@qredit/qore` (`accountFrom`, `parseKeySpec`, `broadcastHybrid`, `txEvents`, `convertCoinMsg`, `qoreRegistry`, `TESTNET`, `FUSD_DENOM`).
- Produces:
  - `accountNames(businesses): string[]` — `relayer`, `treasury`, `supplier-data-indexer`, `supplier-list-oracle`, `supplier-compute-basic`, `supplier-compute-deep`, and per business `<slug>-spender`, `<slug>-operator`, `<slug>-agent`
  - `ensureAccounts(ks, names): { created: string[]; existing: string[] }` — mnemonic for relayer/treasury/suppliers/spenders; `{ privateKey, recoveryCode }` for operators; `{ ed25519: hex }` for agents
  - `loadAccount(ks, name): Promise<UnifiedAccount>` (not for agents); `agentKey(ks, slug): { secret: Uint8Array; publicKey: Uint8Array }`
  - `registerKey(acc)`, `sendQor(from, to: string[], uqor: bigint, fusdUnits?: bigint)`, `convertFusd(acc, units)` in `setup/chain.ts`
  - CLI commands: `accounts init`, `accounts show`, `accounts register`, `fund <from> <qor> <fusd> <name...>`, `convert <name> <fusd>`, `be-env` (writes RELAYER_KEY, TREASURY_KEY, OPERATOR_KEYS into `apps/be/.env`, replacing existing lines, never printing them)

- [ ] **Step 1: Write the failing test `engine/test/accounts.test.ts`**

```ts
import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isValidRecoveryCode } from "@qorechain/sdk";
import { keystore } from "../src/keystore.ts";
import { accountNames, agentKey, ensureAccounts } from "../src/setup/accounts.ts";
import { loadBusinesses } from "../src/setup/businesses.ts";

describe("accounts", () => {
  test("names cover shared roles and three per business", () => {
    const names = accountNames(loadBusinesses());
    expect(names.slice(0, 6)).toEqual(["relayer", "treasury", "supplier-data-indexer", "supplier-list-oracle", "supplier-compute-basic", "supplier-compute-deep"]);
    expect(names).toContain("due-diligence-operator");
    expect(names.length).toBe(6 + 4 * 3);
  });

  test("ensureAccounts creates each kind once and is idempotent", () => {
    const ks = keystore(mkdtempSync(join(tmpdir(), "qredit-acc-")));
    const names = ["relayer", "x-spender", "x-operator", "x-agent"];
    expect(ensureAccounts(ks, names)).toEqual({ created: names, existing: [] });
    expect(ensureAccounts(ks, names)).toEqual({ created: [], existing: names });
    expect(ks.read("relayer").mnemonic.split(" ").length).toBe(24);
    const op = ks.read("x-operator");
    expect(op.privateKey).toMatch(/^0x[0-9a-f]{64}$/);
    expect(isValidRecoveryCode(op.recoveryCode)).toBe(true);
    expect(agentKey(ks, "x").publicKey.length).toBe(32);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun test test/accounts.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Write `engine/src/setup/accounts.ts`**

```ts
import { randomBytes } from "node:crypto";
import { ed25519 } from "@noble/curves/ed25519";
import { generateMnemonic, generatePqcRecoveryCode, type UnifiedAccount } from "@qorechain/sdk";
import { accountFrom, parseKeySpec } from "@qredit/qore";
import type { Keystore } from "../keystore.ts";
import type { BusinessParams } from "./businesses.ts";

export const SUPPLIER_ACCOUNTS = {
  dataIndexer: "supplier-data-indexer",
  listOracle: "supplier-list-oracle",
  computeBasic: "supplier-compute-basic",
  computeDeep: "supplier-compute-deep",
} as const;

export function accountNames(businesses: BusinessParams[]): string[] {
  return [
    "relayer", "treasury", ...Object.values(SUPPLIER_ACCOUNTS),
    ...businesses.flatMap((b) => [`${b.slug}-spender`, `${b.slug}-operator`, `${b.slug}-agent`]),
  ];
}

function freshKey(name: string): Record<string, string> {
  if (name.endsWith("-agent")) return { ed25519: Buffer.from(ed25519.utils.randomPrivateKey()).toString("hex") };
  if (name.endsWith("-operator")) return { privateKey: `0x${randomBytes(32).toString("hex")}`, recoveryCode: generatePqcRecoveryCode() };
  return { mnemonic: generateMnemonic(256) };
}

export function ensureAccounts(ks: Keystore, names: string[]): { created: string[]; existing: string[] } {
  const created: string[] = [];
  const existing: string[] = [];
  for (const name of names) {
    if (ks.has(name)) existing.push(name);
    else {
      ks.write(name, freshKey(name));
      created.push(name);
    }
  }
  return { created, existing };
}

export const loadAccount = (ks: Keystore, name: string): Promise<UnifiedAccount> => accountFrom(parseKeySpec(JSON.stringify(ks.read(name))));

export function agentKey(ks: Keystore, slug: string): { secret: Uint8Array; publicKey: Uint8Array } {
  const secret = Uint8Array.from(Buffer.from(ks.read(`${slug}-agent`).ed25519, "hex"));
  return { secret, publicKey: ed25519.getPublicKey(secret) };
}
```

If `generateMnemonic(256)` is not the SDK signature, use the SDK's `generateMnemonic()` (the spikes used it without arguments) and change the test to expect 12 or 24 words accordingly.

- [ ] **Step 4: Write `engine/src/setup/chain.ts`** (funding, registration, conversion; later tasks add the rest)

```ts
import { buildRegisterPqcKeyMsg, fetchPqcStatus, signProofOfPossession, type UnifiedAccount } from "@qorechain/sdk";
import { broadcastHybrid, convertCoinMsg, FUSD_DENOM, qoreRegistry, TESTNET, txEvents } from "@qredit/qore";

const net = TESTNET;

async function confirmed(sent: { hash: string; code: number; rawLog?: string }, what: string): Promise<string> {
  if (sent.code !== 0) throw new Error(`${what} refused: code ${sent.code} ${sent.rawLog ?? ""}`);
  await txEvents(net.rest, sent.hash);
  return sent.hash;
}

/** Register the account's ML-DSA-87 key (classical tx, once). Returns null if already registered. */
export async function registerKey(acc: UnifiedAccount): Promise<string | null> {
  if ((await fetchPqcStatus({ rest: net.rest, address: acc.cosmos })).registered) return null;
  const pop = signProofOfPossession({ chainId: net.chainId, account: acc.cosmos, keypair: acc.pqc });
  const { EthNativeSigner } = await import("@qorechain/sdk");
  const { StargateClient } = await import("@cosmjs/stargate");
  const res = await fetch(`${net.rest}/cosmos/auth/v1beta1/accounts/${acc.cosmos}`);
  if (!res.ok) throw new Error(`${acc.cosmos} has no funds yet`);
  const base = ((await res.json()) as { account: Record<string, unknown> }).account;
  const b = (base.base_account ?? base) as Record<string, string>;
  const signer = new EthNativeSigner(acc, { signMode: "classical", rest: net.rest });
  const transport = await StargateClient.connect(net.rpc);
  try {
    const sent = await signer.signAndBroadcast(transport, {
      chainId: net.chainId, accountNumber: BigInt(b.account_number ?? "0"), sequence: BigInt(b.sequence ?? "0"), memo: "register ML-DSA-87",
      messages: [buildRegisterPqcKeyMsg(acc.cosmos, { pqcKeypair: acc.pqc, proofOfPossession: pop })],
      fee: { amount: [{ denom: "uqor", amount: "150000" }], gas: "1000000" },
    });
    return confirmed({ hash: sent.transactionHash, code: sent.code, rawLog: sent.rawLog }, "key registration");
  } finally {
    transport.disconnect();
  }
}

/** One hybrid MsgSend per recipient, in a single tx: uqor and optionally faucet fUSD (bank coin). */
export async function sendQor(from: UnifiedAccount, to: string[], uqor: bigint, fusdUnits = 0n): Promise<string> {
  const amount = [
    ...(fusdUnits > 0n ? [{ denom: FUSD_DENOM, amount: fusdUnits.toString() }] : []),
    ...(uqor > 0n ? [{ denom: "uqor", amount: uqor.toString() }] : []),
  ].sort((a, b) => (a.denom < b.denom ? -1 : 1));
  const messages = to.map((toAddress) => ({ typeUrl: "/cosmos.bank.v1beta1.MsgSend", value: { fromAddress: from.cosmos, toAddress, amount } }));
  return confirmed(await broadcastHybrid(net, from, messages, { memo: "qredit setup funds", gas: String(200_000 + 100_000 * to.length) }), "funding");
}

/** Faucet fUSD (bank coin) → ERC-20 fUSD on the same account. */
export async function convertFusd(acc: UnifiedAccount, units: bigint): Promise<string> {
  return confirmed(
    await broadcastHybrid(net, acc, [convertCoinMsg(acc.cosmos, acc.evm, units)], { memo: "convert fUSD", registry: qoreRegistry() }),
    "conversion",
  );
}
```

If `@qredit/qore`'s `tx.ts` already exposes a classical-mode broadcast or an `accountNumbers` helper, use it in `registerKey` instead of the inline REST call (DRY); add a `signMode` option to `broadcastHybrid` only if that is the smaller change, and test it in `packages/qore`.

- [ ] **Step 5: Write `engine/src/cli/owner.ts`** (accounts and funding commands; Task 4 and 5 add more)

```ts
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fetchPqcStatus } from "@qorechain/sdk";
import { TESTNET } from "@qredit/qore";
import { loadEngineConfig } from "../config.ts";
import { keystore } from "../keystore.ts";
import { accountNames, ensureAccounts, loadAccount } from "../setup/accounts.ts";
import { loadBusinesses } from "../setup/businesses.ts";
import { convertFusd, registerKey, sendQor } from "../setup/chain.ts";

const cfg = loadEngineConfig();
const ks = keystore(cfg.KEYS_DIR);
const businesses = loadBusinesses();
const names = accountNames(businesses);
const keyed = (n: string) => !n.endsWith("-agent");
const units = (fusd: string) => BigInt(Math.round(Number(fusd) * 1e6));
const uqor = (qor: string) => BigInt(Math.round(Number(qor) * 1e6));

async function balance(address: string): Promise<string> {
  const r = await fetch(`${TESTNET.rest}/cosmos/bank/v1beta1/balances/${address}`);
  const b = r.ok ? ((await r.json()) as { balances: { denom: string; amount: string }[] }).balances : [];
  const q = Number(b.find((x) => x.denom === "uqor")?.amount ?? 0) / 1e6;
  const f = Number(b.find((x) => x.denom.startsWith("erc20:0x97143"))?.amount ?? 0) / 1e6;
  return `${q} QOR, ${f} bank fUSD`;
}

function upsertEnv(path: string, entries: Record<string, string>) {
  const lines = existsSync(path) ? readFileSync(path, "utf8").split(/\r?\n/) : [];
  const kept = lines.filter((l) => !Object.keys(entries).some((k) => l.startsWith(`${k}=`)));
  while (kept.length && kept[kept.length - 1] === "") kept.pop();
  writeFileSync(path, [...kept, ...Object.entries(entries).map(([k, v]) => `${k}=${v}`), ""].join("\n"), { mode: 0o600 });
}

const commands: Record<string, (args: string[]) => Promise<void>> = {
  async "accounts"([sub]) {
    if (sub === "init") {
      const r = ensureAccounts(ks, names);
      console.log(`created ${r.created.length}, existing ${r.existing.length}`);
    } else if (sub === "show") {
      for (const n of names.filter(keyed)) {
        const a = await loadAccount(ks, n);
        const pqc = await fetchPqcStatus({ rest: TESTNET.rest, address: a.cosmos });
        console.log(`${n.padEnd(28)} ${a.cosmos} ${a.evm}  ${await balance(a.cosmos)}  ML-DSA ${pqc.registered ? "yes" : "no"}`);
      }
    } else if (sub === "register") {
      for (const n of names.filter(keyed)) {
        try {
          const tx = await registerKey(await loadAccount(ks, n));
          console.log(`${n}: ${tx ?? "already registered"}`);
        } catch (e) {
          console.log(`${n}: skipped (${(e as Error).message})`);
        }
      }
    } else throw new Error("usage: accounts init|show|register");
  },
  async "fund"([from, qor, fusd, ...to]) {
    const sender = await loadAccount(ks, from);
    const targets = await Promise.all(to.map(async (n) => (await loadAccount(ks, n)).cosmos));
    console.log("funded:", await sendQor(sender, targets, uqor(qor), units(fusd)));
  },
  async "convert"([name, fusd]) {
    console.log("converted:", await convertFusd(await loadAccount(ks, name), units(fusd)));
  },
  async "be-env"() {
    const spec = (n: string) => JSON.stringify(ks.read(n));
    const operators = businesses.map((b) => ks.read(`${b.slug}-operator`));
    upsertEnv(join(import.meta.dir, "..", "..", "..", "apps", "be", ".env"), {
      RELAYER_KEY: spec("relayer"),
      TREASURY_KEY: spec("treasury"),
      OPERATOR_KEYS: JSON.stringify(operators),
    });
    console.log("apps/be/.env updated (RELAYER_KEY, TREASURY_KEY, OPERATOR_KEYS)");
  },
};

const [cmd, ...args] = process.argv.slice(2);
const run = commands[cmd ?? ""];
if (!run) {
  console.log("usage: owner accounts init|show|register | fund <from> <qor> <fusd> <name...> | convert <name> <fusd> | be-env | business create <slug>|all | lend <slug> <fusd> | windows");
  process.exit(1);
}
run(args).catch((e) => {
  console.error((e as Error).message);
  process.exit(1);
});
```

- [ ] **Step 6: Run tests and typecheck; commit**

Run: `bun test && bun run typecheck`
Expected: 6 pass.

```bash
git add engine/src engine/test
git commit -m "feat(engine): add production accounts and funding commands to the owner CLI"
```

---

### Task 4: Business creation (vault, agent key, operator window, registration)

**Files:**
- Create: `engine/src/setup/deployments.ts`, `engine/test/deployments.test.ts`
- Modify: `engine/src/setup/chain.ts`, `engine/src/cli/owner.ts`

**Interfaces:**
- Produces:
  - `deployments.ts`: `type Deployment = { slug; vault; startBlock: number; createTx; spender; operator; agentPubkey; linkTx; windowTx }`; `readDeployments(path?): Record<string, Deployment>`; `writeDeployment(d, path?)` (stable key order, pretty JSON)
  - `chain.ts`: `openWindow(acc, targets: string[], o?: { blocks?: number; maxTxs?: number; maxValue?: bigint }): Promise<string>`; `createVault(treasury, init): Promise<{ vault; startBlock; tx }>`; `linkAgent(spender, agent: { secret; publicKey }, vault): Promise<string>`; `registerBusiness(apiUrl, token, body): Promise<void>`
  - CLI: `business create <slug>|all` — idempotent per step (skips a step whose result is already in `deployments.json`); `windows` (opens/refreshes the treasury window over factory + fUSD + all vaults)

- [ ] **Step 1: Write the failing test `engine/test/deployments.test.ts`**

```ts
import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readDeployments, writeDeployment } from "../src/setup/deployments.ts";

describe("deployments.json", () => {
  test("missing file reads as empty; writes merge by slug", () => {
    const path = join(mkdtempSync(join(tmpdir(), "qredit-dep-")), "deployments.json");
    expect(readDeployments(path)).toEqual({});
    const d = { slug: "a", vault: "0x1", startBlock: 5, createTx: "0xc", spender: "0x2", operator: "0x3", agentPubkey: "ab", linkTx: "", windowTx: "" };
    writeDeployment(d, path);
    writeDeployment({ ...d, slug: "b", vault: "0x9" }, path);
    writeDeployment({ ...d, linkTx: "0xl" }, path);
    const all = readDeployments(path);
    expect(Object.keys(all)).toEqual(["a", "b"]);
    expect(all.a.linkTx).toBe("0xl");
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `bun test test/deployments.test.ts` → FAIL, module not found.

- [ ] **Step 3: Write `engine/src/setup/deployments.ts`**

```ts
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export type Deployment = {
  slug: string; vault: string; startBlock: number; createTx: string;
  spender: string; operator: string; agentPubkey: string; linkTx: string; windowTx: string;
};
const DEFAULT = join(import.meta.dir, "..", "..", "deployments.json");

export const readDeployments = (path = DEFAULT): Record<string, Deployment> =>
  existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as Record<string, Deployment>) : {};

export function writeDeployment(d: Deployment, path = DEFAULT): void {
  const all = { ...readDeployments(path), [d.slug]: d };
  const sorted = Object.fromEntries(Object.keys(all).sort().map((k) => [k, all[k]]));
  writeFileSync(path, `${JSON.stringify(sorted, null, 2)}\n`);
}
```

- [ ] **Step 4: Add chain functions to `engine/src/setup/chain.ts`**

```ts
import { ed25519 } from "@noble/curves/ed25519";
import { linkAuthenticatorMsgs, openEvmWindowMsg, signAuthenticatorLinkEd25519 } from "@qorechain/sdk";
import { decodeEventLog, encodeFunctionData } from "viem";
import { FACTORY_ABI, FACTORY_ADDRESS, PAY_SUPPLIER_SELECTOR, publicClientFor, walletFor } from "@qredit/qore";

const client = publicClientFor(TESTNET.evm);

export async function openWindow(acc: UnifiedAccount, targets: string[], o: { blocks?: number; maxTxs?: number; maxValue?: bigint } = {}): Promise<string> {
  const msg = openEvmWindowMsg({
    sender: acc.cosmos,
    blocks: BigInt(o.blocks ?? 17_280),
    maxTxs: BigInt(o.maxTxs ?? 500),
    maxValue: (o.maxValue ?? 25_000_000n).toString(),
    allowedTargets: targets.map((t) => t.toLowerCase()),
  });
  const tx = await confirmed(await broadcastHybrid(net, acc, [msg], { memo: "qredit window" }), "window");
  await Bun.sleep(10_000); // the next EVM tx must land after the window's block
  return tx;
}

export async function createVault(treasury: UnifiedAccount, init: ReturnType<typeof import("./businesses.ts").vaultInit>) {
  const wallet = walletFor(treasury.privateKey as `0x${string}`, TESTNET.evm);
  const hash = await wallet.sendTransaction({
    account: wallet.account!, chain: wallet.chain,
    to: FACTORY_ADDRESS, data: encodeFunctionData({ abi: FACTORY_ABI, functionName: "create", args: [init] }),
  });
  const receipt = await client.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`vault creation reverted: ${hash}`);
  for (const log of receipt.logs) {
    try {
      const ev = decodeEventLog({ abi: FACTORY_ABI, data: log.data, topics: log.topics });
      if (ev.eventName === "VaultCreated") return { vault: (ev.args.vault as string).toLowerCase(), startBlock: Number(receipt.blockNumber), tx: hash };
    } catch {
      // not a factory event
    }
  }
  throw new Error(`no VaultCreated event in ${hash}`);
}

export async function linkAgent(spender: UnifiedAccount, agent: { secret: Uint8Array }, vault: string): Promise<string> {
  const proof = signAuthenticatorLinkEd25519({ chainId: net.chainId, account: spender.cosmos, privateKey: agent.secret });
  const msgs = linkAuthenticatorMsgs({
    owner: spender.cosmos, chainId: net.chainId, ...proof,
    permissions: ["evm"],
    expiryUnix: Math.floor(Date.now() / 1000) + 30 * 24 * 3600,
    label: "qredit agent",
    spendingRule: {
      id: "agent", enabled: true, perTxLimit: "1000000", dailyLimit: "5000000", allowedDenoms: ["uqor"],
      allowedEvmCalls: [`${vault.toLowerCase()}/${PAY_SUPPLIER_SELECTOR}`],
    },
  });
  return confirmed(await broadcastHybrid(net, spender, msgs, { memo: "link qredit agent" }), "agent link");
}

export async function registerBusiness(apiUrl: string, token: string, body: unknown): Promise<void> {
  const res = await fetch(`${apiUrl}/v1/businesses`, {
    method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  if (res.status !== 204) throw new Error(`business registration failed: HTTP ${res.status} ${await res.text()}`);
}
```

(Merge the imports with those already at the top of the file; one import per module.)

- [ ] **Step 5: Add `business` and `windows` commands to `engine/src/cli/owner.ts`**

```ts
// add to the imports
import { FACTORY_ADDRESS, FUSD_ADDRESS } from "@qredit/qore";
import { agentKey, SUPPLIER_ACCOUNTS } from "../setup/accounts.ts";
import { vaultInit } from "../setup/businesses.ts";
import { createVault, linkAgent, openWindow, registerBusiness } from "../setup/chain.ts";
import { readDeployments, writeDeployment } from "../setup/deployments.ts";

// add to `commands`
  async "windows"() {
    const treasury = await loadAccount(ks, "treasury");
    const vaults = Object.values(readDeployments()).map((d) => d.vault);
    console.log("treasury window:", await openWindow(treasury, [FACTORY_ADDRESS, FUSD_ADDRESS, ...vaults], { blocks: 3600, maxTxs: 40, maxValue: 60_000_000n }));
  },
  async "business"([sub, which]) {
    if (sub !== "create" || !which) throw new Error("usage: business create <slug>|all");
    if (!cfg.ENGINE_TOKEN) throw new Error("ENGINE_TOKEN is required in engine/.env");
    const treasury = await loadAccount(ks, "treasury");
    const suppliers = Object.fromEntries(
      await Promise.all(Object.entries(SUPPLIER_ACCOUNTS).map(async ([role, name]) => [role, (await loadAccount(ks, name)).evm.toLowerCase()])),
    ) as Record<keyof typeof SUPPLIER_ACCOUNTS, `0x${string}`>;
    for (const b of businesses.filter((x) => which === "all" || x.slug === which)) {
      const spender = await loadAccount(ks, `${b.slug}-spender`);
      const operator = await loadAccount(ks, `${b.slug}-operator`);
      const agent = agentKey(ks, b.slug);
      let d = readDeployments()[b.slug];
      if (!d) {
        const init = vaultInit(b, { spender: spender.evm.toLowerCase() as `0x${string}`, operator: operator.evm.toLowerCase() as `0x${string}`, ownerPq: cfg.OWNER_ADDRESS.toLowerCase() as `0x${string}`, suppliers }, Math.floor(Date.now() / 1000));
        const v = await createVault(treasury, init);
        d = { slug: b.slug, vault: v.vault, startBlock: v.startBlock, createTx: v.tx, spender: spender.evm.toLowerCase(), operator: operator.evm.toLowerCase(), agentPubkey: Buffer.from(agent.publicKey).toString("hex"), linkTx: "", windowTx: "" };
        writeDeployment(d);
        console.log(`${b.slug}: vault ${d.vault} (block ${d.startBlock})`);
      }
      if (!d.linkTx) {
        d = { ...d, linkTx: await linkAgent(spender, agent, d.vault) };
        writeDeployment(d);
        console.log(`${b.slug}: agent key linked ${d.linkTx}`);
      }
      if (!d.windowTx) {
        d = { ...d, windowTx: await openWindow(operator, [d.vault]) };
        writeDeployment(d);
        console.log(`${b.slug}: operator window ${d.windowTx}`);
      }
      await registerBusiness(cfg.API_URL, cfg.ENGINE_TOKEN, {
        slug: b.slug, vault: d.vault, name: b.name, tagline: b.tagline, services: b.services,
        operator: d.operator, spender: d.spender, startBlock: d.startBlock,
      });
      console.log(`${b.slug}: registered with the API`);
    }
  },
```

- [ ] **Step 6: Tests, typecheck, commit**

Run: `bun test && bun run typecheck` → 7 pass.

```bash
git add engine/src engine/test
git commit -m "feat(engine): create agent businesses: vault, linked agent key, operator window"
```

---

### Task 5: Lending command

**Files:**
- Modify: `engine/src/setup/chain.ts`, `engine/src/cli/owner.ts`

**Interfaces:**
- Produces: `lend(lender: UnifiedAccount, vault: string, units: bigint): Promise<{ approveTx; depositTx }>`; CLI `lend <slug> <fusd>` (from the treasury; requires the treasury window from `owner windows`).

- [ ] **Step 1: Add `lend` to `engine/src/setup/chain.ts`**

```ts
import { ERC20_ABI, VAULT_ABI } from "@qredit/qore";

export async function lend(lender: UnifiedAccount, vault: string, units: bigint): Promise<{ approveTx: string; depositTx: string }> {
  const wallet = walletFor(lender.privateKey as `0x${string}`, TESTNET.evm);
  const send = async (to: `0x${string}`, data: `0x${string}`) => {
    const hash = await wallet.sendTransaction({ account: wallet.account!, chain: wallet.chain, to, data });
    const r = await client.waitForTransactionReceipt({ hash });
    if (r.status !== "success") throw new Error(`reverted: ${hash}`);
    return hash;
  };
  const approveTx = await send(FUSD_ADDRESS, encodeFunctionData({ abi: ERC20_ABI, functionName: "approve", args: [vault as `0x${string}`, units] }));
  const depositTx = await send(vault as `0x${string}`, encodeFunctionData({ abi: VAULT_ABI, functionName: "deposit", args: [units] }));
  return { approveTx, depositTx };
}
```

- [ ] **Step 2: Add the command**

```ts
  async "lend"([slug, fusd]) {
    const d = readDeployments()[slug];
    if (!d) throw new Error(`no deployment for ${slug}; run business create first`);
    const r = await lend(await loadAccount(ks, "treasury"), d.vault, units(fusd));
    console.log(`${slug}: approved ${r.approveTx}, deposited ${r.depositTx}`);
  },
```

- [ ] **Step 3: Typecheck, commit**

Run: `bun test && bun run typecheck` → 7 pass.

```bash
git add engine/src
git commit -m "feat(engine): add the lend command"
```

---

### Task 6: Simulated suppliers

**Files:**
- Create: `engine/src/suppliers/app.ts`, `engine/src/suppliers/server.ts`, `engine/test/suppliers.test.ts`

**Interfaces:**
- Produces: `createSupplierApp(deps: { payments: PaymentSource; catalog: Record<SupplierRole, { name; priceUnits; address: string }>; data: Record<SupplierRole, (query: Record<string,string>) => Promise<unknown>> }): Hono`; `interface PaymentSource { paid(vault: string, orderId: string, supplier: string): Promise<bigint> }` (sum of `SupplierPaid` amounts for that order to that supplier); `chainPayments(client): PaymentSource`.
- Route: `GET /v1/:role?vault=0x..&orderId=N&...query` → 402 `{ error, priceUnits, payTo }` until paid ≥ price, then 200 `{ supplier, data }`.

- [ ] **Step 1: Write the failing test `engine/test/suppliers.test.ts`**

```ts
import { describe, expect, test } from "bun:test";
import { createSupplierApp, type PaymentSource } from "../src/suppliers/app.ts";

const V = "0x00000000000000000000000000000000000000aa";
const catalog = {
  dataIndexer: { name: "Data Indexer", priceUnits: "50000", address: "0x00000000000000000000000000000000000000d1" },
  listOracle: { name: "List Oracle", priceUnits: "100000", address: "0x00000000000000000000000000000000000000d2" },
  computeBasic: { name: "Compute Basic", priceUnits: "500000", address: "0x00000000000000000000000000000000000000d3" },
  computeDeep: { name: "Compute Deep", priceUnits: "1500000", address: "0x00000000000000000000000000000000000000d4" },
};

function app(paid: bigint) {
  const calls: unknown[] = [];
  const payments: PaymentSource = { paid: async (vault, orderId, supplier) => { calls.push([vault, orderId, supplier]); return paid; } };
  const data = {
    dataIndexer: async (q: Record<string, string>) => ({ address: q.address, txCount: 3 }),
    listOracle: async () => ({ match: false }),
    computeBasic: async () => ({ ok: true }),
    computeDeep: async () => ({ ok: true }),
  };
  return { a: createSupplierApp({ payments, catalog, data }), calls };
}

describe("suppliers", () => {
  test("402 with the price until paid", async () => {
    const { a } = app(10_000n);
    const res = await a.request(`/v1/dataIndexer?vault=${V}&orderId=7&address=qor1x`);
    expect(res.status).toBe(402);
    expect(await res.json()).toMatchObject({ priceUnits: "50000", payTo: catalog.dataIndexer.address });
  });

  test("returns data once the vault paid this supplier for this order", async () => {
    const { a, calls } = app(50_000n);
    const res = await a.request(`/v1/dataIndexer?vault=${V}&orderId=7&address=qor1x`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ supplier: "Data Indexer", data: { address: "qor1x", txCount: 3 } });
    expect(calls).toEqual([[V, "7", catalog.dataIndexer.address]]);
  });

  test("validates role, vault and order id", async () => {
    const { a } = app(0n);
    expect((await a.request(`/v1/unknown?vault=${V}&orderId=1`)).status).toBe(404);
    expect((await a.request(`/v1/listOracle?vault=0x12&orderId=1`)).status).toBe(400);
    expect((await a.request(`/v1/listOracle?vault=${V}&orderId=x`)).status).toBe(400);
  });
});
```

- [ ] **Step 2: Run to verify it fails** — FAIL, module not found.

- [ ] **Step 3: Write `engine/src/suppliers/app.ts`**

```ts
import { Hono } from "hono";
import type { PublicClient } from "viem";
import { SUPPLIER_PAID_EVENT } from "@qredit/qore";
import type { SupplierRole } from "../setup/businesses.ts";

export interface PaymentSource {
  paid(vault: string, orderId: string, supplier: string): Promise<bigint>;
}

type Entry = { name: string; priceUnits: string; address: string };

export function createSupplierApp(deps: {
  payments: PaymentSource;
  catalog: Record<SupplierRole, Entry>;
  data: Record<SupplierRole, (query: Record<string, string>) => Promise<unknown>>;
}): Hono {
  const app = new Hono();
  app.get("/v1/:role", async (c) => {
    const role = c.req.param("role") as SupplierRole;
    const entry = deps.catalog[role];
    if (!entry) return c.json({ error: "unknown supplier" }, 404);
    const q = c.req.query();
    if (!/^0x[0-9a-fA-F]{40}$/.test(q.vault ?? "") || !/^[0-9]+$/.test(q.orderId ?? "")) return c.json({ error: "vault and orderId are required" }, 400);
    const paid = await deps.payments.paid(q.vault.toLowerCase(), q.orderId, entry.address.toLowerCase());
    if (paid < BigInt(entry.priceUnits)) return c.json({ error: "payment required", priceUnits: entry.priceUnits, payTo: entry.address }, 402);
    return c.json({ supplier: entry.name, data: await deps.data[role](q) });
  });
  return app;
}

/** Sum of SupplierPaid amounts the vault sent to this supplier for this order (recent blocks). */
export function chainPayments(client: PublicClient, lookbackBlocks = 50_000n): PaymentSource {
  return {
    async paid(vault, orderId, supplier) {
      const head = await client.getBlockNumber();
      const logs = await client.getLogs({
        address: vault as `0x${string}`, event: SUPPLIER_PAID_EVENT[0],
        args: { supplier: supplier as `0x${string}`, orderId: BigInt(orderId) },
        fromBlock: head > lookbackBlocks ? head - lookbackBlocks : 0n, toBlock: head,
      });
      return logs.reduce((sum, l) => sum + (l.args.amount ?? 0n), 0n);
    },
  };
}
```

- [ ] **Step 4: Write `engine/src/suppliers/server.ts`** (data is simulated but derived from the chain where cheap)

```ts
import { publicClientFor, TESTNET } from "@qredit/qore";
import { keystore } from "../keystore.ts";
import { loadEngineConfig } from "../config.ts";
import { loadAccount, SUPPLIER_ACCOUNTS } from "../setup/accounts.ts";
import { loadCatalog } from "../setup/businesses.ts";
import { chainPayments, createSupplierApp } from "./app.ts";

const cfg = loadEngineConfig();
const ks = keystore(cfg.KEYS_DIR);
const catalog = loadCatalog().suppliers;
const entries = Object.fromEntries(
  await Promise.all(
    (Object.keys(SUPPLIER_ACCOUNTS) as (keyof typeof SUPPLIER_ACCOUNTS)[]).map(async (role) => [
      role,
      { ...catalog[role], address: (await loadAccount(ks, SUPPLIER_ACCOUNTS[role])).evm },
    ]),
  ),
) as Parameters<typeof createSupplierApp>[0]["catalog"];

const SANCTIONED = new Set<string>(); // synthetic list, filled from a public fixture in Plan 2b-2

const app = createSupplierApp({
  payments: chainPayments(publicClientFor(TESTNET.evm)),
  catalog: entries,
  data: {
    dataIndexer: async (q) => {
      const r = await fetch(`${TESTNET.rest}/cosmos/auth/v1beta1/accounts/${q.address}`, { signal: AbortSignal.timeout(10_000) });
      return { address: q.address, exists: r.ok, account: r.ok ? await r.json() : null };
    },
    listOracle: async (q) => ({ address: q.address, listed: SANCTIONED.has((q.address ?? "").toLowerCase()), list: "synthetic-demo-v1" }),
    computeBasic: async () => ({ tier: "basic", budgetTokens: 4000 }),
    computeDeep: async () => ({ tier: "deep", budgetTokens: 16000 }),
  },
});

const port = Number(process.env.SUPPLIERS_PORT ?? 8788);
Bun.serve({ port, fetch: app.fetch });
console.log(`[suppliers] listening on :${port}`);
```

- [ ] **Step 5: Tests, typecheck, commit**

Run: `bun test && bun run typecheck` → 10 pass.

```bash
git add engine/src/suppliers engine/test/suppliers.test.ts
git commit -m "feat(engine): add payment-gated simulated suppliers"
```

---

### Task 7: Live setup on testnet

Needs funds: the human sends test QOR and faucet fUSD from their QoreX wallet to the new treasury (amounts below).

- [ ] **Step 1: Create accounts and env**

Run (in `engine/`):
```bash
cp -n .env.example .env   # then the human sets OWNER_ADDRESS (QoreX 0x) and copies ENGINE_TOKEN from apps/be/.env
bun run owner accounts init
bun run owner accounts show
```
Expected: 18 key files; `show` lists 15 keyed accounts with 0 balances. Report the treasury `qor1…` address to the human and ask them to send **60 QOR and 400 fUSD** (bank coin, via the QoreX console snippet used earlier) to it.

- [ ] **Step 2: Fund and register**

After the treasury is funded:
```bash
bun run owner accounts register     # treasury first; others skip until funded
bun run owner fund treasury 3 0 relayer
bun run owner fund treasury 2 0 counterparty-check-spender sanctions-screen-spender due-diligence-spender contract-auditor-spender
bun run owner fund treasury 4 0 counterparty-check-operator sanctions-screen-operator due-diligence-operator contract-auditor-operator
bun run owner accounts register
bun run owner convert treasury 300
bun run owner accounts show
```
Expected: every keyed account (except suppliers, which only receive) has QOR and `ML-DSA yes`; the treasury holds ERC-20 fUSD (check with `balanceOf` in a one-off `bun -e`).

- [ ] **Step 3: Switch the backend to the production keys and start it**

```bash
bun run owner be-env
cd ../apps/be && bun run dev   # background; expect "operators 4"
```

- [ ] **Step 4: Create the four businesses and fund three loans**

Run (in `engine/`, backend running):
```bash
bun run owner windows
bun run owner business create all
bun run owner windows               # refresh the treasury window to include the new vaults
bun run owner lend counterparty-check 50
bun run owner lend sanctions-screen 2
bun run owner lend due-diligence 20
```
Expected: four vault addresses in `engine/deployments.json`; link and window txs per business; three deposits; `GET http://localhost:8787/v1/businesses` lists four; the backend's watcher log stays quiet (no orders yet). Contract Auditor stays Raising by design.

- [ ] **Step 5: Run the suppliers once**

`bun run suppliers` (background); `curl "localhost:8788/v1/dataIndexer?vault=<counterparty vault>&orderId=1&address=qor1..."` → 402 with price and payTo. Stop it.

- [ ] **Step 6: Commit the public deployment record**

```bash
git add engine/deployments.json
git commit -m "chore(engine): record the four agent businesses deployed on qorechain-diana"
```

---

## After this plan

Plan 2b-2: the Mastra agent (Gemini through `@ai-sdk/openai-compatible`) that claims orders from `/v1/orders/claim`, decides, pays suppliers through `/v1/relay` (MsgExecuteEVM signed with the business's agent key), seals reports with QoreSeal, posts them to `/v1/envelopes` and delivers through the operator's window; the four service skills; the synthetic sanctions list; hosting `apps/be`, `engine` and suppliers on an always-on host behind api.qredit.fun.
