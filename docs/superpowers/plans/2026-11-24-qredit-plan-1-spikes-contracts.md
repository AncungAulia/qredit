# Qredit Plan 1: Spikes and Contracts — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove the six risky QoreChain assumptions of the Qredit spec on testnet, then build and deploy the `LoanVault` and `VaultFactory` contracts with full Foundry test coverage.

**Architecture:** Phase 0 is a set of small TypeScript scripts (`engine/spikes/`) plus one throwaway probe contract, each printing PASS/FAIL against the live `qorechain-diana` testnet; their results decide go/no-go and are written to `engine/spikes/RESULTS.md`. Phase 1 is a Foundry project (`sc/`) whose `LoanVault` holds lender capital in fUSD, escrows orders, pays only listed suppliers under caps, splits revenue on delivery, and accepts policy orders only with an ML-DSA-87 signature checked by the `pqcVerify` precompile. Later plans (agent runtime, web app, docs) are written after this plan's spike results.

**Tech Stack:** Solidity 0.8.28, Foundry, OpenZeppelin Contracts v5.1.0, Bun, TypeScript, `@qorechain/sdk` 0.14.0, `@qorechain/evm` 0.14.0, `@qorechain/qoresign` 0.2.0, `@cosmjs/stargate` 0.39.x, `@noble/curves` 1.9.x, viem 2.x.

**Spec:** `docs/superpowers/specs/2026-11-24-qredit-design.md`

## Global Constraints

- Network: QoreChain testnet only — chain id `qorechain-diana`, EVM chain id `9800`, REST `https://api-testnet.qore.host`, RPC `https://rpc-testnet.qore.host`, EVM RPC `https://evm-testnet.qore.host`.
- fUSD token: `0x97143B771D34ddb9130b807b135Ae675A5a963CA`.
- PQC precompiles, written in lowercase: `pqcVerify` at `0x0000000000000000000000000000000000000a01`, `pqcKeyStatus` at `0x0000000000000000000000000000000000000a02`.
- QoreX / QoreSign message signatures cover `"qorechain-msg-v1|" + chainId + "|" + data`; `chainId` is the Cosmos chain id string `qorechain-diana`, not 9800.
- Every EVM transaction from a normal account needs a registered ML-DSA-87 key and an open EVM window. A window with `allowedTargets` refuses contract creation. Max window: 17280 blocks, 1000 transactions, 16 targets.
- Pin package versions; do not upgrade mid-build.
- Everything committed is in English. Licence MIT.
- Never commit keys, mnemonics, recovery codes or `.env` files. Spike keys live in `engine/spikes/.keys/` (gitignored).
- Committed files never mention how long the project took or a day-by-day schedule.
- Commits: small, one logical step, conventional prefix with scope (`feat(contracts): …`), body ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## File Structure

Root layout (kept clean; every top-level folder has one job):

```
apps/web/        web app (Plan 3)
apps/be/         mailbox API, relayer, watcher (Plan 2)
engine/          agents, simulated suppliers, owner CLI (Plan 2); spikes live in engine/spikes/
sc/              smart contracts (Foundry)
docs/            spec, plans, threat model
CLAUDE.md        rules for AI coding agents working in this repo
README.md, LICENSE, .gitignore
```

Files in this plan:

```
.gitignore                         modify: spike keys, Foundry output
CLAUDE.md                          create: repo rules for AI agents
LICENSE                            create: MIT
README.md                          create: short stub (full README in a later plan)
engine/spikes/
  package.json, tsconfig.json      Bun project for the spike scripts
  .env.example                     names only
  RESULTS.md                       spike results and go/no-go
  src/lib.ts                       network, accounts, broadcast, viem clients (shared by all spikes)
  src/accounts.ts                  create/show/register spike accounts
  src/window.ts                    open/status of an account's EVM window
  src/s1-authenticator.ts          S1: linked key → MsgExecuteEVM → msg.sender, selector rule
  src/s3-message-sig.ts            S3: ML-DSA message signature → pqcVerify (script and QoreX)
  src/s4-buyer.ts                  S4: buyer approve + transfer fUSD through a scoped window
  src/s5-fusd.ts                   S5: fUSD facts, balances, swap QOR → fUSD
  src/s6-operator.ts               S6: classical-key-only operator inside a scoped window
  web/index.html                   QoreX probe page (S2a, S3a, S4a)
sc/
  foundry.toml
  src/interfaces/IQorePQC.sol      precompile interface
  src/LoanVault.sol                the vault
  src/VaultFactory.sol             deploys and lists vaults
  src/spike/SenderProbe.sol        records msg.sender (spikes only)
  test/mocks/MockPqc.sol           precompile stand-ins
  test/mocks/MockToken.sol         ERC-20 stand-in for fUSD
  test/Base.t.sol                  shared setup and helpers
  test/LoanVault.Raising.t.sol
  test/LoanVault.Orders.t.sol
  test/LoanVault.Suppliers.t.sol
  test/LoanVault.Claims.t.sol
  test/LoanVault.Policy.t.sol
  test/LoanVault.Invariant.t.sol
  test/VaultFactory.t.sol
  script/DeployProbe.s.sol
  script/DeployFactory.s.sol
  script/CreateSmokeVault.s.sol
```

---

## Phase 0 — Spikes (go/no-go)

### Task 1: Repo scaffold and spike toolkit

**Files:**
- Modify: `.gitignore`
- Create: `CLAUDE.md`, `LICENSE`, `README.md`, `engine/spikes/package.json`, `engine/spikes/tsconfig.json`, `engine/spikes/.env.example`, `engine/spikes/src/lib.ts`, `engine/spikes/src/accounts.ts`, `engine/spikes/src/window.ts`

**Interfaces:**
- Produces (`engine/spikes/src/lib.ts`):
  - `NET: { chainId: string; rest: string; rpc: string; evm: string }`
  - `qoreTestnet` (viem `Chain`), `publicClient` (viem `PublicClient`)
  - `loadAccount(name: string): Promise<UnifiedAccount>` — from `engine/spikes/.keys/<name>.json`, either `{ mnemonic }` or `{ privateKey, recoveryCode }`
  - `saveKeyFile(name: string, data: Record<string, string>): void`
  - `broadcast(acc: UnifiedAccount, messages: EncodeObject[], mode?: "hybrid" | "classical", memo?: string): Promise<{ hash: string; code: number; rawLog?: string }>` (EthNativeSigner returns no events; use `txEvents`)
  - `txEvents(hash: string): Promise<unknown[]>` — events of a committed tx over REST
  - `uqorBalance(address: string): Promise<bigint>`
  - `walletFor(privateKey: `0x${string}`)` — viem `WalletClient` on `qoreTestnet`
  - `pass(label: string, ok: boolean, detail?: string): boolean` — prints `PASS`/`FAIL` and sets `process.exitCode` on failure

- [ ] **Step 1: Check prerequisites**

Run: `bun --version; forge --version; node --version`
Expected: Bun ≥ 1.3, Foundry `forge 1.x` (if missing: install from getfoundry.sh, then `foundryup`), Node ≥ 22.

- [ ] **Step 2: Extend `.gitignore`**

Append to `.gitignore`:

```gitignore

# Spike keys and outputs
engine/spikes/.keys/
engine/spikes/out/

# Foundry
sc/out/
sc/cache/
sc/.deployer.key
```

- [ ] **Step 3: Add `LICENSE` and a README stub**

`LICENSE` — the standard MIT text with `Copyright (c) 2026 Qredit contributors`:

```text
MIT License

Copyright (c) 2026 Qredit contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

`README.md`:

```markdown
# Qredit

Credit for AI agent businesses on QoreChain. Lenders fund an agent's working capital; the agent can spend it only on approved suppliers under limits the chain enforces; every sale repays lenders first; rules can only narrow during a loan, and changing them takes the owner's ML-DSA-87 signature.

Built for Build Before Q-Day: The QoreChain Developer Fest (Post-Quantum AI Agents). Runs on the QoreChain testnet `qorechain-diana`.

- Design: [docs/superpowers/specs/2026-11-24-qredit-design.md](docs/superpowers/specs/2026-11-24-qredit-design.md)
- Contracts: [sc/](sc/)
- Spikes and their results: [engine/spikes/RESULTS.md](engine/spikes/RESULTS.md)

Licence: MIT.
```

`CLAUDE.md`:

```markdown
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
```

- [ ] **Step 4: Create the spike package**

`engine/spikes/package.json`:

```json
{
  "name": "@qredit/spikes",
  "private": true,
  "type": "module",
  "scripts": {
    "accounts": "bun src/accounts.ts",
    "window": "bun src/window.ts",
    "s1": "bun src/s1-authenticator.ts",
    "s3": "bun src/s3-message-sig.ts",
    "s4": "bun src/s4-buyer.ts",
    "s5": "bun src/s5-fusd.ts",
    "s6": "bun src/s6-operator.ts",
    "typecheck": "tsc --noEmit"
  }
}
```

Then install pinned dependencies (Bun writes exact versions to `bun.lock`):

Run (in `engine/spikes/`): `bun add @qorechain/sdk@0.14.0 @qorechain/evm@0.14.0 @qorechain/qoresign@0.2.0 @cosmjs/stargate@0.39 @cosmjs/proto-signing@0.39 @noble/curves@1.9 viem@2 && bun add -d typescript@5 @types/bun`
Expected: `bun.lock` created; `node_modules/@qorechain/sdk` present.

`engine/spikes/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "skipLibCheck": true,
    "noEmit": true,
    "allowImportingTsExtensions": true,
    "types": ["bun"]
  },
  "include": ["src"]
}
```

`engine/spikes/.env.example`:

```dotenv
# Optional: your own node instead of the public testnet endpoints (rate limited per IP).
QORE_REST_URL=
QORE_RPC_URL=
QORE_EVM_URL=
# Set by you after Task 2 (SenderProbe address on testnet).
PROBE_ADDRESS=
# S6 runtime side only: the operator's classical private key, copied from engine/spikes/.keys/operator.json.
OPERATOR_PRIVATE_KEY=
```

- [ ] **Step 5: Write `engine/spikes/src/lib.ts`**

```ts
// Shared helpers for the Qredit spikes: network presets, key files, hybrid broadcast, viem clients.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { StargateClient } from "@cosmjs/stargate";
import type { EncodeObject } from "@cosmjs/proto-signing";
import {
  EthNativeSigner,
  deriveUnifiedAccount,
  getNetwork,
  isValidRecoveryCode,
  unifiedAccountFromSeed,
  type UnifiedAccount,
} from "@qorechain/sdk";
import { createPublicClient, createWalletClient, defineChain, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const preset = getNetwork("testnet");
export const NET = {
  chainId: preset.chainId,
  rest: process.env.QORE_REST_URL?.trim() || preset.endpoints.rest,
  rpc: process.env.QORE_RPC_URL?.trim() || preset.endpoints.rpc,
  evm: process.env.QORE_EVM_URL?.trim() || preset.endpoints.evmRpc,
};

export const qoreTestnet = defineChain({
  id: 9800,
  name: "QoreChain testnet (diana)",
  nativeCurrency: { name: "QOR", symbol: "QOR", decimals: 18 },
  rpcUrls: { default: { http: [NET.evm] } },
});

export const publicClient = createPublicClient({ chain: qoreTestnet, transport: http(NET.evm) });

export const walletFor = (privateKey: `0x${string}`) =>
  createWalletClient({ account: privateKeyToAccount(privateKey), chain: qoreTestnet, transport: http(NET.evm) });

const KEYS_DIR = join(import.meta.dir, "..", ".keys");

export function saveKeyFile(name: string, data: Record<string, string>): void {
  if (!existsSync(KEYS_DIR)) mkdirSync(KEYS_DIR, { recursive: true });
  const file = join(KEYS_DIR, `${name}.json`);
  if (existsSync(file)) throw new Error(`${file} already exists; refusing to overwrite a key`);
  writeFileSync(file, JSON.stringify(data, null, 2), { mode: 0o600 });
}

export async function loadAccount(name: string): Promise<UnifiedAccount> {
  const file = join(KEYS_DIR, `${name}.json`);
  if (!existsSync(file)) throw new Error(`no key file for "${name}": run bun src/accounts.ts new ${name}`);
  const k = JSON.parse(readFileSync(file, "utf8")) as { mnemonic?: string; privateKey?: string; recoveryCode?: string };
  if (k.mnemonic) return deriveUnifiedAccount(k.mnemonic, 0);
  if (!k.privateKey || !k.recoveryCode || !isValidRecoveryCode(k.recoveryCode)) {
    throw new Error(`${file} needs a mnemonic, or a privateKey with a valid QRC1 recoveryCode`);
  }
  return unifiedAccountFromSeed(Uint8Array.from(Buffer.from(k.privateKey.slice(2), "hex")), { recoveryCode: k.recoveryCode });
}

async function getJson<T>(path: string): Promise<T | undefined> {
  const res = await fetch(`${NET.rest}${path}`);
  if (res.status === 404) return undefined;
  if (!res.ok) throw new Error(`GET ${path}: HTTP ${res.status}`);
  return (await res.json()) as T;
}

export async function uqorBalance(address: string): Promise<bigint> {
  const b = await getJson<{ balances: { denom: string; amount: string }[] }>(`/cosmos/bank/v1beta1/balances/${address}`);
  return BigInt(b?.balances.find((x) => x.denom === "uqor")?.amount ?? "0");
}

export async function broadcast(
  acc: UnifiedAccount,
  messages: EncodeObject[],
  mode: "hybrid" | "classical" = "hybrid",
  memo = "",
): Promise<{ hash: string; code: number; rawLog?: string; msgResponses?: unknown[]; events?: unknown[] }> {
  const a = await getJson<{ account: Record<string, unknown> }>(`/cosmos/auth/v1beta1/accounts/${acc.cosmos}`);
  if (!a) throw new Error(`${acc.cosmos} does not exist on chain yet: fund it from the faucet first`);
  const base = (a.account.base_account ?? a.account) as Record<string, string>;
  const signer = new EthNativeSigner(acc, { signMode: mode, rest: NET.rest });
  const transport = await StargateClient.connect(NET.rpc);
  try {
    const res = await signer.signAndBroadcast(transport, {
      chainId: NET.chainId,
      accountNumber: BigInt(base.account_number ?? "0"),
      sequence: BigInt(base.sequence ?? "0"),
      memo,
      messages,
      fee: { amount: [{ denom: "uqor", amount: "150000" }], gas: "1000000" },
    });
    return { hash: res.transactionHash, code: res.code, rawLog: res.rawLog, msgResponses: res.msgResponses, events: res.events };
  } finally {
    transport.disconnect();
  }
}

export async function txEvents(hash: string): Promise<unknown[]> {
  for (let i = 0; i < 20; i++) {
    const t = await getJson<{ tx_response: { events: unknown[] } }>(`/cosmos/tx/v1beta1/txs/${hash}`);
    if (t) return t.tx_response.events;
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error(`tx ${hash} not found after 30 s`);
}

export function pass(label: string, ok: boolean, detail = ""): boolean {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  (${detail})` : ""}`);
  if (!ok) process.exitCode = 1;
  return ok;
}
```

- [ ] **Step 6: Write `engine/spikes/src/accounts.ts`**

```ts
// Create, show and register spike accounts.
//   bun src/accounts.ts new <name> [--seed]   mnemonic account, or --seed: privateKey + QRC1 recovery code
//   bun src/accounts.ts show <name...>        addresses, QOR balance, ML-DSA-87 key status
//   bun src/accounts.ts register <name>       register the account's ML-DSA-87 key (classical tx, once)
import { randomBytes } from "node:crypto";
import {
  buildRegisterPqcKeyMsg,
  fetchPqcStatus,
  generateMnemonic,
  generatePqcRecoveryCode,
  signProofOfPossession,
} from "@qorechain/sdk";
import { NET, broadcast, loadAccount, saveKeyFile, uqorBalance } from "./lib.ts";

const [cmd, ...args] = process.argv.slice(2);

if (cmd === "new") {
  const [name] = args;
  if (!name) throw new Error("usage: new <name> [--seed]");
  if (args.includes("--seed")) {
    saveKeyFile(name, { privateKey: `0x${randomBytes(32).toString("hex")}`, recoveryCode: generatePqcRecoveryCode() });
  } else {
    saveKeyFile(name, { mnemonic: generateMnemonic() });
  }
  const acc = await loadAccount(name);
  console.log(`${name}: ${acc.cosmos}  ${acc.evm}  (fund the qor1 address from the faucet)`);
} else if (cmd === "show") {
  for (const name of args) {
    const acc = await loadAccount(name);
    const pqc = await fetchPqcStatus({ rest: NET.rest, address: acc.cosmos });
    console.log(`${name}: ${acc.cosmos}  ${acc.evm}  ${Number(await uqorBalance(acc.cosmos)) / 1e6} QOR  ML-DSA-87: ${pqc.registered ? "registered" : "not registered"}`);
  }
} else if (cmd === "register") {
  const acc = await loadAccount(args[0]);
  const pop = signProofOfPossession({ chainId: NET.chainId, account: acc.cosmos, keypair: acc.pqc });
  const res = await broadcast(acc, [buildRegisterPqcKeyMsg(acc.cosmos, { pqcKeypair: acc.pqc, proofOfPossession: pop })], "classical", "register ML-DSA-87");
  console.log(res.code === 0 ? `registered ${res.hash}` : `REFUSED code ${res.code}: ${res.rawLog}`);
} else {
  console.log("usage: bun src/accounts.ts new <name> [--seed] | show <name...> | register <name>");
}
```

- [ ] **Step 7: Write `engine/spikes/src/window.ts`**

```ts
// Open or inspect an account's EVM window.
//   bun src/window.ts status <name>
//   bun src/window.ts open <name> [blocks] [txs] [maxUqor] [target,target,...]
import { openEvmWindowMsg } from "@qorechain/sdk";
import { evmWindowStatus } from "@qorechain/evm";
import { NET, broadcast, loadAccount } from "./lib.ts";

const [cmd, name, blocks = "600", txs = "5", maxUqor = "20000000", targets = ""] = process.argv.slice(2);
const acc = await loadAccount(name);

if (cmd === "status") {
  const w = await evmWindowStatus({ rest: NET.rest, address: acc.cosmos });
  console.log(w.found ? JSON.stringify(w, (_, v) => (typeof v === "bigint" ? v.toString() : v), 2) : "no window");
} else if (cmd === "open") {
  const allowedTargets = targets ? targets.split(",").map((t) => t.trim().toLowerCase()) : undefined;
  const msg = openEvmWindowMsg({ sender: acc.cosmos, blocks: BigInt(blocks), maxTxs: BigInt(txs), maxValue: maxUqor, allowedTargets });
  const res = await broadcast(acc, [msg], "hybrid", "open EVM window");
  console.log(res.code === 0 ? `window opened ${res.hash} (${blocks} blocks, ${txs} txs, ${maxUqor} uqor, targets: ${targets || "any"})` : `REFUSED code ${res.code}: ${res.rawLog}`);
} else {
  console.log("usage: status <name> | open <name> [blocks] [txs] [maxUqor] [targets]");
}
```

- [ ] **Step 8: Typecheck and smoke-run**

Run (in `engine/spikes/`): `bun run typecheck && bun src/accounts.ts`
Expected: no type errors; the usage line prints.

If `tsc` reports a missing export name from `@qorechain/sdk`, open `node_modules/@qorechain/sdk/dist/index.d.ts`, find the current name, and fix the import (the API names above were read from 0.14.0).

- [ ] **Step 9: Create and fund the spike accounts**

Run (in `engine/spikes/`):

```bash
bun src/accounts.ts new deployer
bun src/accounts.ts new spender
bun src/accounts.ts new relayer
bun src/accounts.ts new buyer
bun src/accounts.ts new owner
bun src/accounts.ts new operator --seed
```

Expected: six `qor1…` addresses. Paste each into the faucet (https://build.qorechain.io → Start here → Faucet, once per 24 h per account), then:

Run: `bun src/accounts.ts show deployer spender relayer buyer owner operator`
Expected: each shows a QOR balance > 0.

Then register ML-DSA-87 keys: `for n in deployer spender relayer buyer owner operator; do bun src/accounts.ts register $n; done`
Expected: `registered <hash>` six times; `show` now reports `registered`.

- [ ] **Step 10: Commit**

```bash
git add .gitignore CLAUDE.md LICENSE README.md engine/spikes/package.json engine/spikes/bun.lock engine/spikes/tsconfig.json engine/spikes/.env.example engine/spikes/src/lib.ts engine/spikes/src/accounts.ts engine/spikes/src/window.ts
git commit -m "chore(spikes): add the spike toolkit, licence and README stub"
```

---

### Task 2: Foundry project and SenderProbe

**Files:**
- Create: `sc/foundry.toml`, `sc/src/spike/SenderProbe.sol`, `sc/test/SenderProbe.t.sol`, `sc/script/DeployProbe.s.sol`

**Interfaces:**
- Produces: `SenderProbe.ping(uint256)` (selector computed by `cast sig "ping(uint256)"`), `SenderProbe.other()`, views `lastSender() returns (address)`, `lastValue() returns (uint256)`.

- [ ] **Step 1: Initialise Foundry and dependencies**

Run (repo root):

```bash
mkdir sc && cd sc
forge init --no-commit --no-git --force .
rm -f src/Counter.sol test/Counter.t.sol script/Counter.s.sol
cd .. && git submodule add https://github.com/foundry-rs/forge-std sc/lib/forge-std
git submodule add https://github.com/OpenZeppelin/openzeppelin-contracts sc/lib/openzeppelin-contracts
cd sc/lib/openzeppelin-contracts && git checkout v5.1.0 && cd ../../..
```

Expected: `sc/lib/forge-std` and `sc/lib/openzeppelin-contracts` (at tag v5.1.0) exist; `.gitmodules` created.

- [ ] **Step 2: Write `sc/foundry.toml`**

```toml
[profile.default]
src = "src"
out = "out"
libs = ["lib"]
test = "test"
script = "script"
solc_version = "0.8.28"
optimizer = true
optimizer_runs = 200
via_ir = true
remappings = [
  "forge-std/=lib/forge-std/src/",
  "@openzeppelin/contracts/=lib/openzeppelin-contracts/contracts/",
]

[fuzz]
runs = 512

[invariant]
runs = 128
depth = 64

[rpc_endpoints]
qorechain_testnet = "https://evm-testnet.qore.host"
```

- [ ] **Step 3: Write the failing test `sc/test/SenderProbe.t.sol`**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {SenderProbe} from "../src/spike/SenderProbe.sol";

contract SenderProbeTest is Test {
    function test_recordsSenderAndValue() public {
        SenderProbe p = new SenderProbe();
        address caller = makeAddr("caller");
        vm.prank(caller);
        p.ping(42);
        assertEq(p.lastSender(), caller);
        assertEq(p.lastValue(), 42);
    }

    function test_otherMarksMaxValue() public {
        SenderProbe p = new SenderProbe();
        p.other();
        assertEq(p.lastValue(), type(uint256).max);
    }
}
```

- [ ] **Step 4: Run it to verify it fails**

Run (in `sc/`): `forge test --match-contract SenderProbeTest`
Expected: compilation error, `SenderProbe.sol` not found.

- [ ] **Step 5: Write `sc/src/spike/SenderProbe.sol`**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @notice Spike-only contract: records who called it, to check how QoreChain
/// relays MsgExecuteEVM and windowed transactions. Not part of Qredit.
contract SenderProbe {
    address public lastSender;
    uint256 public lastValue;

    event Pinged(address indexed sender, uint256 value);

    function ping(uint256 value) external {
        lastSender = msg.sender;
        lastValue = value;
        emit Pinged(msg.sender, value);
    }

    function other() external {
        lastSender = msg.sender;
        lastValue = type(uint256).max;
    }
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `forge test --match-contract SenderProbeTest`
Expected: `2 passed; 0 failed`.

- [ ] **Step 7: Write `sc/script/DeployProbe.s.sol`**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {SenderProbe} from "../src/spike/SenderProbe.sol";

contract DeployProbe is Script {
    function run() external {
        vm.startBroadcast(vm.envUint("PRIVATE_KEY"));
        SenderProbe p = new SenderProbe();
        vm.stopBroadcast();
        console.log("SenderProbe", address(p));
    }
}
```

- [ ] **Step 8: Deploy the probe to testnet**

Run (in `engine/spikes/`): `bun src/window.ts open deployer 600 3 20000000`
Expected: `window opened …` (no targets: deployment needs an unscoped window).

Write the deployer's private key to a gitignored file instead of the shell history (Task 1 Step 2 added `sc/.deployer.key` to `.gitignore`):

Run (in `engine/spikes/`): `bun -e 'import {loadAccount} from "./src/lib.ts"; console.log((await loadAccount("deployer")).privateKey)' > ../../sc/.deployer.key && git check-ignore ../../sc/.deployer.key`
Expected: the path is printed by `git check-ignore` (ignored).

Run (in `sc/`): `PRIVATE_KEY=$(cat .deployer.key) forge script script/DeployProbe.s.sol --rpc-url qorechain_testnet --broadcast`
Expected: `SenderProbe 0x…`. Put that address in `engine/spikes/.env` as `PROBE_ADDRESS=0x…`.

- [ ] **Step 9: Commit**

```bash
git add .gitignore .gitmodules sc/foundry.toml sc/lib sc/src/spike/SenderProbe.sol sc/test/SenderProbe.t.sol sc/script/DeployProbe.s.sol
git commit -m "feat(contracts): add the Foundry project and the SenderProbe spike contract"
```

---

### Task 3: S6 — operator with only its classical key, inside a scoped window

**Files:**
- Create: `engine/spikes/src/s6-operator.ts`

**Interfaces:**
- Consumes: `loadAccount`, `broadcast`, `walletFor`, `publicClient`, `pass` (Task 1); `PROBE_ADDRESS` (Task 2).
- Produces: answer to S6 in `engine/spikes/RESULTS.md` (Task 9): runtime with only `OPERATOR_PRIVATE_KEY` can call the allowed target; a call to another target is refused; window length limit.

- [ ] **Step 1: Write `engine/spikes/src/s6-operator.ts`**

```ts
// S6: can an operator act with ONLY its classical private key, inside a scoped
// window that only the owner (holding the ML-DSA-87 recovery code) can open?
//   bun src/s6-operator.ts open      owner side: hybrid tx, window scoped to PROBE_ADDRESS
//   bun src/s6-operator.ts run       runtime side: reads only OPERATOR_PRIVATE_KEY
import { openEvmWindowMsg } from "@qorechain/sdk";
import { MAX_EVM_WINDOW_BLOCKS } from "@qorechain/evm";
import { encodeFunctionData, parseAbi } from "viem";
import { broadcast, loadAccount, pass, publicClient, walletFor } from "./lib.ts";

const probeAbi = parseAbi(["function ping(uint256)", "function lastSender() view returns (address)"]);
const erc20Abi = parseAbi(["function transfer(address,uint256) returns (bool)"]);
const PROBE = process.env.PROBE_ADDRESS as `0x${string}`;
const FUSD = "0x97143B771D34ddb9130b807b135Ae675A5a963CA" as const;
if (!PROBE) throw new Error("set PROBE_ADDRESS in engine/spikes/.env");

const cmd = process.argv[2];

if (cmd === "open") {
  const op = await loadAccount("operator");
  // Try the longest window first, to learn the real limit.
  const msg = openEvmWindowMsg({ sender: op.cosmos, blocks: MAX_EVM_WINDOW_BLOCKS, maxTxs: 20n, maxValue: "50000000", allowedTargets: [PROBE.toLowerCase()] });
  const res = await broadcast(op, [msg], "hybrid", "S6 scoped window");
  pass(`open a ${MAX_EVM_WINDOW_BLOCKS}-block window scoped to the probe`, res.code === 0, res.code === 0 ? res.hash : res.rawLog);
} else if (cmd === "run") {
  const key = process.env.OPERATOR_PRIVATE_KEY as `0x${string}` | undefined;
  if (!key) throw new Error("set OPERATOR_PRIVATE_KEY (only the classical key) in engine/spikes/.env");
  const w = walletFor(key);
  const hash = await w.sendTransaction({ to: PROBE, data: encodeFunctionData({ abi: probeAbi, functionName: "ping", args: [6n] }) });
  const rcpt = await publicClient.waitForTransactionReceipt({ hash });
  const sender = await publicClient.readContract({ address: PROBE, abi: probeAbi, functionName: "lastSender" });
  pass("classical key alone calls the allowed target", rcpt.status === "success", hash);
  pass("msg.sender is the operator's 0x address", sender.toLowerCase() === w.account.address.toLowerCase(), sender);
  try {
    const bad = await w.sendTransaction({ to: FUSD, data: encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [w.account.address, 0n] }) });
    pass("call to a target outside the window is refused", false, `was accepted: ${bad}`);
  } catch (e) {
    pass("call to a target outside the window is refused", true, String((e as Error).message).slice(0, 160));
  }
} else {
  console.log("usage: open | run");
}
```

- [ ] **Step 2: Run the owner side**

Run (in `engine/spikes/`): `bun src/s6-operator.ts open`
Expected: `PASS  open a 17280-block window …`. If it fails on the block count, rerun with a smaller value by editing `MAX_EVM_WINDOW_BLOCKS` to `7200n` and note the accepted maximum.

- [ ] **Step 3: Run the runtime side with only the classical key**

Copy the `privateKey` value (not the recovery code) from `engine/spikes/.keys/operator.json` into `engine/spikes/.env` as `OPERATOR_PRIVATE_KEY=0x…`.

Run: `bun --env-file=.env src/s6-operator.ts run`
Expected: three `PASS` lines. Record the tx hashes.

- [ ] **Step 4: Record the block time**

Run: `curl -s https://rpc-testnet.qore.host/block | head -c 400` twice, 60 s apart, and compute seconds per block from the heights. Write it down for `RESULTS.md` (window hours = blocks × seconds per block ÷ 3600).

- [ ] **Step 5: Commit**

```bash
git add engine/spikes/src/s6-operator.ts
git commit -m "test(spikes): S6, a classical-key-only operator inside a scoped window"
```

---

### Task 4: S1 — linked agent key through MsgExecuteEVM

**Files:**
- Create: `engine/spikes/src/s1-authenticator.ts`

**Interfaces:**
- Consumes: Task 1 helpers; `PROBE_ADDRESS`.
- Produces: answer to S1: `msg.sender` seen by the contract; whether `allowed_evm_calls` with a selector refuses another function; the working key scheme and permission.

- [ ] **Step 1: Write `engine/spikes/src/s1-authenticator.ts`**

```ts
// S1: a linked ed25519 agent key acts for the spender account through MsgExecuteEVM.
//   bun src/s1-authenticator.ts link    spender links the key: permission "evm", rule allows only probe/ping
//   bun src/s1-authenticator.ts run     agent signs, relayer broadcasts: ping (allowed) and other (not allowed)
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ed25519 } from "@noble/curves/ed25519";
import {
  buildPhantomExecuteEvm,
  decodeAuthenticatorExecutions,
  fetchAuthNonce,
  linkAuthenticatorMsgs,
  resolveEvmAuthDigestVersion,
  signAuthenticatorLinkEd25519,
} from "@qorechain/sdk";
import { encodeFunctionData, parseAbi, toFunctionSelector } from "viem";
import { NET, broadcast, loadAccount, pass, publicClient, saveKeyFile, txEvents } from "./lib.ts";

const PROBE = process.env.PROBE_ADDRESS as `0x${string}`;
if (!PROBE) throw new Error("set PROBE_ADDRESS in engine/spikes/.env");
const probeAbi = parseAbi(["function ping(uint256)", "function other()", "function lastSender() view returns (address)", "function lastValue() view returns (uint256)"]);

const keyFile = join(import.meta.dir, "..", ".keys", "agent-ed25519.json");
if (!existsSync(keyFile)) saveKeyFile("agent-ed25519", { privateKey: Buffer.from(ed25519.utils.randomPrivateKey()).toString("hex") });
const sk = Uint8Array.from(Buffer.from((JSON.parse(readFileSync(keyFile, "utf8")) as { privateKey: string }).privateKey, "hex"));
const pk = ed25519.getPublicKey(sk);
const wallet = { publicKey: pk, async signMessage(m: Uint8Array) { return { signature: ed25519.sign(m, sk) }; } };

const cmd = process.argv[2];
const spender = await loadAccount("spender");

if (cmd === "link") {
  const proof = signAuthenticatorLinkEd25519({ chainId: NET.chainId, account: spender.cosmos, privateKey: sk });
  const pingSel = toFunctionSelector("ping(uint256)");
  const msgs = linkAuthenticatorMsgs({
    owner: spender.cosmos,
    chainId: NET.chainId,
    ...proof,
    permissions: ["evm"],
    expiryUnix: Math.floor(Date.now() / 1000) + 7 * 24 * 3600,
    label: "qredit-s1",
    spendingRule: {
      id: "agent",
      enabled: true,
      perTxLimit: "1000000",
      dailyLimit: "5000000",
      allowedDenoms: ["uqor"],
      allowedEvmCalls: [`${PROBE.toLowerCase()}/${pingSel}`],
    },
  });
  const res = await broadcast(spender, msgs, "hybrid", "S1 link agent key");
  pass("link ed25519 key with permission evm and a selector rule", res.code === 0, res.code === 0 ? res.hash : res.rawLog);
} else if (cmd === "run") {
  const relayer = await loadAccount("relayer");
  const digestVersion = await resolveEvmAuthDigestVersion({ rest: NET.rest });
  const call = async (data: `0x${string}`) => {
    const { nonce } = await fetchAuthNonce({ rest: NET.rest, address: spender.cosmos, pubkey: pk });
    const msg = await buildPhantomExecuteEvm({ wallet, relayer: relayer.cosmos, chainId: NET.chainId, account: spender.cosmos, to: PROBE, value: "0", data: Buffer.from(data.slice(2), "hex"), gasLimit: 200000, nonce, digestVersion });
    const res = await broadcast(relayer, [msg], "hybrid", "S1 execute");
    if (res.code !== 0) return { ok: false, why: res.rawLog ?? `code ${res.code}`, hash: res.hash };
    const events = await txEvents(res.hash);
    const [x] = decodeAuthenticatorExecutions({ msgResponses: [] as never, events: events as never }, [msg]);
    return { ok: !!x?.success, why: x?.reason || x?.vmError || "", hash: res.hash };
  };
  const ping = await call(encodeFunctionData({ abi: probeAbi, functionName: "ping", args: [7n] }));
  pass("agent key calls probe.ping through the relayer", ping.ok, `${ping.hash} ${ping.why}`);
  const sender = await publicClient.readContract({ address: PROBE, abi: probeAbi, functionName: "lastSender" });
  pass("msg.sender is the spender's 0x address", sender.toLowerCase() === spender.evm.toLowerCase(), `${sender} vs ${spender.evm}`);
  const other = await call(encodeFunctionData({ abi: probeAbi, functionName: "other" }));
  pass("probe.other is refused by the selector rule", !other.ok, `${other.hash} ${other.why}`);
  const value = await publicClient.readContract({ address: PROBE, abi: probeAbi, functionName: "lastValue" });
  pass("probe state unchanged by the refused call", value === 7n, `lastValue ${value}`);
} else {
  console.log("usage: link | run");
}
```

- [ ] **Step 2: Typecheck**

Run (in `engine/spikes/`): `bun run typecheck`
Expected: no errors. If `allowedEvmCalls` is rejected by the `SpendingRuleInput` type, check `SpendingRule` in `node_modules/@qorechain/sdk/dist/index.d.ts` (field `allowedEvmCalls: string[]` in 0.14.0) and match its spelling.

- [ ] **Step 3: Link and run**

Run: `bun --env-file=.env src/s1-authenticator.ts link && bun --env-file=.env src/s1-authenticator.ts run`
Expected: five `PASS` lines. If `link` is refused because of the permission, retry with `permissions: ["evm", "send"]` and record which set worked. If `msg.sender` is not the spender's address, record what it is — that triggers the S1 fallback in the spec (spender authorizes payments with an ML-DSA signature checked by the vault).

- [ ] **Step 4: Commit**

```bash
git add engine/spikes/src/s1-authenticator.ts
git commit -m "test(spikes): S1, a linked agent key calling a contract through MsgExecuteEVM"
```

---

### Task 5: S3 — ML-DSA message signature verified by pqcVerify

**Files:**
- Create: `engine/spikes/src/s3-message-sig.ts`, `engine/spikes/web/index.html`

**Interfaces:**
- Consumes: Task 1 helpers.
- Produces: confirmation that `pqcVerify(pubkey, mlDsaSig, "qorechain-msg-v1|qorechain-diana|" + text)` returns true for (a) a script signature and (b) a QoreX `signArbitrary` signature; the JSON shape QoreX returns. `LoanVault.signedBytes` (Task 14) depends on this format.

- [ ] **Step 1: Write `engine/spikes/src/s3-message-sig.ts`**

```ts
// S3: is an ML-DSA-87 message signature (QoreSign format) accepted by pqcVerify?
//   bun src/s3-message-sig.ts script "<text>"       sign with the owner's key here, verify on chain
//   bun src/s3-message-sig.ts qorex <file.json>     verify a QoreX signArbitrary result saved from web/index.html
import { readFileSync } from "node:fs";
import { messagePqSignBytes, pqSign } from "@qorechain/qoresign";
import { bech32 } from "@scure/base";
import { parseAbi, toHex } from "viem";
import { NET, loadAccount, pass, publicClient } from "./lib.ts";

const PQC_VERIFY = "0x0000000000000000000000000000000000000a01" as const;
const PQC_KEYS = "0x0000000000000000000000000000000000000a02" as const;
const abi = parseAbi([
  "function pqcVerify(bytes pubkey, bytes signature, bytes message) view returns (bool)",
  "function pqcKeyStatus(address account) view returns (bool registered, uint8 algorithmId, bytes pubkey, bool possessionProven)",
]);

const evmOf = (qor: string) => toHex(Uint8Array.from(bech32.fromWords(bech32.decode(qor as `${string}1${string}`).words)));

async function check(signerQor: string, text: string, sig: Uint8Array) {
  const [registered, , pubkey, proven] = await publicClient.readContract({ address: PQC_KEYS, abi, functionName: "pqcKeyStatus", args: [evmOf(signerQor)] });
  pass("signer key registered and proven", registered && proven);
  const message = toHex(messagePqSignBytes(NET.chainId, text));
  const ok = await publicClient.readContract({ address: PQC_VERIFY, abi, functionName: "pqcVerify", args: [pubkey, toHex(sig), message] });
  pass("pqcVerify accepts the prefixed message", ok, `${sig.length}-byte signature`);
  const bad = Uint8Array.from(sig); bad[100] ^= 1;
  const okBad = await publicClient.readContract({ address: PQC_VERIFY, abi, functionName: "pqcVerify", args: [pubkey, toHex(bad), message] });
  pass("pqcVerify refuses a flipped signature byte", !okBad);
  const okRaw = await publicClient.readContract({ address: PQC_VERIFY, abi, functionName: "pqcVerify", args: [pubkey, toHex(sig), toHex(new TextEncoder().encode(text))] });
  pass("pqcVerify refuses the unprefixed text", !okRaw);
}

const [cmd, arg] = process.argv.slice(2);
if (cmd === "script") {
  const owner = await loadAccount("owner");
  const text = arg ?? "qredit-order-v1:0x00";
  await check(owner.cosmos, text, pqSign(owner.pqc.secretKey, messagePqSignBytes(NET.chainId, text)));
} else if (cmd === "qorex") {
  const j = JSON.parse(readFileSync(arg, "utf8")) as { signer: string; data: string; sig: { pq?: { signature: string } } };
  console.log("QoreX result keys:", Object.keys(j.sig));
  if (!j.sig.pq) throw new Error("no pq part in the QoreX signature: record the shape in RESULTS.md");
  await check(j.signer, j.data, Uint8Array.from(Buffer.from(j.sig.pq.signature, "base64")));
} else {
  console.log('usage: script "<text>" | qorex <file.json>');
}
```

Run (in `engine/spikes/`): `bun add @scure/base@1`
Expected: installed (it is already a dependency of the SDK; this pins it for direct use).

- [ ] **Step 2: Run the script path**

Run: `bun src/s3-message-sig.ts script "qredit-order-v1:0x1234"`
Expected: four `PASS` lines.

- [ ] **Step 3: Write `engine/spikes/web/index.html` (QoreX probe for S2a, S3a, S4a)**

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Qredit spike: QoreX probe</title>
  <style>
    body { font: 15px/1.5 system-ui, sans-serif; max-width: 900px; margin: 24px auto; padding: 0 16px; }
    button { margin: 4px 8px 4px 0; padding: 6px 12px; }
    input { width: 100%; padding: 6px; margin: 4px 0 12px; font-family: monospace; }
    pre { background: #f4f4f4; padding: 12px; white-space: pre-wrap; word-break: break-all; }
  </style>
</head>
<body>
  <h1>QoreX probe</h1>
  <p>Install QoreX, switch it to Testnet, then use the buttons. Copy the output into <code>engine/spikes/out/</code>.</p>
  <button id="caps">1. Capabilities and methods (S2a, S4a)</button>
  <label>Text to sign (S3a)</label>
  <input id="text" value="qredit-order-v1:0x1234" />
  <button id="sign">2. signArbitrary (S3a)</button>
  <pre id="out"></pre>
  <script type="module">
    const CHAIN = "qorechain-diana";
    const out = (x) => {
      document.getElementById("out").textContent +=
        (typeof x === "string" ? x : JSON.stringify(x, (_, v) => (v instanceof Uint8Array ? `0x${[...v].map((b) => b.toString(16).padStart(2, "0")).join("")}` : v), 2)) + "\n";
    };
    const native = async () => {
      const q = window.qorex?.native;
      if (!q) throw new Error("window.qorex.native not found: install QoreX, switch to Testnet, reload");
      await q.enable(CHAIN);
      return q;
    };
    document.getElementById("caps").onclick = async () => {
      try {
        const q = window.qorex;
        out({
          qorexKeys: q ? Object.keys(q) : null,
          nativeMethods: q?.native ? Object.keys(q.native) : null,
          capabilities: q?.native?.capabilities ?? null,
          evmProvider: !!(q?.ethereum || window.ethereum),
        });
        out(await (await native()).getKey(CHAIN));
      } catch (e) { out(`ERROR ${e.message}`); }
    };
    document.getElementById("sign").onclick = async () => {
      try {
        const q = await native();
        const { bech32Address } = await q.getKey(CHAIN);
        const data = document.getElementById("text").value.trim();
        const sig = await q.signArbitrary(CHAIN, bech32Address, data);
        out({ signer: bech32Address, data, sig });
      } catch (e) { out(`ERROR ${e.message}`); }
    };
  </script>
</body>
</html>
```

- [ ] **Step 4: Run the QoreX path (manual)**

Run (repo root): `python -m http.server 5173 -d engine/spikes/web`
Open http://localhost:5173 in Chrome with the QoreX extension on Testnet (the QoreX account must have its ML-DSA-87 key registered: QoreX does this on first testnet use; fund it from the faucet). Click **1**, then **2**, approve in QoreX. Save the JSON object printed by **2** (`{ signer, data, sig }`) to `engine/spikes/out/qorex-sig.json`.

Run (in `engine/spikes/`): `bun src/s3-message-sig.ts qorex out/qorex-sig.json`
Expected: four `PASS` lines. If the `sig` object has another shape, record it in `RESULTS.md`, adapt the `qorex` branch to read the ML-DSA bytes, and rerun.

- [ ] **Step 5: Commit**

```bash
git add engine/spikes/src/s3-message-sig.ts engine/spikes/web/index.html engine/spikes/package.json engine/spikes/bun.lock
git commit -m "test(spikes): S3, ML-DSA-87 message signatures checked by pqcVerify"
```

---

### Task 6: S2 — registering a buyer's ML-KEM key

**Files:**
- Modify: `engine/spikes/RESULTS.md` is written in Task 9; this task only runs checks.

**Interfaces:**
- Produces: answer to S2: (a) whether QoreX exposes a method that can sign an arbitrary Cosmos message (`MsgRegisterKEMKey`); (b) that the script path (official example) registers a KEM key.

- [ ] **Step 1: S2a — read the QoreX method list**

From the output of button **1** in Task 5 Step 4, note every method under `nativeMethods` and every entry in `capabilities`. S2a passes if there is a method that signs and broadcasts (or signs a `SignDoc` for) an arbitrary message, such as `signDirect`, `signAmino` or `sendTx`. Write the list to `engine/spikes/out/qorex-caps.json`.

- [ ] **Step 2: S2b — run the official QoreSeal example for a script buyer**

Run (outside the repo, in a fresh folder):

```bash
git clone --depth 1 https://github.com/qorechain/build-before-qday.git /tmp/bbq && cd /tmp/bbq/workshop-3/01-qoreseal
npm ci
node seal.mjs init alice
node seal.mjs whoami
```

Fund Alice's `qor1…` address from the faucet, then:

Run: `node seal.mjs register alice && node seal.mjs lookup alice`
Expected: two transactions (ML-DSA-87 key, then ML-KEM-1024 key) and `card valid`. Record the KEM registration tx hash. This proves the fallback path (buyers created by script).

- [ ] **Step 3: No commit** (nothing in the repo changed; results go to `RESULTS.md` in Task 9).

---

### Task 7: S4 and S5 — fUSD facts and the buyer's EVM path

**Files:**
- Create: `engine/spikes/src/s5-fusd.ts`, `engine/spikes/src/s4-buyer.ts`

**Interfaces:**
- Consumes: Task 1 helpers; `PROBE_ADDRESS`.
- Produces: fUSD `decimals`, faucet amounts, whether a native AMM swap gives fUSD; whether a buyer can `approve` and `transfer` fUSD through a window scoped to two targets, and the QOR cost.

- [ ] **Step 1: Write `engine/spikes/src/s5-fusd.ts`**

```ts
// S5: fUSD facts and balances; optional swap of test QOR into fUSD through the native AMM (pool 2).
//   bun src/s5-fusd.ts info <name...>
//   bun src/s5-fusd.ts swap <name> <uqor>
import { msg } from "@qorechain/sdk";
import { formatUnits, parseAbi } from "viem";
import { broadcast, loadAccount, pass, publicClient, uqorBalance } from "./lib.ts";

const FUSD = "0x97143B771D34ddb9130b807b135Ae675A5a963CA" as const;
const abi = parseAbi(["function decimals() view returns (uint8)", "function symbol() view returns (string)", "function balanceOf(address) view returns (uint256)"]);

const [cmd, ...args] = process.argv.slice(2);
const decimals = await publicClient.readContract({ address: FUSD, abi, functionName: "decimals" });
const symbol = await publicClient.readContract({ address: FUSD, abi, functionName: "symbol" });

if (cmd === "info") {
  console.log(`token ${symbol} decimals ${decimals}`);
  for (const name of args) {
    const acc = await loadAccount(name);
    const bal = await publicClient.readContract({ address: FUSD, abi, functionName: "balanceOf", args: [acc.evm as `0x${string}`] });
    console.log(`${name}: ${formatUnits(bal, decimals)} ${symbol}  ${Number(await uqorBalance(acc.cosmos)) / 1e6} QOR`);
  }
} else if (cmd === "swap") {
  const [name, uqor] = args;
  const acc = await loadAccount(name);
  const before = await publicClient.readContract({ address: FUSD, abi, functionName: "balanceOf", args: [acc.evm as `0x${string}`] });
  const swap = msg.amm.swapExactIn({ sender: acc.cosmos, poolId: 2n, tokenIn: { denom: "uqor", amount: uqor }, denomOut: `erc20:${FUSD}`, minOut: "1" });
  const res = await broadcast(acc, [swap], "hybrid", "S5 swap QOR to fUSD");
  pass("native AMM swap QOR → fUSD", res.code === 0, res.code === 0 ? res.hash : res.rawLog);
  await new Promise((r) => setTimeout(r, 6000));
  const after = await publicClient.readContract({ address: FUSD, abi, functionName: "balanceOf", args: [acc.evm as `0x${string}`] });
  pass("fUSD balance increased", after > before, `${formatUnits(before, decimals)} → ${formatUnits(after, decimals)}`);
} else {
  console.log("usage: info <name...> | swap <name> <uqor>");
}
```

- [ ] **Step 2: Run S5**

Claim fUSD for `buyer` and `owner` from the fest faucet (it gives fUSD, fETH and fBTC with the QOR claim). Then:

Run (in `engine/spikes/`): `bun src/s5-fusd.ts info buyer owner deployer && bun src/s5-fusd.ts swap deployer 100000`
Expected: decimals printed; two `PASS` lines for the swap. Record decimals, the fUSD amount one faucet claim gives, and the swap rate.

- [ ] **Step 3: Write `engine/spikes/src/s4-buyer.ts`**

```ts
// S4: can a buyer approve and move fUSD through a window scoped to [fUSD, probe]?
//   bun src/s4-buyer.ts open    buyer opens the scoped window (hybrid)
//   bun src/s4-buyer.ts run     approve + transfer with the buyer's EVM key, report QOR spent
import { openEvmWindowMsg } from "@qorechain/sdk";
import { parseAbi } from "viem";
import { broadcast, loadAccount, pass, publicClient, uqorBalance, walletFor } from "./lib.ts";

const FUSD = "0x97143B771D34ddb9130b807b135Ae675A5a963CA" as const;
const PROBE = process.env.PROBE_ADDRESS as `0x${string}`;
const abi = parseAbi(["function approve(address,uint256) returns (bool)", "function transfer(address,uint256) returns (bool)", "function allowance(address,address) view returns (uint256)"]);

const buyer = await loadAccount("buyer");
const cmd = process.argv[2];

if (cmd === "open") {
  const m = openEvmWindowMsg({ sender: buyer.cosmos, blocks: 600n, maxTxs: 4n, maxValue: "20000000", allowedTargets: [FUSD.toLowerCase(), PROBE.toLowerCase()] });
  const res = await broadcast(buyer, [m], "hybrid", "S4 buyer window");
  pass("buyer opens a window scoped to fUSD and the probe", res.code === 0, res.code === 0 ? res.hash : res.rawLog);
} else if (cmd === "run") {
  const w = walletFor(buyer.privateKey as `0x${string}`);
  const q0 = await uqorBalance(buyer.cosmos);
  const a = await w.writeContract({ address: FUSD, abi, functionName: "approve", args: [PROBE, 10n ** 15n] });
  pass("approve through the window", (await publicClient.waitForTransactionReceipt({ hash: a })).status === "success", a);
  const t = await w.writeContract({ address: FUSD, abi, functionName: "transfer", args: [PROBE, 10n ** 15n] });
  pass("transfer through the window", (await publicClient.waitForTransactionReceipt({ hash: t })).status === "success", t);
  const q1 = await uqorBalance(buyer.cosmos);
  console.log(`QOR spent on two EVM txs: ${Number(q0 - q1) / 1e6}`);
} else {
  console.log("usage: open | run");
}
```

- [ ] **Step 4: Run S4 (script) and S4a (QoreX, manual)**

Run: `bun --env-file=.env src/s4-buyer.ts open && bun --env-file=.env src/s4-buyer.ts run`
Expected: three `PASS` lines and the QOR cost.

Manual S4a: in QoreX (Testnet), try to send 0.001 fUSD to any address through the wallet's EVM side. Note whether QoreX asks to open a window, how many approvals it takes, and whether it lets you scope it. Write this down for `RESULTS.md`.

- [ ] **Step 5: Commit**

```bash
git add engine/spikes/src/s5-fusd.ts engine/spikes/src/s4-buyer.ts
git commit -m "test(spikes): S4 and S5, fUSD facts and the buyer's EVM path"
```

---

### Task 8: Testnet smoke of the policy-order format (after Task 17)

Steps 1–2 can be written now; Step 3 runs after the factory is deployed (Task 17 Step 6). It closes S3 against the real vault code. Task 9 records S3 from Task 5 first and is updated after this task runs.

**Files:**
- Create: `sc/script/CreateSmokeVault.s.sol`, `engine/spikes/src/s3-apply-order.ts`

**Interfaces:**
- Consumes: `VaultFactory.create(LoanVault.Init)` (Task 17) and `LoanVault.orderText`, `LoanVault.applyOrder`, `LoanVault.policyNonce`, `LoanVault.paused` (Task 11).
- Produces: a vault on testnet whose `applyOrder` accepted a real ML-DSA-87 signature from a script and from QoreX.

- [ ] **Step 1: Write `sc/script/CreateSmokeVault.s.sol`**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {LoanVault} from "../src/LoanVault.sol";
import {VaultFactory} from "../src/VaultFactory.sol";

/// Creates a small vault on testnet to check applyOrder with real ML-DSA-87 signatures.
/// Env: PRIVATE_KEY, FACTORY, OWNER_PQ (the 0x address of the signing account), SPENDER, OPERATOR.
contract CreateSmokeVault is Script {
    function run() external {
        address[] memory sup = new address[](1);
        sup[0] = vm.envAddress("SPENDER"); // any address works as a listed supplier for the smoke test
        uint256[] memory caps = new uint256[](1);
        caps[0] = 1e18;
        uint256[] memory prices = new uint256[](1);
        prices[0] = 1e17;
        LoanVault.Init memory init = LoanVault.Init({
            token: IERC20(0x97143B771D34ddb9130b807b135Ae675A5a963CA),
            spender: vm.envAddress("SPENDER"),
            operator: vm.envAddress("OPERATOR"),
            ownerPq: vm.envAddress("OWNER_PQ"),
            ownerPayout: vm.envAddress("OWNER_PQ"),
            cosmosChainId: "qorechain-diana",
            lenderBps: 3000,
            ownerBps: 2000,
            dailyCap: 5e18,
            orderTtl: 1 hours,
            loan: LoanVault.LoanTerms({
                target: 1e18,
                totalOwed: 11e17,
                raiseDeadline: uint64(block.timestamp + 30 days),
                period: 1 days,
                grace: 1 days,
                installment: 1e17
            }),
            suppliers: sup,
            supplierCaps: caps,
            servicePrices: prices
        });
        vm.startBroadcast(vm.envUint("PRIVATE_KEY"));
        LoanVault v = VaultFactory(vm.envAddress("FACTORY")).create(init);
        vm.stopBroadcast();
        console.log("SmokeVault", address(v));
    }
}
```

- [ ] **Step 2: Write `engine/spikes/src/s3-apply-order.ts`**

```ts
// S3 against the real vault: sign a PAUSE order and submit it with applyOrder.
//   bun src/s3-apply-order.ts text <vault>                    print the text to sign (nonce, expiry) for QoreX
//   bun src/s3-apply-order.ts script <vault>                  sign with spikes owner key and submit
//   bun src/s3-apply-order.ts qorex <vault> <file.json> <expiry>   submit a QoreX signature of the printed text
import { readFileSync } from "node:fs";
import { messagePqSignBytes, pqSign } from "@qorechain/qoresign";
import { hexToString, parseAbi, toHex } from "viem";
import { NET, loadAccount, pass, publicClient, walletFor } from "./lib.ts";

const abi = parseAbi([
  "error BadPqcSignature()",
  "struct PolicyOrder { uint8 kind; address target; uint256 value; uint64 nonce; uint64 expiry; }",
  "function orderText(PolicyOrder o) view returns (bytes)",
  "function applyOrder(PolicyOrder o, bytes sig)",
  "function policyNonce() view returns (uint64)",
  "function paused() view returns (bool)",
]);
const PAUSE = 3;
const ZERO = "0x0000000000000000000000000000000000000000" as const;

const [cmd, vaultArg, file, expiryArg] = process.argv.slice(2);
const vault = vaultArg as `0x${string}`;
const nonce = await publicClient.readContract({ address: vault, abi, functionName: "policyNonce" });
const expiry = expiryArg ? BigInt(expiryArg) : BigInt(Math.floor(Date.now() / 1000) + 1800);
const order = { kind: PAUSE, target: ZERO, value: 0n, nonce, expiry };
const text = hexToString(await publicClient.readContract({ address: vault, abi, functionName: "orderText", args: [order] }));
const submitter = walletFor((await loadAccount("deployer")).privateKey as `0x${string}`);

async function submit(sig: Uint8Array, label: string) {
  const bad = Uint8Array.from(sig); bad[50] ^= 1;
  try {
    await publicClient.simulateContract({ account: submitter.account, address: vault, abi, functionName: "applyOrder", args: [order, toHex(bad)] });
    pass("tampered signature refused", false);
  } catch (e) {
    pass("tampered signature refused", String((e as Error).message).includes("BadPqcSignature"));
  }
  const hash = await submitter.writeContract({ address: vault, abi, functionName: "applyOrder", args: [order, toHex(sig)] });
  const ok = (await publicClient.waitForTransactionReceipt({ hash })).status === "success";
  pass(`${label} signature accepted by applyOrder`, ok, hash);
  pass("vault is paused", await publicClient.readContract({ address: vault, abi, functionName: "paused" }));
}

if (cmd === "text") {
  console.log(`text:   ${text}\nexpiry: ${expiry}`);
} else if (cmd === "script") {
  const owner = await loadAccount("owner");
  await submit(pqSign(owner.pqc.secretKey, messagePqSignBytes(NET.chainId, text)), "script");
} else if (cmd === "qorex") {
  const j = JSON.parse(readFileSync(file, "utf8")) as { data: string; sig: { pq: { signature: string } } };
  if (j.data !== text) throw new Error(`the QoreX file signed "${j.data}", the vault expects "${text}"`);
  await submit(Uint8Array.from(Buffer.from(j.sig.pq.signature, "base64")), "QoreX");
} else {
  console.log("usage: text <vault> | script <vault> | qorex <vault> <file.json> <expiry>");
}
```

- [ ] **Step 3: Run it (after Task 17 Step 6 deployed the factory)**

Run (in `sc/`, deployer window open with no targets):

```bash
PRIVATE_KEY=$(cat .deployer.key) FACTORY=<factory> OWNER_PQ=<owner 0x> SPENDER=<spender 0x> OPERATOR=<operator 0x> \
  forge script script/CreateSmokeVault.s.sol --rpc-url qorechain_testnet --broadcast
```

Then (in `engine/spikes/`): `bun src/s3-apply-order.ts script <SmokeVault>`
Expected: three `PASS` lines.

For the QoreX path, create a second smoke vault with `OWNER_PQ` = the QoreX account's 0x address, run `bun src/s3-apply-order.ts text <vault2>`, paste the text into `web/index.html` button **2**, save the result to `out/qorex-order.json`, then `bun src/s3-apply-order.ts qorex <vault2> out/qorex-order.json <expiry>`.
Expected: three `PASS` lines.

- [ ] **Step 4: Commit**

```bash
git add sc/script/CreateSmokeVault.s.sol engine/spikes/src/s3-apply-order.ts
git commit -m "test(spikes): S3 on chain, applyOrder with real ML-DSA-87 signatures"
```

---

### Task 9: Spike results and go/no-go

**Files:**
- Create: `engine/spikes/RESULTS.md`
- Modify (only if a fallback is taken): `docs/superpowers/specs/2026-11-24-qredit-design.md`

- [ ] **Step 1: Write `engine/spikes/RESULTS.md`** with the real values observed (no placeholders left):

```markdown
# Spike results

Network: qorechain-diana. SDK @qorechain/sdk 0.14.0.

| # | Question | Result | Evidence (tx / output) | Decision |
|---|---|---|---|---|
| S1 | Linked agent key → MsgExecuteEVM: msg.sender, key scheme, selector rule | <PASS/FAIL + what msg.sender was, which permissions worked> | <tx hashes> | <keep design / fallback> |
| S2 | Buyer ML-KEM key registration: (a) QoreX method, (b) script path | <methods found; KEM tx> | <file / tx> | <web registration / script buyers> |
| S3 | QoreX/QoreSign ML-DSA message signature checked by pqcVerify (Task 5); applyOrder on chain (Task 8, filled in after Task 17) | <PASS/FAIL, QoreX JSON shape> | <tx hashes> | <owner signs in QoreX / owner CLI> |
| S4 | Buyer approve + transfer through a scoped window; QoreX UX | <PASS/FAIL, QOR cost, clicks> | <tx hashes> | <buyer flow> |
| S5 | fUSD decimals, faucet amount, swap QOR → fUSD | <decimals, amount, rate> | <tx> | <loan sizes and prices> |
| S6 | Classical-key-only operator in a scoped window; window limit; block time | <PASS/FAIL, max blocks, s/block, hours> | <tx hashes> | <renewal interval during judging> |
```

Fill every `<…>` with what was observed. A row with no evidence is a FAIL.

- [ ] **Step 2: Apply fallbacks to the spec, if any**

For each FAIL, edit the spec's section 11 "Spikes" row and the section it affects (S1 → sections 5 and 6; S2 → section 7; S3 → sections 6 and 8; S4 → section 8; S5 → section 6 loan sizes; S6 → section 5 "Window renewal during judging"). Keep the wording factual.

- [ ] **Step 3: Commit**

```bash
git add engine/spikes/RESULTS.md docs/superpowers/specs/2026-11-24-qredit-design.md
git commit -m "docs(spikes): record the spike results and the go/no-go"
```

---

## Phase 1 — Contracts

### Task 10: Precompile interface, mocks and shared test base

**Files:**
- Create: `sc/src/interfaces/IQorePQC.sol`, `sc/test/mocks/MockPqc.sol`, `sc/test/mocks/MockToken.sol`, `sc/test/Base.t.sol`

**Interfaces:**
- Produces:
  - `interface IQorePQC { function pqcVerify(bytes,bytes,bytes) view returns (bool); function pqcKeyStatus(address) view returns (bool registered, uint8 algorithmId, bytes pubkey, bool possessionProven); }`
  - `MockPqcVerify` — valid iff `keccak256(sig) == keccak256(abi.encodePacked(keccak256(abi.encodePacked("ok", pubkey, message))))`
  - `MockPqcKeys` — storage slot 0 `mode`: 0 registered+proven with key `hex"c0ffee"`, 1 not registered, 2 registered but not proven
  - `MockToken` — ERC-20 `fUSD` with `mint(address,uint256)`
  - `Base` (abstract test) with actors, constants, `_init()`, `_activate()`, `_buy(uint256)`, `_deliver(uint256)`, `_sell(uint256 serviceId, uint256 n)`, `_sign(LoanVault.PolicyOrder memory)`, `_order(uint8 kind, address target, uint256 value)`

The `Base` file compiles only once `LoanVault` exists (Task 11), so this task's code is written now and verified in Task 11 Step 4.

- [ ] **Step 1: Write `sc/src/interfaces/IQorePQC.sol`**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// QoreChain post-quantum precompiles (active on the qorechain-diana testnet).
/// pqcVerify lives at 0x…0a01 and pqcKeyStatus at 0x…0a02.
interface IQorePQC {
    /// ML-DSA-87 (FIPS 204) verification: 2592-byte key, 4627-byte signature.
    function pqcVerify(bytes calldata pubkey, bytes calldata signature, bytes calldata message)
        external
        view
        returns (bool valid);

    /// The ML-DSA-87 key an account registered on chain.
    function pqcKeyStatus(address account)
        external
        view
        returns (bool registered, uint8 algorithmId, bytes memory pubkey, bool possessionProven);
}
```

- [ ] **Step 2: Write `sc/test/mocks/MockPqc.sol`**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// Stand-in for pqcVerify on Foundry's local EVM. A signature is valid when it
/// equals keccak256(abi.encodePacked(keccak256(abi.encodePacked("ok", pubkey, message)))).
contract MockPqcVerify {
    function pqcVerify(bytes calldata pubkey, bytes calldata signature, bytes calldata message)
        external
        pure
        returns (bool)
    {
        return keccak256(signature) == keccak256(abi.encodePacked(keccak256(abi.encodePacked("ok", pubkey, message))));
    }
}

/// Stand-in for pqcKeyStatus. Storage slot 0 selects the answer:
/// 0 = registered and proven (key hex"c0ffee"), 1 = not registered, 2 = registered, not proven.
contract MockPqcKeys {
    uint256 internal mode;

    function pqcKeyStatus(address) external view returns (bool, uint8, bytes memory, bool) {
        if (mode == 1) return (false, 0, "", false);
        return (true, 1, hex"c0ffee", mode != 2);
    }
}
```

- [ ] **Step 3: Write `sc/test/mocks/MockToken.sol`**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockToken is ERC20 {
    constructor() ERC20("Fest USD", "fUSD") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
```

- [ ] **Step 4: Write `sc/test/Base.t.sol`**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {LoanVault} from "../src/LoanVault.sol";
import {MockPqcKeys, MockPqcVerify} from "./mocks/MockPqc.sol";
import {MockToken} from "./mocks/MockToken.sol";

abstract contract Base is Test {
    address internal constant PQC_VERIFY = 0x0000000000000000000000000000000000000a01;
    address internal constant PQC_KEYS = 0x0000000000000000000000000000000000000a02;

    uint256 internal constant TARGET = 100e18;
    uint256 internal constant OWED = 110e18;
    uint256 internal constant INSTALLMENT = 10e18;
    uint64 internal constant PERIOD = 1 days;
    uint64 internal constant GRACE = 1 days;
    uint64 internal constant TTL = 1 hours;
    uint256 internal constant DAILY = 20e18;
    uint256 internal constant CAP_A = 10e18;
    uint256 internal constant CAP_B = 2e18;
    uint16 internal constant LENDER_BPS = 3000;
    uint16 internal constant OWNER_BPS = 2000;
    // service 0: 1 fUSD, service 1: 5 fUSD, service 2: 100 fUSD
    uint256 internal constant PRICE0 = 1e18;
    uint256 internal constant PRICE1 = 5e18;
    uint256 internal constant PRICE2 = 100e18;

    MockToken internal fusd;
    LoanVault internal vault;
    uint64 internal raiseDeadline;

    address internal spender = makeAddr("spender");
    address internal operator = makeAddr("operator");
    address internal ownerPq = makeAddr("ownerPq");
    address internal ownerPayout = makeAddr("ownerPayout");
    address internal lenderA = makeAddr("lenderA");
    address internal lenderB = makeAddr("lenderB");
    address internal buyer = makeAddr("buyer");
    address internal supplierA = makeAddr("supplierA");
    address internal supplierB = makeAddr("supplierB");
    address internal stranger = makeAddr("stranger");

    function setUp() public virtual {
        vm.etch(PQC_VERIFY, address(new MockPqcVerify()).code);
        vm.etch(PQC_KEYS, address(new MockPqcKeys()).code);
        fusd = new MockToken();
        raiseDeadline = uint64(block.timestamp + 7 days);
        vault = new LoanVault(_init());
        address[3] memory funded = [lenderA, lenderB, buyer];
        for (uint256 i; i < funded.length; i++) {
            fusd.mint(funded[i], 10_000e18);
            vm.prank(funded[i]);
            fusd.approve(address(vault), type(uint256).max);
        }
    }

    function _init() internal view returns (LoanVault.Init memory i) {
        address[] memory sup = new address[](2);
        sup[0] = supplierA;
        sup[1] = supplierB;
        uint256[] memory caps = new uint256[](2);
        caps[0] = CAP_A;
        caps[1] = CAP_B;
        uint256[] memory prices = new uint256[](3);
        prices[0] = PRICE0;
        prices[1] = PRICE1;
        prices[2] = PRICE2;
        i = LoanVault.Init({
            token: IERC20(address(fusd)),
            spender: spender,
            operator: operator,
            ownerPq: ownerPq,
            ownerPayout: ownerPayout,
            cosmosChainId: "qorechain-diana",
            lenderBps: LENDER_BPS,
            ownerBps: OWNER_BPS,
            dailyCap: DAILY,
            orderTtl: TTL,
            loan: LoanVault.LoanTerms({
                target: TARGET,
                totalOwed: OWED,
                raiseDeadline: raiseDeadline,
                period: PERIOD,
                grace: GRACE,
                installment: INSTALLMENT
            }),
            suppliers: sup,
            supplierCaps: caps,
            servicePrices: prices
        });
    }

    function _activate() internal {
        vm.prank(lenderA);
        vault.deposit(60e18);
        vm.prank(lenderB);
        vault.deposit(40e18);
    }

    function _buy(uint256 serviceId) internal returns (uint256 id) {
        vm.prank(buyer);
        id = vault.buy(serviceId, keccak256(abi.encode("request", serviceId, block.timestamp)));
    }

    function _deliver(uint256 id) internal {
        vm.prank(operator);
        vault.deliver(id, keccak256(abi.encode("envelope", id)));
    }

    function _sell(uint256 serviceId, uint256 n) internal {
        for (uint256 k; k < n; k++) {
            _deliver(_buy(serviceId));
        }
    }

    function _order(uint8 kind, address target, uint256 value) internal view returns (LoanVault.PolicyOrder memory) {
        return LoanVault.PolicyOrder({
            kind: kind,
            target: target,
            value: value,
            nonce: vault.policyNonce(),
            expiry: uint64(block.timestamp + 1 hours)
        });
    }

    function _sign(LoanVault.PolicyOrder memory o) internal view returns (bytes memory) {
        return abi.encodePacked(keccak256(abi.encodePacked("ok", hex"c0ffee", vault.signedBytes(o))));
    }
}
```

- [ ] **Step 5: No commit yet** — these files are committed with Task 11, when they first compile.

---

### Task 11: LoanVault — construction, raising, refund, state

**Files:**
- Create: `sc/src/LoanVault.sol`, `sc/test/LoanVault.Raising.t.sol`

**Interfaces:**
- Consumes: Task 10 files.
- Produces (used by every later task):
  - `enum State { Raising, Active, Trapped, Repaid, Refunded }`, `enum OrderStatus { None, Open, Delivered, Declined, Reclaimed }`
  - `struct LoanTerms { uint256 target; uint256 totalOwed; uint64 raiseDeadline; uint64 period; uint64 grace; uint256 installment; }`
  - `struct Init { IERC20 token; address spender; address operator; address ownerPq; address ownerPayout; string cosmosChainId; uint16 lenderBps; uint16 ownerBps; uint256 dailyCap; uint64 orderTtl; LoanTerms loan; address[] suppliers; uint256[] supplierCaps; uint256[] servicePrices; }`
  - `struct PolicyOrder { uint8 kind; address target; uint256 value; uint64 nonce; uint64 expiry; }`
  - `constructor(Init memory)`, `deposit(uint256)`, `refund()`, `state() view returns (State)`, `expectedRepaid(uint256 t) view returns (uint256)`, `books() view returns (uint256 escrow, uint256 lenders, uint256 ownerOwed, uint256 opex, uint256 held)`
  - Public getters: `token, spender, operator, ownerPq, ownerPayout, lenderBps, ownerBps, orderTtl, cosmosChainId, loan, suppliers(address), servicePrice(uint256), serviceCount, dailyCap, spentToday, dayIndex, paused, activatedAt, raised, repaid, deposits(address), accPerShare, lenderClaimed(address), escrowTotal, lenderPool, ownerPending, opexBalance, raisedHeld, orderCount, orders(uint256), policyNonce`
  - Events: `Deposited(address indexed lender, uint256 amount)`, `Activated(uint256 at)`, `Refunded(address indexed lender, uint256 amount)`

- [ ] **Step 1: Write the failing tests `sc/test/LoanVault.Raising.t.sol`**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Base} from "./Base.t.sol";
import {LoanVault} from "../src/LoanVault.sol";

contract LoanVaultRaisingTest is Base {
    function test_startsRaising() public view {
        assertEq(uint8(vault.state()), uint8(LoanVault.State.Raising));
        assertEq(vault.activatedAt(), 0);
    }

    function test_depositsUntilTargetActivate() public {
        vm.prank(lenderA);
        vault.deposit(60e18);
        assertEq(uint8(vault.state()), uint8(LoanVault.State.Raising));
        assertEq(vault.raisedHeld(), 60e18);
        vm.prank(lenderB);
        vault.deposit(40e18);
        assertEq(uint8(vault.state()), uint8(LoanVault.State.Active));
        assertEq(vault.activatedAt(), block.timestamp);
        assertEq(vault.opexBalance(), TARGET);
        assertEq(vault.raisedHeld(), 0);
        assertEq(vault.deposits(lenderA), 60e18);
    }

    function test_depositOverTargetReverts() public {
        vm.prank(lenderA);
        vm.expectRevert(LoanVault.OverTarget.selector);
        vault.deposit(TARGET + 1);
    }

    function test_zeroDepositReverts() public {
        vm.prank(lenderA);
        vm.expectRevert(LoanVault.ZeroAmount.selector);
        vault.deposit(0);
    }

    function test_depositAfterActivationReverts() public {
        _activate();
        vm.prank(lenderA);
        vm.expectRevert(LoanVault.WrongState.selector);
        vault.deposit(1);
    }

    function test_refundedAfterDeadlineBelowTarget() public {
        vm.prank(lenderA);
        vault.deposit(60e18);
        vm.warp(raiseDeadline + 1);
        assertEq(uint8(vault.state()), uint8(LoanVault.State.Refunded));
        uint256 before = fusd.balanceOf(lenderA);
        vm.prank(lenderA);
        vault.refund();
        assertEq(fusd.balanceOf(lenderA), before + 60e18);
        assertEq(vault.raisedHeld(), 0);
    }

    function test_refundWhileRaisingReverts() public {
        vm.prank(lenderA);
        vault.deposit(60e18);
        vm.prank(lenderA);
        vm.expectRevert(LoanVault.WrongState.selector);
        vault.refund();
    }

    function test_refundTwiceReverts() public {
        vm.prank(lenderA);
        vault.deposit(60e18);
        vm.warp(raiseDeadline + 1);
        vm.startPrank(lenderA);
        vault.refund();
        vm.expectRevert(LoanVault.ZeroAmount.selector);
        vault.refund();
        vm.stopPrank();
    }

    function test_constructorRejectsBadSplit() public {
        LoanVault.Init memory i = _init();
        i.lenderBps = 9000;
        i.ownerBps = 2000;
        vm.expectRevert(LoanVault.BadConfig.selector);
        new LoanVault(i);
    }

    function test_constructorRejectsMismatchedSuppliers() public {
        LoanVault.Init memory i = _init();
        i.supplierCaps = new uint256[](1);
        vm.expectRevert(LoanVault.BadConfig.selector);
        new LoanVault(i);
    }

    function test_booksMatchBalanceWhileRaising() public {
        vm.prank(lenderA);
        vault.deposit(60e18);
        (uint256 e, uint256 l, uint256 o, uint256 x, uint256 h) = vault.books();
        assertEq(e + l + o + x + h, fusd.balanceOf(address(vault)));
    }
}
```

- [ ] **Step 2: Run to verify failure**

Run (in `sc/`): `forge test --match-contract LoanVaultRaisingTest`
Expected: compilation error, `LoanVault.sol` not found.

- [ ] **Step 3: Write `sc/src/LoanVault.sol` (complete contract; later tasks add tests only)**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IQorePQC} from "./interfaces/IQorePQC.sol";

/// @title LoanVault
/// @notice Working capital for one AI agent business. Lenders fund it in fUSD; the agent's
/// spender may pay only listed suppliers under caps; buyers' payments sit in escrow until the
/// agent's operator delivers a sealed report, then the contract splits them, lenders first.
/// Policy changes need the owner's ML-DSA-87 signature (checked by the pqcVerify precompile),
/// and while the loan runs only changes that narrow the rules are accepted.
contract LoanVault {
    using SafeERC20 for IERC20;

    IQorePQC internal constant PQC_VERIFY = IQorePQC(0x0000000000000000000000000000000000000a01);
    IQorePQC internal constant PQC_KEYS = IQorePQC(0x0000000000000000000000000000000000000a02);

    uint256 internal constant BPS = 10_000;
    uint256 internal constant ACC = 1e18;
    bytes32 internal constant POLICY_TAG = keccak256("qredit-policy-v1");

    enum State { Raising, Active, Trapped, Repaid, Refunded }
    enum OrderStatus { None, Open, Delivered, Declined, Reclaimed }
    enum Kind { RemoveSupplier, LowerSupplierCap, LowerDailyCap, Pause, Unpause, AddSupplier, RaiseSupplierCap, RaiseDailyCap }

    struct LoanTerms {
        uint256 target;
        uint256 totalOwed;
        uint64 raiseDeadline;
        uint64 period;
        uint64 grace;
        uint256 installment;
    }

    struct Init {
        IERC20 token;
        address spender;
        address operator;
        address ownerPq;
        address ownerPayout;
        string cosmosChainId;
        uint16 lenderBps;
        uint16 ownerBps;
        uint256 dailyCap;
        uint64 orderTtl;
        LoanTerms loan;
        address[] suppliers;
        uint256[] supplierCaps;
        uint256[] servicePrices;
    }

    struct Supplier {
        bool allowed;
        uint256 perTxCap;
    }

    struct Order {
        address buyer;
        uint32 serviceId;
        uint64 deadline;
        OrderStatus status;
        uint256 price;
        bytes32 requestRef;
    }

    struct PolicyOrder {
        uint8 kind;
        address target;
        uint256 value;
        uint64 nonce;
        uint64 expiry;
    }

    // Roles and fixed terms
    IERC20 public immutable token;
    address public immutable spender;
    address public immutable operator;
    address public immutable ownerPq;
    address public immutable ownerPayout;
    uint16 public immutable lenderBps;
    uint16 public immutable ownerBps;
    uint64 public immutable orderTtl;
    bytes public cosmosChainId;
    LoanTerms public loan;

    // Spending policy
    mapping(address => Supplier) public suppliers;
    uint256[] internal servicePrices;
    uint256 public dailyCap;
    uint256 public spentToday;
    uint64 public dayIndex;
    bool public paused;
    uint64 public policyNonce;

    // Loan accounting
    uint64 public activatedAt;
    uint256 public raised;
    uint256 public repaid;
    mapping(address => uint256) public deposits;
    uint256 public accPerShare;
    mapping(address => uint256) public lenderClaimed;

    // Books: balance == escrowTotal + lenderPool + ownerPending + opexBalance + raisedHeld
    uint256 public escrowTotal;
    uint256 public lenderPool;
    uint256 public ownerPending;
    uint256 public opexBalance;
    uint256 public raisedHeld;

    // Orders
    uint256 public orderCount;
    mapping(uint256 => Order) public orders;

    event Deposited(address indexed lender, uint256 amount);
    event Activated(uint256 at);
    event Refunded(address indexed lender, uint256 amount);
    event OrderPlaced(uint256 indexed orderId, address indexed buyer, uint256 serviceId, uint256 price, bytes32 requestRef, uint256 deadline);
    event Delivered(uint256 indexed orderId, bytes32 envelopeHash, uint256 toLenders, uint256 toOwner, uint256 toOpex);
    event Declined(uint256 indexed orderId, uint8 reasonCode);
    event Reclaimed(uint256 indexed orderId);
    event SupplierPaid(address indexed supplier, uint256 amount, uint256 indexed orderId);
    event LenderClaimed(address indexed lender, uint256 amount);
    event OwnerClaimed(uint256 amount);
    event PolicyApplied(uint64 indexed nonce, uint8 kind, address target, uint256 value);
    event RemainderWithdrawn(uint256 amount);

    error BadConfig();
    error WrongState();
    error ZeroAmount();
    error OverTarget();
    error Paused();
    error UnknownService();
    error NotOperator();
    error NotSpender();
    error NotOwner();
    error NotBuyer();
    error OrderNotOpen();
    error OrderExpired();
    error OrderNotExpired();
    error SupplierNotAllowed();
    error OverSupplierCap();
    error OverDailyCap();
    error InsufficientOpex();
    error TrappedNoOwnerClaim();
    error OwnerKeyNotRegistered();
    error OwnerKeyNotProven();
    error BadNonce();
    error OrderExpiredSig();
    error BadPqcSignature();
    error UnknownKind();
    error WideningLocked();
    error NotNarrowing();
    error BadOrder();

    constructor(Init memory init) {
        if (
            address(init.token) == address(0) || init.spender == address(0) || init.operator == address(0)
                || init.ownerPq == address(0) || init.ownerPayout == address(0)
        ) revert BadConfig();
        if (uint256(init.lenderBps) + init.ownerBps > BPS) revert BadConfig();
        if (init.suppliers.length != init.supplierCaps.length || init.servicePrices.length == 0) revert BadConfig();
        LoanTerms memory l = init.loan;
        if (
            l.target == 0 || l.totalOwed < l.target || l.period == 0 || l.installment == 0
                || l.raiseDeadline <= block.timestamp || init.orderTtl == 0 || bytes(init.cosmosChainId).length == 0
        ) revert BadConfig();

        token = init.token;
        spender = init.spender;
        operator = init.operator;
        ownerPq = init.ownerPq;
        ownerPayout = init.ownerPayout;
        lenderBps = init.lenderBps;
        ownerBps = init.ownerBps;
        orderTtl = init.orderTtl;
        cosmosChainId = bytes(init.cosmosChainId);
        loan = l;
        dailyCap = init.dailyCap;
        for (uint256 i; i < init.suppliers.length; i++) {
            if (init.suppliers[i] == address(0) || init.supplierCaps[i] == 0) revert BadConfig();
            suppliers[init.suppliers[i]] = Supplier(true, init.supplierCaps[i]);
        }
        for (uint256 i; i < init.servicePrices.length; i++) {
            if (init.servicePrices[i] == 0) revert BadConfig();
            servicePrices.push(init.servicePrices[i]);
        }
    }

    // ---------------------------------------------------------------- views

    function state() public view returns (State) {
        if (activatedAt == 0) return block.timestamp > loan.raiseDeadline ? State.Refunded : State.Raising;
        if (repaid >= loan.totalOwed) return State.Repaid;
        return repaid < expectedRepaid(block.timestamp) ? State.Trapped : State.Active;
    }

    /// Minimum lender repayment due by time t: one installment per full period after the grace.
    function expectedRepaid(uint256 t) public view returns (uint256) {
        if (activatedAt == 0 || t <= uint256(activatedAt) + loan.grace) return 0;
        uint256 periods = (t - activatedAt - loan.grace) / loan.period;
        uint256 e = periods * loan.installment;
        return e > loan.totalOwed ? loan.totalOwed : e;
    }

    function serviceCount() external view returns (uint256) {
        return servicePrices.length;
    }

    function servicePrice(uint256 serviceId) external view returns (uint256) {
        return servicePrices[serviceId];
    }

    function lenderClaimable(address lender) public view returns (uint256) {
        return deposits[lender] * accPerShare / ACC - lenderClaimed[lender];
    }

    function books() external view returns (uint256 escrow, uint256 lenders, uint256 ownerOwed, uint256 opex, uint256 held) {
        return (escrowTotal, lenderPool, ownerPending, opexBalance, raisedHeld);
    }

    // -------------------------------------------------------------- lenders

    function deposit(uint256 amount) external {
        if (state() != State.Raising) revert WrongState();
        if (amount == 0) revert ZeroAmount();
        if (raised + amount > loan.target) revert OverTarget();
        token.safeTransferFrom(msg.sender, address(this), amount);
        deposits[msg.sender] += amount;
        raised += amount;
        raisedHeld += amount;
        emit Deposited(msg.sender, amount);
        if (raised == loan.target) {
            activatedAt = uint64(block.timestamp);
            opexBalance += raisedHeld;
            raisedHeld = 0;
            emit Activated(block.timestamp);
        }
    }

    function refund() external {
        if (state() != State.Refunded) revert WrongState();
        uint256 amount = deposits[msg.sender];
        if (amount == 0) revert ZeroAmount();
        deposits[msg.sender] = 0;
        raisedHeld -= amount;
        token.safeTransfer(msg.sender, amount);
        emit Refunded(msg.sender, amount);
    }

    function claimLender() external {
        uint256 amount = lenderClaimable(msg.sender);
        if (amount == 0) revert ZeroAmount();
        lenderClaimed[msg.sender] += amount;
        lenderPool -= amount;
        token.safeTransfer(msg.sender, amount);
        emit LenderClaimed(msg.sender, amount);
    }

    // --------------------------------------------------------------- orders

    function buy(uint256 serviceId, bytes32 requestRef) external returns (uint256 id) {
        if (activatedAt == 0) revert WrongState();
        if (paused) revert Paused();
        if (serviceId >= servicePrices.length) revert UnknownService();
        uint256 price = servicePrices[serviceId];
        token.safeTransferFrom(msg.sender, address(this), price);
        id = ++orderCount;
        uint64 deadline = uint64(block.timestamp) + orderTtl;
        orders[id] = Order(msg.sender, uint32(serviceId), deadline, OrderStatus.Open, price, requestRef);
        escrowTotal += price;
        emit OrderPlaced(id, msg.sender, serviceId, price, requestRef, deadline);
    }

    function deliver(uint256 id, bytes32 envelopeHash) external {
        if (msg.sender != operator) revert NotOperator();
        Order storage o = orders[id];
        if (o.status != OrderStatus.Open) revert OrderNotOpen();
        if (block.timestamp > o.deadline) revert OrderExpired();
        o.status = OrderStatus.Delivered;
        escrowTotal -= o.price;
        (uint256 toLenders, uint256 toOwner, uint256 toOpex) = _split(o.price);
        emit Delivered(id, envelopeHash, toLenders, toOwner, toOpex);
    }

    function decline(uint256 id, uint8 reasonCode) external {
        if (msg.sender != operator) revert NotOperator();
        Order storage o = orders[id];
        if (o.status != OrderStatus.Open) revert OrderNotOpen();
        o.status = OrderStatus.Declined;
        escrowTotal -= o.price;
        token.safeTransfer(o.buyer, o.price);
        emit Declined(id, reasonCode);
    }

    function reclaim(uint256 id) external {
        Order storage o = orders[id];
        if (msg.sender != o.buyer) revert NotBuyer();
        if (o.status != OrderStatus.Open) revert OrderNotOpen();
        if (block.timestamp <= o.deadline) revert OrderNotExpired();
        o.status = OrderStatus.Reclaimed;
        escrowTotal -= o.price;
        token.safeTransfer(o.buyer, o.price);
        emit Reclaimed(id);
    }

    function _split(uint256 price) internal returns (uint256 toLenders, uint256 toOwner, uint256 toOpex) {
        bool trapped = state() == State.Trapped;
        uint256 owed = loan.totalOwed > repaid ? loan.totalOwed - repaid : 0;
        uint256 bps = trapped ? uint256(lenderBps) + uint256(ownerBps) : uint256(lenderBps);
        uint256 lenderShare = price * bps / BPS;
        toLenders = lenderShare < owed ? lenderShare : owed;
        toOwner = trapped ? 0 : price * ownerBps / BPS;
        toOpex = price - toLenders - toOwner;
        if (toLenders > 0) {
            repaid += toLenders;
            lenderPool += toLenders;
            accPerShare += toLenders * ACC / raised;
        }
        ownerPending += toOwner;
        opexBalance += toOpex;
    }

    // ------------------------------------------------------------ suppliers

    function paySupplier(address supplier, uint256 amount, uint256 orderId) external {
        if (msg.sender != spender) revert NotSpender();
        if (activatedAt == 0) revert WrongState();
        if (paused) revert Paused();
        Supplier memory s = suppliers[supplier];
        if (!s.allowed) revert SupplierNotAllowed();
        if (amount == 0) revert ZeroAmount();
        if (amount > s.perTxCap) revert OverSupplierCap();
        uint64 today = uint64(block.timestamp / 1 days);
        if (today != dayIndex) {
            dayIndex = today;
            spentToday = 0;
        }
        if (spentToday + amount > dailyCap) revert OverDailyCap();
        if (amount > opexBalance) revert InsufficientOpex();
        spentToday += amount;
        opexBalance -= amount;
        token.safeTransfer(supplier, amount);
        emit SupplierPaid(supplier, amount, orderId);
    }

    // ---------------------------------------------------------------- owner

    function claimOwner() external {
        if (state() == State.Trapped) revert TrappedNoOwnerClaim();
        uint256 amount = ownerPending;
        if (amount == 0) revert ZeroAmount();
        ownerPending = 0;
        token.safeTransfer(ownerPayout, amount);
        emit OwnerClaimed(amount);
    }

    function withdrawRemainder() external {
        if (msg.sender != ownerPq) revert NotOwner();
        if (state() != State.Repaid) revert WrongState();
        uint256 amount = opexBalance;
        if (amount == 0) revert ZeroAmount();
        opexBalance = 0;
        token.safeTransfer(ownerPayout, amount);
        emit RemainderWithdrawn(amount);
    }

    // ------------------------------------------------------- policy orders

    function orderDigest(PolicyOrder calldata o) public view returns (bytes32) {
        return keccak256(abi.encode(POLICY_TAG, block.chainid, address(this), o.kind, o.target, o.value, o.nonce, o.expiry));
    }

    /// The text the owner signs (in QoreX, signArbitrary of this string).
    function orderText(PolicyOrder calldata o) public view returns (bytes memory) {
        return abi.encodePacked("qredit-order-v1:", _hex(orderDigest(o)));
    }

    /// The exact bytes the ML-DSA-87 signature covers: QoreSign's message prefix plus the text.
    function signedBytes(PolicyOrder calldata o) public view returns (bytes memory) {
        return abi.encodePacked("qorechain-msg-v1|", cosmosChainId, "|", orderText(o));
    }

    function applyOrder(PolicyOrder calldata o, bytes calldata sig) external {
        if (o.kind > uint8(Kind.RaiseDailyCap)) revert UnknownKind();
        (bool registered,, bytes memory pubkey, bool proven) = PQC_KEYS.pqcKeyStatus(ownerPq);
        if (!registered || pubkey.length == 0) revert OwnerKeyNotRegistered();
        if (!proven) revert OwnerKeyNotProven();
        if (o.nonce != policyNonce) revert BadNonce();
        if (block.timestamp > o.expiry) revert OrderExpiredSig();
        if (!PQC_VERIFY.pqcVerify(pubkey, sig, signedBytes(o))) revert BadPqcSignature();
        if (o.kind >= uint8(Kind.AddSupplier) && state() != State.Repaid) revert WideningLocked();
        policyNonce = o.nonce + 1;
        _apply(Kind(o.kind), o.target, o.value);
        emit PolicyApplied(o.nonce, o.kind, o.target, o.value);
    }

    function _apply(Kind k, address target, uint256 value) internal {
        if (k == Kind.RemoveSupplier) {
            if (!suppliers[target].allowed) revert SupplierNotAllowed();
            delete suppliers[target];
        } else if (k == Kind.LowerSupplierCap) {
            Supplier storage s = suppliers[target];
            if (!s.allowed) revert SupplierNotAllowed();
            if (value == 0 || value >= s.perTxCap) revert NotNarrowing();
            s.perTxCap = value;
        } else if (k == Kind.LowerDailyCap) {
            if (value >= dailyCap) revert NotNarrowing();
            dailyCap = value;
        } else if (k == Kind.Pause) {
            paused = true;
        } else if (k == Kind.Unpause) {
            paused = false;
        } else if (k == Kind.AddSupplier) {
            if (target == address(0) || value == 0 || suppliers[target].allowed) revert BadOrder();
            suppliers[target] = Supplier(true, value);
        } else if (k == Kind.RaiseSupplierCap) {
            Supplier storage s = suppliers[target];
            if (!s.allowed) revert SupplierNotAllowed();
            if (value <= s.perTxCap) revert BadOrder();
            s.perTxCap = value;
        } else {
            if (value <= dailyCap) revert BadOrder();
            dailyCap = value;
        }
    }

    function _hex(bytes32 d) internal pure returns (bytes memory s) {
        bytes16 alphabet = "0123456789abcdef";
        s = new bytes(66);
        s[0] = "0";
        s[1] = "x";
        for (uint256 i; i < 32; i++) {
            s[2 + 2 * i] = alphabet[uint8(d[i]) >> 4];
            s[3 + 2 * i] = alphabet[uint8(d[i]) & 0x0f];
        }
    }
}
```

- [ ] **Step 4: Run the tests**

Run: `forge build && forge test --match-contract LoanVaultRaisingTest -vv`
Expected: `11 passed; 0 failed`. Also check the size: `forge build --sizes | grep LoanVault` — runtime size must be under 24,576 bytes.

- [ ] **Step 5: Commit**

```bash
git add sc/src/interfaces/IQorePQC.sol sc/src/LoanVault.sol sc/test/mocks sc/test/Base.t.sol sc/test/LoanVault.Raising.t.sol
git commit -m "feat(contracts): add LoanVault with raising, refunds and computed loan state"
```

---

### Task 12: LoanVault — orders, escrow and the revenue split

**Files:**
- Create: `sc/test/LoanVault.Orders.t.sol`

**Interfaces:**
- Consumes: `buy`, `deliver`, `decline`, `reclaim`, `orders`, events `OrderPlaced`, `Delivered`, `Declined`, `Reclaimed` (Task 11).

- [ ] **Step 1: Write the tests**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Base} from "./Base.t.sol";
import {LoanVault} from "../src/LoanVault.sol";

contract LoanVaultOrdersTest is Base {
    function setUp() public override {
        super.setUp();
        _activate();
    }

    function test_buyEscrowsPayment() public {
        uint256 id = _buy(1);
        (address b, uint32 sid, uint64 deadline, LoanVault.OrderStatus st, uint256 price,) = vault.orders(id);
        assertEq(b, buyer);
        assertEq(sid, 1);
        assertEq(deadline, block.timestamp + TTL);
        assertEq(uint8(st), uint8(LoanVault.OrderStatus.Open));
        assertEq(price, PRICE1);
        assertEq(vault.escrowTotal(), PRICE1);
    }

    function test_buyBeforeActivationReverts() public {
        LoanVault fresh = new LoanVault(_init());
        vm.prank(buyer);
        vm.expectRevert(LoanVault.WrongState.selector);
        fresh.buy(0, bytes32(0));
    }

    function test_unknownServiceReverts() public {
        vm.prank(buyer);
        vm.expectRevert(LoanVault.UnknownService.selector);
        vault.buy(3, bytes32(0));
    }

    function test_deliverSplitsLendersFirst() public {
        uint256 id = _buy(1); // 5 fUSD
        vm.expectEmit(address(vault));
        emit LoanVault.Delivered(id, keccak256(abi.encode("envelope", id)), 1.5e18, 1e18, 2.5e18);
        _deliver(id);
        assertEq(vault.repaid(), 1.5e18);
        assertEq(vault.lenderPool(), 1.5e18);
        assertEq(vault.ownerPending(), 1e18);
        assertEq(vault.opexBalance(), TARGET + 2.5e18);
        assertEq(vault.escrowTotal(), 0);
    }

    function test_onlyOperatorDelivers() public {
        uint256 id = _buy(0);
        vm.prank(spender);
        vm.expectRevert(LoanVault.NotOperator.selector);
        vault.deliver(id, bytes32(0));
        vm.prank(stranger);
        vm.expectRevert(LoanVault.NotOperator.selector);
        vault.deliver(id, bytes32(0));
    }

    function test_deliverAfterDeadlineReverts() public {
        uint256 id = _buy(0);
        vm.warp(block.timestamp + TTL + 1);
        vm.prank(operator);
        vm.expectRevert(LoanVault.OrderExpired.selector);
        vault.deliver(id, bytes32(0));
    }

    function test_deliverTwiceReverts() public {
        uint256 id = _buy(0);
        _deliver(id);
        vm.prank(operator);
        vm.expectRevert(LoanVault.OrderNotOpen.selector);
        vault.deliver(id, bytes32(0));
    }

    function test_declineRefundsBuyerAtOnce() public {
        uint256 before = fusd.balanceOf(buyer);
        uint256 id = _buy(1);
        vm.prank(operator);
        vault.decline(id, 2);
        assertEq(fusd.balanceOf(buyer), before);
        assertEq(vault.escrowTotal(), 0);
        (,,, LoanVault.OrderStatus st,,) = vault.orders(id);
        assertEq(uint8(st), uint8(LoanVault.OrderStatus.Declined));
    }

    function test_onlyOperatorDeclines() public {
        uint256 id = _buy(0);
        vm.prank(stranger);
        vm.expectRevert(LoanVault.NotOperator.selector);
        vault.decline(id, 1);
    }

    function test_reclaimAfterDeadline() public {
        uint256 before = fusd.balanceOf(buyer);
        uint256 id = _buy(1);
        vm.warp(block.timestamp + TTL + 1);
        vm.prank(buyer);
        vault.reclaim(id);
        assertEq(fusd.balanceOf(buyer), before);
    }

    function test_reclaimBeforeDeadlineReverts() public {
        uint256 id = _buy(1);
        vm.prank(buyer);
        vm.expectRevert(LoanVault.OrderNotExpired.selector);
        vault.reclaim(id);
    }

    function test_reclaimByStrangerReverts() public {
        uint256 id = _buy(1);
        vm.warp(block.timestamp + TTL + 1);
        vm.prank(stranger);
        vm.expectRevert(LoanVault.NotBuyer.selector);
        vault.reclaim(id);
    }

    function test_booksMatchBalanceAfterOrders() public {
        _sell(1, 3);
        _buy(0);
        uint256 d = _buy(1);
        vm.prank(operator);
        vault.decline(d, 0);
        (uint256 e, uint256 l, uint256 o, uint256 x, uint256 h) = vault.books();
        assertEq(e + l + o + x + h, fusd.balanceOf(address(vault)));
    }
}
```

- [ ] **Step 2: Run**

Run: `forge test --match-contract LoanVaultOrdersTest -vv`
Expected: `13 passed; 0 failed`. A failure here means `LoanVault.sol` from Task 11 was copied wrong; fix the contract, not the test.

- [ ] **Step 3: Commit**

```bash
git add sc/test/LoanVault.Orders.t.sol
git commit -m "test(contracts): cover orders, escrow, decline, reclaim and the split"
```

---

### Task 13: LoanVault — supplier payments and caps

**Files:**
- Create: `sc/test/LoanVault.Suppliers.t.sol`

- [ ] **Step 1: Write the tests**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Base} from "./Base.t.sol";
import {LoanVault} from "../src/LoanVault.sol";

contract LoanVaultSuppliersTest is Base {
    function setUp() public override {
        super.setUp();
        _activate();
    }

    function _pay(address supplier, uint256 amount) internal {
        vm.prank(spender);
        vault.paySupplier(supplier, amount, 1);
    }

    function test_spenderPaysListedSupplier() public {
        vm.expectEmit(address(vault));
        emit LoanVault.SupplierPaid(supplierA, 3e18, 1);
        _pay(supplierA, 3e18);
        assertEq(fusd.balanceOf(supplierA), 3e18);
        assertEq(vault.opexBalance(), TARGET - 3e18);
        assertEq(vault.spentToday(), 3e18);
    }

    function test_onlySpenderPays() public {
        vm.prank(operator);
        vm.expectRevert(LoanVault.NotSpender.selector);
        vault.paySupplier(supplierA, 1e18, 1);
        vm.prank(ownerPq);
        vm.expectRevert(LoanVault.NotSpender.selector);
        vault.paySupplier(supplierA, 1e18, 1);
    }

    function test_unlistedSupplierReverts() public {
        vm.prank(spender);
        vm.expectRevert(LoanVault.SupplierNotAllowed.selector);
        vault.paySupplier(stranger, 1e18, 1);
    }

    function test_overSupplierCapReverts() public {
        vm.prank(spender);
        vm.expectRevert(LoanVault.OverSupplierCap.selector);
        vault.paySupplier(supplierB, CAP_B + 1, 1);
    }

    function test_zeroPaymentReverts() public {
        vm.prank(spender);
        vm.expectRevert(LoanVault.ZeroAmount.selector);
        vault.paySupplier(supplierA, 0, 1);
    }

    function test_dailyCapAndReset() public {
        _pay(supplierA, 10e18);
        _pay(supplierA, 10e18);
        vm.prank(spender);
        vm.expectRevert(LoanVault.OverDailyCap.selector);
        vault.paySupplier(supplierB, 1, 1);
        vm.warp(block.timestamp + 1 days);
        _pay(supplierB, 1e18);
        assertEq(vault.spentToday(), 1e18);
    }

    function test_cannotSpendMoreThanOpex() public {
        for (uint256 d; d < 5; d++) {
            _pay(supplierA, 10e18);
            _pay(supplierA, 10e18);
            vm.warp(block.timestamp + 1 days);
        }
        assertEq(vault.opexBalance(), 0);
        vm.prank(spender);
        vm.expectRevert(LoanVault.InsufficientOpex.selector);
        vault.paySupplier(supplierA, 1, 1);
    }

    function test_noPaymentsBeforeActivation() public {
        LoanVault fresh = new LoanVault(_init());
        vm.prank(spender);
        vm.expectRevert(LoanVault.WrongState.selector);
        fresh.paySupplier(supplierA, 1, 1);
    }

    function testFuzz_paymentNeverExceedsCaps(uint256 amount) public {
        amount = bound(amount, 1, 50e18);
        vm.prank(spender);
        if (amount > CAP_A) {
            vm.expectRevert(LoanVault.OverSupplierCap.selector);
            vault.paySupplier(supplierA, amount, 1);
        } else {
            vault.paySupplier(supplierA, amount, 1);
            assertLe(vault.spentToday(), DAILY);
        }
    }
}
```

- [ ] **Step 2: Run**

Run: `forge test --match-contract LoanVaultSuppliersTest -vv`
Expected: `9 passed; 0 failed`.

- [ ] **Step 3: Commit**

```bash
git add sc/test/LoanVault.Suppliers.t.sol
git commit -m "test(contracts): cover supplier payments, caps and the daily reset"
```

---

### Task 14: LoanVault — claims, Trapped and Repaid

**Files:**
- Create: `sc/test/LoanVault.Claims.t.sol`

- [ ] **Step 1: Write the tests**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Base} from "./Base.t.sol";
import {LoanVault} from "../src/LoanVault.sol";

contract LoanVaultClaimsTest is Base {
    function setUp() public override {
        super.setUp();
        _activate();
    }

    function test_lendersClaimProRata() public {
        _sell(1, 1); // 1.5 fUSD to lenders
        uint256 a0 = fusd.balanceOf(lenderA);
        uint256 b0 = fusd.balanceOf(lenderB);
        vm.prank(lenderA);
        vault.claimLender();
        vm.prank(lenderB);
        vault.claimLender();
        assertEq(fusd.balanceOf(lenderA) - a0, 0.9e18);
        assertEq(fusd.balanceOf(lenderB) - b0, 0.6e18);
        assertEq(vault.lenderPool(), 0);
    }

    function test_claimWithNothingDueReverts() public {
        vm.prank(lenderA);
        vm.expectRevert(LoanVault.ZeroAmount.selector);
        vault.claimLender();
    }

    function test_ownerClaimGoesToPayout() public {
        _sell(1, 1);
        vault.claimOwner();
        assertEq(fusd.balanceOf(ownerPayout), 1e18);
        assertEq(vault.ownerPending(), 0);
    }

    function test_trappedAfterMissedInstallment() public {
        assertEq(uint8(vault.state()), uint8(LoanVault.State.Active));
        vm.warp(block.timestamp + GRACE + PERIOD);
        assertEq(vault.expectedRepaid(block.timestamp), INSTALLMENT);
        assertEq(uint8(vault.state()), uint8(LoanVault.State.Trapped));
    }

    function test_trappedRedirectsOwnerShareToLenders() public {
        vm.warp(block.timestamp + GRACE + PERIOD);
        uint256 id = _buy(1);
        vm.expectEmit(address(vault));
        emit LoanVault.Delivered(id, keccak256(abi.encode("envelope", id)), 2.5e18, 0, 2.5e18);
        _deliver(id);
        assertEq(vault.ownerPending(), 0);
    }

    function test_ownerCannotClaimWhileTrapped() public {
        _sell(1, 1); // owner earns 1 fUSD while Active
        vm.warp(block.timestamp + GRACE + PERIOD);
        vm.expectRevert(LoanVault.TrappedNoOwnerClaim.selector);
        vault.claimOwner();
    }

    function test_backToActiveWhenCaughtUp() public {
        vm.warp(block.timestamp + GRACE + PERIOD);
        _sell(1, 4); // 4 × 2.5 = 10 fUSD to lenders while trapped
        assertEq(vault.repaid(), 10e18);
        assertEq(uint8(vault.state()), uint8(LoanVault.State.Active));
    }

    function test_repaidCapsLenderShare() public {
        _sell(2, 3); // 3 × 30 = 90
        assertEq(vault.repaid(), 90e18);
        uint256 id = _buy(2);
        vm.expectEmit(address(vault));
        emit LoanVault.Delivered(id, keccak256(abi.encode("envelope", id)), 20e18, 20e18, 60e18);
        _deliver(id);
        assertEq(vault.repaid(), OWED);
        assertEq(uint8(vault.state()), uint8(LoanVault.State.Repaid));
        _sell(2, 1); // after repayment lenders get nothing more
        assertEq(vault.repaid(), OWED);
    }

    function test_businessKeepsSellingAfterRepaid() public {
        _sell(2, 4);
        assertEq(uint8(vault.state()), uint8(LoanVault.State.Repaid));
        _sell(0, 1);
    }

    function test_withdrawRemainderOnlyByOwnerWhenRepaid() public {
        vm.prank(ownerPq);
        vm.expectRevert(LoanVault.WrongState.selector);
        vault.withdrawRemainder();
        _sell(2, 4);
        vm.prank(stranger);
        vm.expectRevert(LoanVault.NotOwner.selector);
        vault.withdrawRemainder();
        uint256 opex = vault.opexBalance();
        vm.prank(ownerPq);
        vault.withdrawRemainder();
        assertEq(fusd.balanceOf(ownerPayout), opex);
    }

    function test_sumOfLenderClaimsNeverExceedsPool() public {
        _sell(0, 7);
        vm.prank(lenderA);
        vault.claimLender();
        vm.prank(lenderB);
        vault.claimLender();
        assertGe(vault.lenderPool(), 0);
        (uint256 e, uint256 l, uint256 o, uint256 x, uint256 h) = vault.books();
        assertEq(e + l + o + x + h, fusd.balanceOf(address(vault)));
    }
}
```

- [ ] **Step 2: Run**

Run: `forge test --match-contract LoanVaultClaimsTest -vv`
Expected: `11 passed; 0 failed`.

- [ ] **Step 3: Commit**

```bash
git add sc/test/LoanVault.Claims.t.sol
git commit -m "test(contracts): cover lender and owner claims, Trapped and Repaid"
```

---

### Task 15: LoanVault — signed policy orders

**Files:**
- Create: `sc/test/LoanVault.Policy.t.sol`

- [ ] **Step 1: Write the tests**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Base} from "./Base.t.sol";
import {LoanVault} from "../src/LoanVault.sol";

contract LoanVaultPolicyTest is Base {
    uint8 internal constant REMOVE_SUPPLIER = 0;
    uint8 internal constant LOWER_SUPPLIER_CAP = 1;
    uint8 internal constant LOWER_DAILY_CAP = 2;
    uint8 internal constant PAUSE = 3;
    uint8 internal constant UNPAUSE = 4;
    uint8 internal constant ADD_SUPPLIER = 5;
    uint8 internal constant RAISE_SUPPLIER_CAP = 6;
    uint8 internal constant RAISE_DAILY_CAP = 7;

    function setUp() public override {
        super.setUp();
        _activate();
    }

    function _apply(LoanVault.PolicyOrder memory o) internal {
        bytes memory sig = _sign(o); // compute first: _sign makes an external call that would consume the prank
        vm.prank(stranger); // anyone may submit; the signature is what counts
        vault.applyOrder(o, sig);
    }

    function test_signedBytesFormat() public view {
        LoanVault.PolicyOrder memory o = _order(PAUSE, address(0), 0);
        bytes memory text = vault.orderText(o);
        assertEq(text.length, 82);
        assertEq(keccak256(vault.signedBytes(o)), keccak256(abi.encodePacked("qorechain-msg-v1|qorechain-diana|", text)));
    }

    function test_removeSupplierWithOwnerSignature() public {
        _apply(_order(REMOVE_SUPPLIER, supplierA, 0));
        (bool allowed,) = vault.suppliers(supplierA);
        assertFalse(allowed);
        assertEq(vault.policyNonce(), 1);
        vm.prank(spender);
        vm.expectRevert(LoanVault.SupplierNotAllowed.selector);
        vault.paySupplier(supplierA, 1, 1);
    }

    function test_badSignatureReverts() public {
        LoanVault.PolicyOrder memory o = _order(PAUSE, address(0), 0);
        vm.expectRevert(LoanVault.BadPqcSignature.selector);
        vault.applyOrder(o, hex"deadbeef");
    }

    function test_signatureBoundToOrderFields() public {
        LoanVault.PolicyOrder memory o = _order(LOWER_DAILY_CAP, address(0), 5e18);
        bytes memory sig = _sign(o);
        o.value = 1e18;
        vm.expectRevert(LoanVault.BadPqcSignature.selector);
        vault.applyOrder(o, sig);
    }

    function test_replayReverts() public {
        LoanVault.PolicyOrder memory o = _order(PAUSE, address(0), 0);
        bytes memory sig = _sign(o);
        vault.applyOrder(o, sig);
        vm.expectRevert(LoanVault.BadNonce.selector);
        vault.applyOrder(o, sig);
    }

    function test_expiredOrderReverts() public {
        LoanVault.PolicyOrder memory o = _order(PAUSE, address(0), 0);
        bytes memory sig = _sign(o);
        vm.warp(o.expiry + 1);
        vm.expectRevert(LoanVault.OrderExpiredSig.selector);
        vault.applyOrder(o, sig);
    }

    function test_wideningLockedDuringLoan() public {
        LoanVault.PolicyOrder memory o = _order(ADD_SUPPLIER, stranger, 1e18);
        bytes memory sig = _sign(o);
        vm.expectRevert(LoanVault.WideningLocked.selector);
        vault.applyOrder(o, sig);
        o = _order(RAISE_DAILY_CAP, address(0), DAILY * 2);
        sig = _sign(o);
        vm.expectRevert(LoanVault.WideningLocked.selector);
        vault.applyOrder(o, sig);
    }

    function test_wideningAllowedAfterRepaid() public {
        _sell(2, 4);
        assertEq(uint8(vault.state()), uint8(LoanVault.State.Repaid));
        _apply(_order(ADD_SUPPLIER, stranger, 1e18));
        (bool allowed, uint256 cap) = vault.suppliers(stranger);
        assertTrue(allowed);
        assertEq(cap, 1e18);
        _apply(_order(RAISE_SUPPLIER_CAP, stranger, 2e18));
        _apply(_order(RAISE_DAILY_CAP, address(0), DAILY * 2));
        assertEq(vault.dailyCap(), DAILY * 2);
    }

    function test_lowerMustNarrow() public {
        LoanVault.PolicyOrder memory o = _order(LOWER_SUPPLIER_CAP, supplierA, CAP_A);
        bytes memory sig = _sign(o);
        vm.expectRevert(LoanVault.NotNarrowing.selector);
        vault.applyOrder(o, sig);
        o = _order(LOWER_DAILY_CAP, address(0), DAILY + 1);
        sig = _sign(o);
        vm.expectRevert(LoanVault.NotNarrowing.selector);
        vault.applyOrder(o, sig);
    }

    function test_lowerCapsApply() public {
        _apply(_order(LOWER_SUPPLIER_CAP, supplierA, 1e18));
        _apply(_order(LOWER_DAILY_CAP, address(0), 2e18));
        (, uint256 cap) = vault.suppliers(supplierA);
        assertEq(cap, 1e18);
        assertEq(vault.dailyCap(), 2e18);
    }

    function test_pauseStopsBuyingAndPaying() public {
        _apply(_order(PAUSE, address(0), 0));
        vm.prank(buyer);
        vm.expectRevert(LoanVault.Paused.selector);
        vault.buy(0, bytes32(0));
        vm.prank(spender);
        vm.expectRevert(LoanVault.Paused.selector);
        vault.paySupplier(supplierA, 1, 1);
        _apply(_order(UNPAUSE, address(0), 0));
        _buy(0);
    }

    function test_unregisteredOwnerKeyReverts() public {
        vm.store(PQC_KEYS, bytes32(uint256(0)), bytes32(uint256(1)));
        LoanVault.PolicyOrder memory o = _order(PAUSE, address(0), 0);
        bytes memory sig = _sign(o);
        vm.expectRevert(LoanVault.OwnerKeyNotRegistered.selector);
        vault.applyOrder(o, sig);
    }

    function test_unprovenOwnerKeyReverts() public {
        vm.store(PQC_KEYS, bytes32(uint256(0)), bytes32(uint256(2)));
        LoanVault.PolicyOrder memory o = _order(PAUSE, address(0), 0);
        bytes memory sig = _sign(o);
        vm.expectRevert(LoanVault.OwnerKeyNotProven.selector);
        vault.applyOrder(o, sig);
    }

    function test_unknownKindReverts() public {
        LoanVault.PolicyOrder memory o = _order(8, address(0), 0);
        vm.expectRevert(LoanVault.UnknownKind.selector);
        vault.applyOrder(o, hex"");
    }
}
```

- [ ] **Step 2: Run**

Run: `forge test --match-contract LoanVaultPolicyTest -vv`
Expected: `14 passed; 0 failed`.

- [ ] **Step 3: Commit**

```bash
git add sc/test/LoanVault.Policy.t.sol
git commit -m "test(contracts): cover ML-DSA-signed policy orders and the widening lock"
```

---

### Task 16: Invariant test — the books always equal the balance

**Files:**
- Create: `sc/test/LoanVault.Invariant.t.sol`

- [ ] **Step 1: Write the handler and invariants**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {Base} from "./Base.t.sol";
import {LoanVault} from "../src/LoanVault.sol";
import {MockToken} from "./mocks/MockToken.sol";

contract VaultHandler is Test {
    LoanVault internal vault;
    MockToken internal fusd;
    address internal spender;
    address internal operator;
    address internal buyer;
    address internal supplier;
    address[2] internal lenders;

    constructor(LoanVault v, MockToken t, address s, address o, address b, address sup, address la, address lb) {
        (vault, fusd, spender, operator, buyer, supplier) = (v, t, s, o, b, sup);
        lenders = [la, lb];
    }

    function buy(uint256 serviceId) external {
        serviceId = bound(serviceId, 0, 2);
        vm.prank(buyer);
        try vault.buy(serviceId, bytes32(serviceId)) {} catch {}
    }

    function deliver(uint256 id) external {
        if (vault.orderCount() == 0) return;
        id = bound(id, 1, vault.orderCount());
        vm.prank(operator);
        try vault.deliver(id, bytes32(id)) {} catch {}
    }

    function decline(uint256 id) external {
        if (vault.orderCount() == 0) return;
        id = bound(id, 1, vault.orderCount());
        vm.prank(operator);
        try vault.decline(id, 0) {} catch {}
    }

    function reclaim(uint256 id) external {
        if (vault.orderCount() == 0) return;
        id = bound(id, 1, vault.orderCount());
        vm.prank(buyer);
        try vault.reclaim(id) {} catch {}
    }

    function pay(uint256 amount) external {
        amount = bound(amount, 1, 10e18);
        vm.prank(spender);
        try vault.paySupplier(supplier, amount, 0) {} catch {}
    }

    function claimLender(uint256 who) external {
        vm.prank(lenders[who % 2]);
        try vault.claimLender() {} catch {}
    }

    function claimOwner() external {
        try vault.claimOwner() {} catch {}
    }

    function warp(uint256 secs) external {
        vm.warp(block.timestamp + bound(secs, 1, 2 days));
    }
}

contract LoanVaultInvariantTest is Base {
    VaultHandler internal handler;

    function setUp() public override {
        super.setUp();
        _activate();
        handler = new VaultHandler(vault, fusd, spender, operator, buyer, supplierA, lenderA, lenderB);
        targetContract(address(handler));
    }

    function invariant_booksEqualBalance() public view {
        (uint256 e, uint256 l, uint256 o, uint256 x, uint256 h) = vault.books();
        assertEq(e + l + o + x + h, fusd.balanceOf(address(vault)));
    }

    function invariant_repaidNeverExceedsOwed() public view {
        assertLe(vault.repaid(), OWED);
    }

    function invariant_lenderClaimsCovered() public view {
        assertGe(vault.lenderPool(), vault.lenderClaimable(lenderA) + vault.lenderClaimable(lenderB));
    }
}
```

- [ ] **Step 2: Run**

Run: `forge test --match-contract LoanVaultInvariantTest -vv`
Expected: `3 passed; 0 failed` (128 runs × depth 64 each).

- [ ] **Step 3: Commit**

```bash
git add sc/test/LoanVault.Invariant.t.sol
git commit -m "test(contracts): add invariants for the vault's books and repayments"
```

---

### Task 17: VaultFactory, deployment and the on-chain smoke test

**Files:**
- Create: `sc/src/VaultFactory.sol`, `sc/test/VaultFactory.t.sol`, `sc/script/DeployFactory.s.sol`

**Interfaces:**
- Produces: `VaultFactory.create(LoanVault.Init calldata) returns (LoanVault)`, `count() view returns (uint256)`, `vaultAt(uint256) view returns (LoanVault)`, `all() view returns (LoanVault[] memory)`, event `VaultCreated(address indexed vault, address indexed ownerPq, address spender, address operator, uint256 index)`. Used by Task 8 and by the agent and web-app plans.

- [ ] **Step 1: Write the failing test `sc/test/VaultFactory.t.sol`**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Base} from "./Base.t.sol";
import {LoanVault} from "../src/LoanVault.sol";
import {VaultFactory} from "../src/VaultFactory.sol";

contract VaultFactoryTest is Base {
    VaultFactory internal factory;

    function setUp() public override {
        super.setUp();
        factory = new VaultFactory();
    }

    function test_createsAndListsVaults() public {
        vm.recordLogs();
        LoanVault a = factory.create(_init());
        LoanVault b = factory.create(_init());
        assertEq(factory.count(), 2);
        assertEq(address(factory.vaultAt(0)), address(a));
        assertEq(address(factory.all()[1]), address(b));
        assertEq(a.operator(), operator);
        assertEq(a.ownerPq(), ownerPq);
        assertEq(uint8(a.state()), uint8(LoanVault.State.Raising));
        assertEq(vm.getRecordedLogs().length, 2);
    }

    function test_badConfigBubblesUp() public {
        LoanVault.Init memory i = _init();
        i.spender = address(0);
        vm.expectRevert(LoanVault.BadConfig.selector);
        factory.create(i);
    }
}
```

- [ ] **Step 2: Run to verify failure**

Run: `forge test --match-contract VaultFactoryTest`
Expected: compilation error, `VaultFactory.sol` not found.

- [ ] **Step 3: Write `sc/src/VaultFactory.sol`**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {LoanVault} from "./LoanVault.sol";

/// @title VaultFactory
/// @notice Deploys LoanVaults and lists them for the Qredit market. Anyone may create a vault.
contract VaultFactory {
    LoanVault[] internal vaults;

    event VaultCreated(address indexed vault, address indexed ownerPq, address spender, address operator, uint256 index);

    function create(LoanVault.Init calldata init) external returns (LoanVault v) {
        v = new LoanVault(init);
        vaults.push(v);
        emit VaultCreated(address(v), init.ownerPq, init.spender, init.operator, vaults.length - 1);
    }

    function count() external view returns (uint256) {
        return vaults.length;
    }

    function vaultAt(uint256 index) external view returns (LoanVault) {
        return vaults[index];
    }

    function all() external view returns (LoanVault[] memory) {
        return vaults;
    }
}
```

- [ ] **Step 4: Run all contract tests**

Run: `forge test -vv && forge build --sizes | grep -E "LoanVault|VaultFactory"`
Expected: every suite passes (SenderProbe 2, Raising 11, Orders 13, Suppliers 9, Claims 11, Policy 14, Invariant 3, Factory 2); `VaultFactory` and `LoanVault` runtime sizes under 24,576 bytes.

If `VaultFactory` is over the limit (it embeds the vault's creation code), lower `optimizer_runs` to 50 in `foundry.toml` and rebuild. If it is still over, change the factory to a registry: vaults are deployed directly by a script, and `VaultFactory.register(LoanVault v)` (callable by anyone, emitting the same `VaultCreated` event with `v.ownerPq()`, `v.spender()`, `v.operator()`) lists them; update the test to deploy with `new LoanVault(_init())` and call `register`.

- [ ] **Step 5: Write `sc/script/DeployFactory.s.sol`**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {VaultFactory} from "../src/VaultFactory.sol";

contract DeployFactory is Script {
    function run() external {
        vm.startBroadcast(vm.envUint("PRIVATE_KEY"));
        VaultFactory f = new VaultFactory();
        vm.stopBroadcast();
        console.log("VaultFactory", address(f));
    }
}
```

- [ ] **Step 6: Deploy to testnet**

Run (in `engine/spikes/`): `bun src/window.ts open deployer 1200 4 40000000`
Run (in `sc/`): `PRIVATE_KEY=$(cat .deployer.key) forge script script/DeployFactory.s.sol --rpc-url qorechain_testnet --broadcast`
Expected: `VaultFactory 0x…`. Record the address and the deploy tx.

- [ ] **Step 7: Run the on-chain smoke test (Task 8 Steps 3)**

Follow Task 8 Step 3 with this factory. Expected: the script and QoreX signatures are accepted by `applyOrder`, tampered ones refused.

- [ ] **Step 8: Add a `sc/README.md`**

```markdown
# Qredit contracts

- `src/LoanVault.sol` — one vault per agent business: lender capital, order escrow, supplier payments under caps, the revenue split (lenders first), and ML-DSA-87-signed policy orders (narrowing only while a loan runs).
- `src/VaultFactory.sol` — deploys and lists vaults.
- `src/spike/SenderProbe.sol` — used only by the spikes.

## Test

    forge test

Local tests replace the QoreChain PQC precompiles with stand-ins (`test/mocks/MockPqc.sol`); the real ones are exercised on testnet by `engine/spikes/src/s3-apply-order.ts`.

## Deployed on qorechain-diana

| Contract | Address | Tx |
|---|---|---|
| VaultFactory | <address from Task 17 Step 6> | <tx> |
| Smoke vault (script signer) | <address from Task 8> | <tx> |
| Smoke vault (QoreX signer) | <address from Task 8> | <tx> |
```

Fill the table with the real addresses and hashes before committing.

- [ ] **Step 9: Commit**

```bash
git add sc/src/VaultFactory.sol sc/test/VaultFactory.t.sol sc/script/DeployFactory.s.sol sc/README.md
git commit -m "feat(contracts): add VaultFactory and deploy it to testnet"
```

---

## After this plan

- Update `engine/spikes/RESULTS.md` (Task 9) if Task 8's on-chain smoke changed any S3 conclusion.
- Claim the Ship Weeks badge "First contract with a PQC check" from My space with the factory-created vault's deployment (it calls both precompiles).
- Write **Plan 2 (agent runtime, relayer, mailbox, suppliers, owner CLI)** using the real APIs and results recorded here, then **Plan 3 (web app)** and **Plan 4 (docs, proof, verify CLI, video)**.
