# Qredit Plan 2a: Backend (`apps/be`) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `apps/be`, the Qredit backend at api.qredit.fun: the mailbox API (envelopes, recipient cards, decision log, orders), the relayer for the agents' `MsgExecuteEVM`, the vault watcher, the operator-window keeper and the test-funds faucet.

**Architecture:** One Bun process running a Hono HTTP app plus two background loops (watcher, window keeper). Off-chain state lives in Supabase Postgres in a private schema `qredit` (not exposed by Supabase's Data API, RLS on); sealed envelopes are stored as text rows, so the only Supabase secret is `DATABASE_URL`. Every module takes its dependencies as arguments, so tests run in-process against PGlite (real Postgres in WebAssembly) with fake chain adapters; a final task runs the real server against testnet and Supabase.

**Tech Stack:** Bun 1.3, TypeScript, Hono 4, postgres (postgres.js) 3.4, @electric-sql/pglite (tests), zod 3, viem 2, @qorechain/sdk 0.14.0, @qorechain/evm 0.14.0, @qorechain/qoreseal 0.1.0, @cosmjs/stargate 0.39.

**Spec:** `docs/superpowers/specs/2026-11-24-qredit-design.md` (sections 5, 7, 9, 14). Spike facts: `engine/spikes/RESULTS.md`.

## Global Constraints

- Network: testnet `qorechain-diana`; REST `https://api-testnet.qore.host`, RPC `https://rpc-testnet.qore.host`, EVM RPC `https://evm-testnet.qore.host`, EVM chain id 9800.
- fUSD bank denom (faucet coin): `erc20:0x97143B771D34ddb9130b807b135Ae675A5a963CA`; 6 decimals. Cosmos `MsgSend` coin lists must be sorted by denom (`erc20:…` before `uqor`).
- `MsgExecuteEVM` type URL `/qorechain.abstractaccount.v1.MsgExecuteEVM`; a refused execution returns tx code 0 with an `abstractaccount_execution_failed` event (spike S1). The relayer must read the events, never the code alone.
- `LoanVault` events: `OrderPlaced(uint256 indexed orderId, address indexed buyer, uint256 serviceId, uint256 price, bytes32 requestRef, uint256 deadline)`, `Delivered(uint256 indexed orderId, bytes32 envelopeHash, uint256 toLenders, uint256 toOwner, uint256 toOpex)`, `Declined(uint256 indexed orderId, uint8 reasonCode)`, `Reclaimed(uint256 indexed orderId)`. The relayer only forwards calls to known vaults with selector `paySupplier(address,uint256,uint256)`.
- Envelope hash = `keccak256` of the UTF-8 bytes of the envelope text; it is the `requestRef` / `envelopeHash` committed on chain.
- EVM windows: max 17,280 blocks (~6.9 h at ~1.43 s/block), max 1,000 txs, `maxValue` (uqor) > 0 and counts value + gas limit × fee cap; opening a window replaces the live one.
- Database: Supabase Postgres via the **session pooler** URL, `prepare: false`; all tables in schema `qredit`, RLS enabled, identity primary keys, lowercase identifiers, `timestamptz`.
- Secrets only in `apps/be/.env` (gitignored): `DATABASE_URL`, `ENGINE_TOKEN`, `IP_SALT`, `RELAYER_KEY`, `TREASURY_KEY`, `OPERATOR_KEYS`. Never log them. `.env.example` lists names only.
- Pin package versions; Bun is the package manager and runtime; everything committed is in English; no build durations or schedules in committed files.
- Engineering standards (binding for every task and review): SOLID (one responsibility per module, dependencies injected as interfaces), DRY (no duplicated logic; shared chain code moves to `packages/qore` when the engine needs it), ACID for every multi-step write (wrap it in `db.transaction`; no check-then-act outside a transaction or lock), idempotent handlers where the chain can replay events, small reusable functions with typed inputs and outputs.
- Commits: one per task, conventional prefix with scope `be` (`feat(be): …`, `test(be): …`), body ends `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## File Structure

```
apps/be/
  package.json, tsconfig.json, bunfig.toml
  CLAUDE.md                      folder rules for AI agents
  .env.example                   variable names only
  migrations/001_init.sql        schema qredit: businesses, orders, envelopes, cards, decisions, watcher_state, faucet_grants
  src/config.ts                  env parsing (zod)
  src/db.ts                      Db interface; postgres.js and PGlite implementations
  src/migrate.ts                 migration runner (+ CLI)
  src/store.ts                   all SQL: businesses, envelopes, cards, decisions, orders, watcher state, faucet grants
  src/hash.ts                    envelope hash
  src/chain/keys.ts              key specs from env → UnifiedAccount
  src/chain/tx.ts                hybrid broadcast, tx events, execution failure, serial()
  src/chain/vault.ts             vault event ABI, paySupplier selector
  src/cards.ts                   recipient-card verification against the chain
  src/relayer.ts                 validate + broadcast MsgExecuteEVM
  src/watcher.ts                 vault logs → orders table
  src/windows.ts                 operator window keeper
  src/faucet.ts                  test funds from the treasury, with cooldown
  src/http.ts                    Hono app (all routes)
  src/server.ts                  wiring: config, db, migrations, loops, Bun.serve
  test/*.test.ts                 one file per module
```

---

### Task 1: Scaffold `apps/be` and config

**Files:**
- Create: `apps/be/package.json`, `apps/be/tsconfig.json`, `apps/be/bunfig.toml`, `apps/be/CLAUDE.md`, `apps/be/.env.example`, `apps/be/src/config.ts`, `apps/be/test/config.test.ts`

**Interfaces:**
- Produces: `loadConfig(env?: Record<string, string | undefined>): Config`; `Config` fields exactly as in the schema below; `FUSD_DENOM` constant.

- [ ] **Step 1: Create the package**

Run (in `apps/be`):
```bash
bun init -y >/dev/null 2>&1; rm -f index.ts README.md
bun add hono@4.6 postgres@3.4.5 zod@3.24 viem@2 @qorechain/sdk@0.14.0 @qorechain/evm@0.14.0 @qorechain/qoreseal@0.1.0 @cosmjs/stargate@0.39 @cosmjs/proto-signing@0.39
bun add -d @electric-sql/pglite@0.2 typescript@5 @types/bun
```

Then replace `apps/be/package.json` scripts and fields (keep the dependency versions Bun wrote):
```json
{
  "name": "@qredit/be",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "bun --env-file=.env src/server.ts",
    "start": "bun src/server.ts",
    "migrate": "bun --env-file=.env src/migrate.ts",
    "test": "bun test",
    "typecheck": "tsc --noEmit"
  }
}
```

`apps/be/tsconfig.json`:
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
  "include": ["src", "test"]
}
```

`apps/be/bunfig.toml`:
```toml
[test]
timeout = 20000
```

`apps/be/.env.example`:
```dotenv
# Supabase Postgres, session pooler URI (Project → Connect → Session pooler).
DATABASE_URL=
# Shared secret the engine sends as "Authorization: Bearer <token>"; at least 32 characters.
ENGINE_TOKEN=
# Salt for hashing client IPs in the faucet log; at least 16 characters.
IP_SALT=
# Key specs as JSON: {"mnemonic":"..."} or {"privateKey":"0x...","recoveryCode":"QRC1-..."}.
RELAYER_KEY=
TREASURY_KEY=
# JSON array of key specs, one per agent operator account.
OPERATOR_KEYS=[]
PORT=8787
CORS_ORIGINS=http://localhost:3000,https://app.qredit.fun,https://qredit.fun
```

`apps/be/CLAUDE.md`:
```markdown
# CLAUDE.md — apps/be

The Qredit backend (api.qredit.fun): mailbox API, relayer, vault watcher, operator-window keeper, test-funds faucet. Bun + Hono + Supabase Postgres (schema `qredit`).

- Run: `bun run dev` (reads `.env`). Tests: `bun test` (PGlite in-process, no network). Types: `bun run typecheck`.
- Migrations: add `migrations/NNN_name.sql`; never edit an applied one. `bun run migrate` applies pending files; the server also applies them at boot.
- Every module takes its dependencies as arguments (db, chain adapters); keep it that way so tests stay offline.
- This process holds the relayer, treasury and operator keys and runs no AI. Engine routes require `Authorization: Bearer $ENGINE_TOKEN`.
- Read the repo-root CLAUDE.md rules; secrets only in `.env`.
```

- [ ] **Step 2: Write the failing test `apps/be/test/config.test.ts`**

```ts
import { describe, expect, test } from "bun:test";
import { FUSD_DENOM, loadConfig } from "../src/config.ts";

const base = {
  DATABASE_URL: "postgresql://u:p@host:5432/postgres",
  ENGINE_TOKEN: "x".repeat(32),
  IP_SALT: "s".repeat(16),
  RELAYER_KEY: '{"mnemonic":"a b c"}',
  TREASURY_KEY: '{"mnemonic":"a b c"}',
};

describe("loadConfig", () => {
  test("applies defaults", () => {
    const c = loadConfig(base);
    expect(c.PORT).toBe(8787);
    expect(c.QORE_CHAIN_ID).toBe("qorechain-diana");
    expect(c.FAUCET_UQOR).toBe(2_000_000n);
    expect(c.FAUCET_FUSD_UNITS).toBe(50_000_000n);
    expect(c.WINDOW_MIN_BLOCKS).toBe(3600);
    expect(c.OPERATOR_KEYS).toBe("[]");
  });

  test("rejects a short engine token", () => {
    expect(() => loadConfig({ ...base, ENGINE_TOKEN: "short" })).toThrow();
  });

  test("requires the database url", () => {
    const { DATABASE_URL: _, ...rest } = base;
    expect(() => loadConfig(rest)).toThrow();
  });

  test("fUSD denom is the faucet bank coin", () => {
    expect(FUSD_DENOM).toBe("erc20:0x97143B771D34ddb9130b807b135Ae675A5a963CA");
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run (in `apps/be`): `bun test test/config.test.ts`
Expected: FAIL, cannot find module `../src/config.ts`.

- [ ] **Step 4: Write `apps/be/src/config.ts`**

```ts
import { z } from "zod";

export const FUSD_DENOM = "erc20:0x97143B771D34ddb9130b807b135Ae675A5a963CA";

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  PORT: z.coerce.number().int().positive().default(8787),
  ENGINE_TOKEN: z.string().min(32, "ENGINE_TOKEN must be at least 32 characters"),
  IP_SALT: z.string().min(16),
  CORS_ORIGINS: z.string().default("http://localhost:3000,https://app.qredit.fun,https://qredit.fun"),
  QORE_CHAIN_ID: z.string().default("qorechain-diana"),
  QORE_REST_URL: z.string().url().default("https://api-testnet.qore.host"),
  QORE_RPC_URL: z.string().url().default("https://rpc-testnet.qore.host"),
  QORE_EVM_URL: z.string().url().default("https://evm-testnet.qore.host"),
  RELAYER_KEY: z.string().min(1),
  TREASURY_KEY: z.string().min(1),
  OPERATOR_KEYS: z.string().default("[]"),
  FAUCET_UQOR: z.coerce.bigint().default(2_000_000n),
  FAUCET_FUSD_UNITS: z.coerce.bigint().default(50_000_000n),
  FAUCET_COOLDOWN_HOURS: z.coerce.number().positive().default(24),
  WATCH_INTERVAL_MS: z.coerce.number().int().positive().default(4000),
  WINDOW_CHECK_INTERVAL_MS: z.coerce.number().int().positive().default(300_000),
  WINDOW_MIN_BLOCKS: z.coerce.number().int().positive().default(3600),
  WINDOW_MAX_TXS: z.coerce.number().int().positive().default(500),
  WINDOW_MAX_UQOR: z.coerce.bigint().default(25_000_000n),
});

export type Config = z.infer<typeof schema>;

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  return schema.parse(env);
}
```

- [ ] **Step 5: Run the test and typecheck**

Run: `bun test test/config.test.ts && bun run typecheck`
Expected: 4 pass; no type errors.

- [ ] **Step 6: Commit**

```bash
git add apps/be/package.json apps/be/bun.lock apps/be/tsconfig.json apps/be/bunfig.toml apps/be/CLAUDE.md apps/be/.env.example apps/be/src/config.ts apps/be/test/config.test.ts
git commit -m "feat(be): scaffold the backend package and its config"
```

---

### Task 2: Database layer and migrations

**Files:**
- Create: `apps/be/src/db.ts`, `apps/be/src/migrate.ts`, `apps/be/migrations/001_init.sql`, `apps/be/test/migrate.test.ts`

**Interfaces:**
- Produces: `interface Db { query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>; exec(text: string): Promise<void>; close(): Promise<void> }`; `pgDb(url: string): Db`; `memoryDb(): Promise<Db>`; `runMigrations(db: Db, dir: string): Promise<string[]>`; `MIGRATIONS_DIR` (absolute path of `apps/be/migrations`).

- [ ] **Step 1: Write the failing test `apps/be/test/migrate.test.ts`**

```ts
import { describe, expect, test } from "bun:test";
import { memoryDb } from "../src/db.ts";
import { MIGRATIONS_DIR, runMigrations } from "../src/migrate.ts";

describe("runMigrations", () => {
  test("creates the qredit schema once", async () => {
    const db = await memoryDb();
    expect(await runMigrations(db, MIGRATIONS_DIR)).toEqual(["001_init.sql"]);
    expect(await runMigrations(db, MIGRATIONS_DIR)).toEqual([]);
    const tables = await db.query<{ table_name: string }>(
      "select table_name from information_schema.tables where table_schema = 'qredit' order by table_name",
    );
    expect(tables.map((t) => t.table_name)).toEqual([
      "businesses", "cards", "decisions", "envelopes", "faucet_grants", "orders", "schema_migrations", "watcher_state",
    ]);
    await db.close();
  });

  test("every table has row level security enabled", async () => {
    const db = await memoryDb();
    await runMigrations(db, MIGRATIONS_DIR);
    const rows = await db.query<{ relname: string; relrowsecurity: boolean }>(
      "select c.relname, c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'qredit' and c.relkind = 'r'",
    );
    expect(rows.length).toBe(8);
    expect(rows.every((r) => r.relrowsecurity)).toBe(true);
    await db.close();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun test test/migrate.test.ts`
Expected: FAIL, cannot find `../src/db.ts`.

- [ ] **Step 3: Write `apps/be/src/db.ts`**

```ts
import postgres from "postgres";

export interface Db {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
  exec(text: string): Promise<void>;
  close(): Promise<void>;
}

/** Supabase Postgres through the session pooler; prepared statements off for pooling. */
export function pgDb(url: string): Db {
  const sql = postgres(url, { max: 5, prepare: false, idle_timeout: 30, connect_timeout: 15 });
  return {
    query: async <T>(text: string, params: unknown[] = []) =>
      (await sql.unsafe(text, params as never[])) as unknown as T[],
    exec: async (text: string) => {
      await sql.unsafe(text);
    },
    close: () => sql.end(),
  };
}

/** In-process Postgres (PGlite) for tests. */
export async function memoryDb(): Promise<Db> {
  const { PGlite } = await import("@electric-sql/pglite");
  const pg = new PGlite();
  return {
    query: async <T>(text: string, params: unknown[] = []) => (await pg.query(text, params)).rows as T[],
    exec: async (text: string) => {
      await pg.exec(text);
    },
    close: () => pg.close(),
  };
}
```

- [ ] **Step 4: Write `apps/be/migrations/001_init.sql`**

```sql
-- Qredit backend schema. Private schema (not exposed by Supabase's Data API);
-- RLS is enabled with no policies, so only the backend's own role can read or write.

create table qredit.businesses (
  slug text primary key check (slug ~ '^[a-z0-9-]{2,40}$'),
  vault text not null unique check (vault ~ '^0x[0-9a-f]{40}$'),
  name text not null,
  tagline text not null,
  services jsonb not null,
  operator text not null check (operator ~ '^0x[0-9a-f]{40}$'),
  spender text not null check (spender ~ '^0x[0-9a-f]{40}$'),
  start_block bigint not null check (start_block >= 0),
  created_at timestamptz not null default now()
);

create table qredit.orders (
  vault text not null,
  order_id text not null,
  buyer text not null,
  service_id integer not null,
  price text not null,
  request_ref text not null,
  deadline bigint not null,
  status text not null check (status in ('open', 'claimed', 'delivered', 'declined', 'reclaimed')),
  placed_tx text not null,
  placed_block bigint not null,
  claimed_at timestamptz,
  envelope_hash text,
  closed_tx text,
  updated_at timestamptz not null default now(),
  primary key (vault, order_id)
);
create index orders_open_idx on qredit.orders (vault, placed_block) where status in ('open', 'claimed');

create table qredit.envelopes (
  hash text primary key check (hash ~ '^0x[0-9a-f]{64}$'),
  kind text not null check (kind in ('request', 'report', 'sample')),
  body text not null,
  size integer not null,
  created_at timestamptz not null default now()
);

create table qredit.cards (
  address text primary key,
  card jsonb not null,
  updated_at timestamptz not null default now()
);

create table qredit.decisions (
  id bigint generated always as identity primary key,
  vault text not null,
  order_id text,
  decision text not null check (decision in ('accepted', 'declined', 'delivered', 'failed')),
  reason text not null,
  suppliers jsonb not null default '[]'::jsonb,
  cost text not null default '0',
  created_at timestamptz not null default now()
);
create index decisions_vault_idx on qredit.decisions (vault, id desc);

create table qredit.watcher_state (
  vault text primary key,
  last_block bigint not null
);

create table qredit.faucet_grants (
  id bigint generated always as identity primary key,
  address text not null,
  ip_hash text not null,
  tx text not null,
  created_at timestamptz not null default now()
);
create index faucet_grants_address_idx on qredit.faucet_grants (address, created_at desc);
create index faucet_grants_ip_idx on qredit.faucet_grants (ip_hash, created_at desc);

alter table qredit.schema_migrations enable row level security;
alter table qredit.businesses enable row level security;
alter table qredit.orders enable row level security;
alter table qredit.envelopes enable row level security;
alter table qredit.cards enable row level security;
alter table qredit.decisions enable row level security;
alter table qredit.watcher_state enable row level security;
alter table qredit.faucet_grants enable row level security;

-- On Supabase, make sure the API roles have no access to this schema at all.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on schema qredit from anon, authenticated';
    execute 'revoke all on all tables in schema qredit from anon, authenticated';
  end if;
end $$;
```

- [ ] **Step 5: Write `apps/be/src/migrate.ts`**

```ts
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { type Db, pgDb } from "./db.ts";

export const MIGRATIONS_DIR = join(import.meta.dir, "..", "migrations");

export async function runMigrations(db: Db, dir: string): Promise<string[]> {
  await db.exec(
    "create schema if not exists qredit; create table if not exists qredit.schema_migrations (name text primary key, applied_at timestamptz not null default now());",
  );
  const files = readdirSync(dir).filter((f) => /^[0-9]{3}_[a-z0-9_]+\.sql$/.test(f)).sort();
  const applied = new Set((await db.query<{ name: string }>("select name from qredit.schema_migrations")).map((r) => r.name));
  const ran: string[] = [];
  for (const file of files) {
    if (applied.has(file)) continue;
    const body = readFileSync(join(dir, file), "utf8");
    await db.exec(`begin;\n${body}\ninsert into qredit.schema_migrations (name) values ('${file}');\ncommit;`);
    ran.push(file);
  }
  return ran;
}

if (import.meta.main) {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const db = pgDb(url);
  try {
    console.log("applied:", await runMigrations(db, MIGRATIONS_DIR));
  } finally {
    await db.close();
  }
}
```

- [ ] **Step 6: Run the tests**

Run: `bun test test/migrate.test.ts && bun run typecheck`
Expected: 2 pass.

- [ ] **Step 7: Apply to Supabase**

Run (in `apps/be`, `.env` holds `DATABASE_URL`): `bun run migrate`
Expected: `applied: [ "001_init.sql" ]`. Run it again: `applied: []`.

- [ ] **Step 8: Commit**

```bash
git add apps/be/src/db.ts apps/be/src/migrate.ts apps/be/migrations/001_init.sql apps/be/test/migrate.test.ts
git commit -m "feat(be): add the database layer and the qredit schema"
```

---

### Task 3: Store (all SQL) and envelope hash

**Files:**
- Create: `apps/be/src/hash.ts`, `apps/be/src/store.ts`, `apps/be/test/store.test.ts`

**Interfaces:**
- Consumes: `Db`, `memoryDb`, `runMigrations`, `MIGRATIONS_DIR` (Task 2).
- Produces:
  - `envelopeHash(body: string): \`0x${string}\``
  - Types: `Business { slug; vault; name; tagline; services: unknown; operator; spender; startBlock: number }`, `Order { vault; orderId; buyer; serviceId: number; price; requestRef; deadline: number; status; placedTx; placedBlock: number; envelopeHash: string | null }`, `VaultEvent` (union below), `Decision { vault; orderId: string | null; decision: "accepted" | "declined" | "delivered" | "failed"; reason; suppliers: unknown[]; cost: string }`, `EnvelopeKind = "request" | "report" | "sample"`.
  - Functions: `upsertBusiness(db, b)`, `listBusinesses(db): Promise<Business[]>`, `getBusiness(db, slug): Promise<Business | null>`, `putEnvelope(db, kind, body): Promise<string>`, `getEnvelope(db, hash): Promise<{ kind: EnvelopeKind; body: string } | null>`, `putCard(db, address, card)`, `getCard(db, address): Promise<unknown | null>`, `addDecision(db, d): Promise<number>`, `listDecisions(db, vault, limit): Promise<(Decision & { id: number; createdAt: string })[]>`, `applyVaultEvent(db, e)`, `getWatchState(db, vault): Promise<number | null>`, `setWatchState(db, vault, block)`, `claimNextOrder(db, vaults: string[]): Promise<Order | null>`, `listOrders(db, vault, status?): Promise<Order[]>`, `recordGrant(db, address, ipHash, tx)`, `lastGrant(db, address, ipHash): Promise<Date | null>`.
  - `VaultEvent = { kind: "OrderPlaced"; vault; orderId; block: number; logIndex: number; tx; buyer; serviceId: number; price: string; requestRef: string; deadline: number } | { kind: "Delivered"; vault; orderId; block; logIndex; tx; envelopeHash: string } | { kind: "Declined" | "Reclaimed"; vault; orderId; block; logIndex; tx }`. All addresses and hashes lowercase.

- [ ] **Step 1: Write the failing test `apps/be/test/store.test.ts`**

```ts
import { beforeEach, describe, expect, test } from "bun:test";
import { type Db, memoryDb } from "../src/db.ts";
import { envelopeHash } from "../src/hash.ts";
import { MIGRATIONS_DIR, runMigrations } from "../src/migrate.ts";
import * as store from "../src/store.ts";

const V = "0x00000000000000000000000000000000000000aa";
let db: Db;

beforeEach(async () => {
  db = await memoryDb();
  await runMigrations(db, MIGRATIONS_DIR);
});

const placed = (orderId: string, block: number) => ({
  kind: "OrderPlaced" as const, vault: V, orderId, block, logIndex: 0, tx: `0xtx${orderId}`,
  buyer: "0x00000000000000000000000000000000000000bb", serviceId: 0, price: "250000",
  requestRef: `0x${orderId.padStart(64, "0")}`, deadline: 2_000_000_000,
});

describe("envelopes", () => {
  test("hash is keccak256 of the utf-8 text and storing is idempotent", async () => {
    const h = await store.putEnvelope(db, "request", "hello");
    expect(h).toBe(envelopeHash("hello"));
    expect(h).toBe("0x1c8aff950685c2ed4bc3174f3472287b56d9517b9c948127319a09a7a36deac8");
    expect(await store.putEnvelope(db, "request", "hello")).toBe(h);
    expect(await store.getEnvelope(db, h)).toEqual({ kind: "request", body: "hello" });
    expect(await store.getEnvelope(db, `0x${"0".repeat(64)}`)).toBeNull();
  });
});

describe("businesses", () => {
  test("upsert and read back", async () => {
    const b = { slug: "counterparty", vault: V, name: "Counterparty Check", tagline: "t", services: [{ id: 0 }], operator: V, spender: V, startBlock: 10 };
    await store.upsertBusiness(db, b);
    await store.upsertBusiness(db, { ...b, name: "Counterparty Check v2" });
    expect((await store.listBusinesses(db)).length).toBe(1);
    expect((await store.getBusiness(db, "counterparty"))?.name).toBe("Counterparty Check v2");
    expect(await store.getBusiness(db, "nope")).toBeNull();
  });
});

describe("orders", () => {
  test("watcher events drive the order lifecycle", async () => {
    await store.applyVaultEvent(db, placed("1", 100));
    await store.applyVaultEvent(db, placed("1", 100)); // duplicate log is ignored
    expect((await store.listOrders(db, V)).map((o) => o.status)).toEqual(["open"]);
    await store.applyVaultEvent(db, { kind: "Delivered", vault: V, orderId: "1", block: 101, logIndex: 0, tx: "0xd", envelopeHash: `0x${"ab".repeat(32)}` });
    const [o] = await store.listOrders(db, V);
    expect(o.status).toBe("delivered");
    expect(o.envelopeHash).toBe(`0x${"ab".repeat(32)}`);
  });

  test("claimNextOrder hands out the oldest open order once", async () => {
    await store.applyVaultEvent(db, placed("2", 200));
    await store.applyVaultEvent(db, placed("1", 100));
    expect((await store.claimNextOrder(db, [V]))?.orderId).toBe("1");
    expect((await store.claimNextOrder(db, [V]))?.orderId).toBe("2");
    expect(await store.claimNextOrder(db, [V])).toBeNull();
    expect(await store.claimNextOrder(db, ["0x00000000000000000000000000000000000000cc"])).toBeNull();
  });

  test("a stale claim can be claimed again", async () => {
    await store.applyVaultEvent(db, placed("1", 100));
    await store.claimNextOrder(db, [V]);
    await db.query("update qredit.orders set claimed_at = now() - interval '11 minutes'");
    expect((await store.claimNextOrder(db, [V]))?.orderId).toBe("1");
  });

  test("declined and reclaimed orders are not claimable", async () => {
    await store.applyVaultEvent(db, placed("1", 100));
    await store.applyVaultEvent(db, placed("2", 101));
    await store.applyVaultEvent(db, { kind: "Declined", vault: V, orderId: "1", block: 102, logIndex: 0, tx: "0x1" });
    await store.applyVaultEvent(db, { kind: "Reclaimed", vault: V, orderId: "2", block: 103, logIndex: 0, tx: "0x2" });
    expect(await store.claimNextOrder(db, [V])).toBeNull();
  });
});

describe("cards, decisions, watcher state, grants", () => {
  test("cards", async () => {
    await store.putCard(db, "qor1abc", { v: 1 });
    await store.putCard(db, "qor1abc", { v: 2 });
    expect(await store.getCard(db, "qor1abc")).toEqual({ v: 2 });
    expect(await store.getCard(db, "qor1zzz")).toBeNull();
  });

  test("decisions newest first", async () => {
    await store.addDecision(db, { vault: V, orderId: "1", decision: "accepted", reason: "in budget", suppliers: [], cost: "0" });
    await store.addDecision(db, { vault: V, orderId: "1", decision: "delivered", reason: "ok", suppliers: [{ to: "x" }], cost: "100" });
    const list = await store.listDecisions(db, V, 10);
    expect(list.map((d) => d.decision)).toEqual(["delivered", "accepted"]);
    expect(list[0].suppliers).toEqual([{ to: "x" }]);
  });

  test("watcher state", async () => {
    expect(await store.getWatchState(db, V)).toBeNull();
    await store.setWatchState(db, V, 500);
    await store.setWatchState(db, V, 600);
    expect(await store.getWatchState(db, V)).toBe(600);
  });

  test("faucet grants by address or ip", async () => {
    expect(await store.lastGrant(db, "qor1a", "ip1")).toBeNull();
    await store.recordGrant(db, "qor1a", "ip1", "0xt");
    expect(await store.lastGrant(db, "qor1a", "ip2")).toBeInstanceOf(Date);
    expect(await store.lastGrant(db, "qor1b", "ip1")).toBeInstanceOf(Date);
    expect(await store.lastGrant(db, "qor1b", "ip2")).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun test test/store.test.ts`
Expected: FAIL, cannot find `../src/hash.ts`.

- [ ] **Step 3: Write `apps/be/src/hash.ts`**

```ts
import { keccak256 } from "viem";

/** keccak256 of the envelope's UTF-8 text: the value committed on chain as requestRef / envelopeHash. */
export const envelopeHash = (body: string): `0x${string}` => keccak256(new TextEncoder().encode(body));
```

- [ ] **Step 4: Write `apps/be/src/store.ts`**

```ts
import type { Db } from "./db.ts";
import { envelopeHash } from "./hash.ts";

export type EnvelopeKind = "request" | "report" | "sample";

export interface Business {
  slug: string;
  vault: string;
  name: string;
  tagline: string;
  services: unknown;
  operator: string;
  spender: string;
  startBlock: number;
}

export interface Order {
  vault: string;
  orderId: string;
  buyer: string;
  serviceId: number;
  price: string;
  requestRef: string;
  deadline: number;
  status: "open" | "claimed" | "delivered" | "declined" | "reclaimed";
  placedTx: string;
  placedBlock: number;
  envelopeHash: string | null;
}

export interface Decision {
  vault: string;
  orderId: string | null;
  decision: "accepted" | "declined" | "delivered" | "failed";
  reason: string;
  suppliers: unknown[];
  cost: string;
}

type Base = { vault: string; orderId: string; block: number; logIndex: number; tx: string };
export type VaultEvent =
  | (Base & { kind: "OrderPlaced"; buyer: string; serviceId: number; price: string; requestRef: string; deadline: number })
  | (Base & { kind: "Delivered"; envelopeHash: string })
  | (Base & { kind: "Declined" | "Reclaimed" });

const lc = (s: string) => s.toLowerCase();

export async function upsertBusiness(db: Db, b: Business): Promise<void> {
  await db.query(
    `insert into qredit.businesses (slug, vault, name, tagline, services, operator, spender, start_block)
     values ($1, $2, $3, $4, $5::jsonb, $6, $7, $8)
     on conflict (slug) do update set vault = excluded.vault, name = excluded.name, tagline = excluded.tagline,
       services = excluded.services, operator = excluded.operator, spender = excluded.spender, start_block = excluded.start_block`,
    [b.slug, lc(b.vault), b.name, b.tagline, JSON.stringify(b.services), lc(b.operator), lc(b.spender), b.startBlock],
  );
}

type BusinessRow = { slug: string; vault: string; name: string; tagline: string; services: unknown; operator: string; spender: string; start_block: string | number };
const toBusiness = (r: BusinessRow): Business => ({
  slug: r.slug, vault: r.vault, name: r.name, tagline: r.tagline, services: r.services,
  operator: r.operator, spender: r.spender, startBlock: Number(r.start_block),
});

export async function listBusinesses(db: Db): Promise<Business[]> {
  return (await db.query<BusinessRow>("select * from qredit.businesses order by created_at, slug")).map(toBusiness);
}

export async function getBusiness(db: Db, slug: string): Promise<Business | null> {
  const [r] = await db.query<BusinessRow>("select * from qredit.businesses where slug = $1", [slug]);
  return r ? toBusiness(r) : null;
}

export async function putEnvelope(db: Db, kind: EnvelopeKind, body: string): Promise<string> {
  const hash = envelopeHash(body);
  await db.query(
    "insert into qredit.envelopes (hash, kind, body, size) values ($1, $2, $3, $4) on conflict (hash) do nothing",
    [hash, kind, body, new TextEncoder().encode(body).length],
  );
  return hash;
}

export async function getEnvelope(db: Db, hash: string): Promise<{ kind: EnvelopeKind; body: string } | null> {
  const [r] = await db.query<{ kind: EnvelopeKind; body: string }>("select kind, body from qredit.envelopes where hash = $1", [lc(hash)]);
  return r ?? null;
}

export async function putCard(db: Db, address: string, card: unknown): Promise<void> {
  await db.query(
    "insert into qredit.cards (address, card) values ($1, $2::jsonb) on conflict (address) do update set card = excluded.card, updated_at = now()",
    [address, JSON.stringify(card)],
  );
}

export async function getCard(db: Db, address: string): Promise<unknown | null> {
  const [r] = await db.query<{ card: unknown }>("select card from qredit.cards where address = $1", [address]);
  return r?.card ?? null;
}

export async function addDecision(db: Db, d: Decision): Promise<number> {
  const [r] = await db.query<{ id: string | number }>(
    "insert into qredit.decisions (vault, order_id, decision, reason, suppliers, cost) values ($1, $2, $3, $4, $5::jsonb, $6) returning id",
    [lc(d.vault), d.orderId, d.decision, d.reason, JSON.stringify(d.suppliers), d.cost],
  );
  return Number(r.id);
}

export async function listDecisions(db: Db, vault: string, limit: number): Promise<(Decision & { id: number; createdAt: string })[]> {
  const rows = await db.query<{ id: string | number; vault: string; order_id: string | null; decision: Decision["decision"]; reason: string; suppliers: unknown[]; cost: string; created_at: Date }>(
    "select * from qredit.decisions where vault = $1 order by id desc limit $2",
    [lc(vault), limit],
  );
  return rows.map((r) => ({
    id: Number(r.id), vault: r.vault, orderId: r.order_id, decision: r.decision, reason: r.reason,
    suppliers: r.suppliers, cost: r.cost, createdAt: new Date(r.created_at).toISOString(),
  }));
}

export async function applyVaultEvent(db: Db, e: VaultEvent): Promise<void> {
  if (e.kind === "OrderPlaced") {
    await db.query(
      `insert into qredit.orders (vault, order_id, buyer, service_id, price, request_ref, deadline, status, placed_tx, placed_block)
       values ($1, $2, $3, $4, $5, $6, $7, 'open', $8, $9) on conflict (vault, order_id) do nothing`,
      [lc(e.vault), e.orderId, lc(e.buyer), e.serviceId, e.price, lc(e.requestRef), e.deadline, lc(e.tx), e.block],
    );
    return;
  }
  const status = e.kind === "Delivered" ? "delivered" : e.kind === "Declined" ? "declined" : "reclaimed";
  const hash = e.kind === "Delivered" ? lc(e.envelopeHash) : null;
  await db.query(
    `update qredit.orders set status = $3, envelope_hash = coalesce($4, envelope_hash), closed_tx = $5, updated_at = now()
     where vault = $1 and order_id = $2`,
    [lc(e.vault), e.orderId, status, hash, lc(e.tx)],
  );
}

export async function getWatchState(db: Db, vault: string): Promise<number | null> {
  const [r] = await db.query<{ last_block: string | number }>("select last_block from qredit.watcher_state where vault = $1", [lc(vault)]);
  return r ? Number(r.last_block) : null;
}

export async function setWatchState(db: Db, vault: string, block: number): Promise<void> {
  await db.query(
    "insert into qredit.watcher_state (vault, last_block) values ($1, $2) on conflict (vault) do update set last_block = excluded.last_block",
    [lc(vault), block],
  );
}

type OrderRow = { vault: string; order_id: string; buyer: string; service_id: number; price: string; request_ref: string; deadline: string | number; status: Order["status"]; placed_tx: string; placed_block: string | number; envelope_hash: string | null };
const toOrder = (r: OrderRow): Order => ({
  vault: r.vault, orderId: r.order_id, buyer: r.buyer, serviceId: Number(r.service_id), price: r.price,
  requestRef: r.request_ref, deadline: Number(r.deadline), status: r.status, placedTx: r.placed_tx,
  placedBlock: Number(r.placed_block), envelopeHash: r.envelope_hash,
});

/** Atomically claim the oldest open order (or one whose claim went stale) among the given vaults. */
export async function claimNextOrder(db: Db, vaults: string[]): Promise<Order | null> {
  if (vaults.length === 0) return null;
  const [r] = await db.query<OrderRow>(
    `update qredit.orders set status = 'claimed', claimed_at = now(), updated_at = now()
     where (vault, order_id) = (
       select vault, order_id from qredit.orders
       where vault = any($1::text[])
         and (status = 'open' or (status = 'claimed' and claimed_at < now() - interval '10 minutes'))
       order by placed_block, order_id
       limit 1
       for update skip locked)
     returning *`,
    [vaults.map(lc)],
  );
  return r ? toOrder(r) : null;
}

export async function listOrders(db: Db, vault: string, status?: Order["status"]): Promise<Order[]> {
  const rows = status
    ? await db.query<OrderRow>("select * from qredit.orders where vault = $1 and status = $2 order by placed_block desc limit 100", [lc(vault), status])
    : await db.query<OrderRow>("select * from qredit.orders where vault = $1 order by placed_block desc limit 100", [lc(vault)]);
  return rows.map(toOrder);
}

export async function recordGrant(db: Db, address: string, ipHash: string, tx: string): Promise<void> {
  await db.query("insert into qredit.faucet_grants (address, ip_hash, tx) values ($1, $2, $3)", [address, ipHash, tx]);
}

export async function lastGrant(db: Db, address: string, ipHash: string): Promise<Date | null> {
  const [r] = await db.query<{ at: Date | null }>(
    "select max(created_at) as at from qredit.faucet_grants where address = $1 or ip_hash = $2",
    [address, ipHash],
  );
  return r?.at ? new Date(r.at) : null;
}
```

- [ ] **Step 5: Run the tests**

Run: `bun test test/store.test.ts && bun run typecheck`
Expected: 10 pass. If the keccak constant in the first test differs, recompute it once with `bun -e 'import {keccak256} from "viem"; console.log(keccak256(new TextEncoder().encode("hello")))'` and use that value (it must equal `keccak256("hello")` = `0x1c8aff…eac8`).

- [ ] **Step 6: Commit**

```bash
git add apps/be/src/hash.ts apps/be/src/store.ts apps/be/test/store.test.ts
git commit -m "feat(be): add the store for envelopes, cards, decisions and orders"
```

---

### Task 4: Chain helpers (keys, hybrid broadcast, vault ABI)

**Files:**
- Create: `apps/be/src/chain/keys.ts`, `apps/be/src/chain/tx.ts`, `apps/be/src/chain/vault.ts`, `apps/be/test/chain.test.ts`

**Interfaces:**
- Produces:
  - `type KeySpec = { mnemonic: string } | { privateKey: \`0x${string}\`; recoveryCode: string }`; `parseKeySpec(raw: string): KeySpec`; `parseKeyList(raw: string): KeySpec[]`; `accountFrom(spec: KeySpec): Promise<UnifiedAccount>`
  - `type Net = { chainId: string; rest: string; rpc: string }`; `type RestEvent = { type: string; attributes: { key: string; value: string }[] }`; `type Sent = { hash: string; code: number; rawLog?: string }`
  - `broadcastHybrid(net: Net, acc: UnifiedAccount, messages: EncodeObject[], opts?: { memo?: string; gas?: string; feeUqor?: string }): Promise<Sent>`
  - `txEvents(rest: string, hash: string, tries?: number, delayMs?: number): Promise<RestEvent[]>`
  - `executionFailure(events: RestEvent[]): string | null`
  - `serial(): <T>(fn: () => Promise<T>) => Promise<T>`
  - `VAULT_EVENTS` (viem ABI), `PAY_SUPPLIER_SELECTOR` (`0x…` 4-byte hex)

- [ ] **Step 1: Write the failing test `apps/be/test/chain.test.ts`**

```ts
import { describe, expect, test } from "bun:test";
import { parseKeyList, parseKeySpec } from "../src/chain/keys.ts";
import { executionFailure, serial } from "../src/chain/tx.ts";
import { PAY_SUPPLIER_SELECTOR, VAULT_EVENTS } from "../src/chain/vault.ts";

describe("key specs", () => {
  test("mnemonic and seed forms", () => {
    const words = Array(12).fill("abandon").join(" ");
    expect(parseKeySpec(JSON.stringify({ mnemonic: words }))).toEqual({ mnemonic: words });
    const seed = { privateKey: `0x${"11".repeat(32)}`, recoveryCode: "QRC1-x" };
    expect(parseKeySpec(JSON.stringify(seed))).toEqual(seed as never);
    expect(() => parseKeySpec('{"mnemonic":"too short"}')).toThrow();
    expect(() => parseKeySpec('{"privateKey":"0x12"}')).toThrow();
    expect(parseKeyList(JSON.stringify([{ mnemonic: words }])).length).toBe(1);
    expect(() => parseKeyList('{"mnemonic":"x"}')).toThrow();
  });
});

describe("executionFailure", () => {
  test("finds the abstractaccount failure event", () => {
    expect(executionFailure([{ type: "message", attributes: [] }])).toBeNull();
    expect(
      executionFailure([{ type: "abstractaccount_execution_failed", attributes: [{ key: "reason", value: "call not listed in allowed_evm_calls" }] }]),
    ).toBe("call not listed in allowed_evm_calls");
    expect(executionFailure([{ type: "abstractaccount_execution_failed", attributes: [] }])).toBe("execution failed");
  });
});

describe("serial", () => {
  test("runs one task at a time, in order, surviving failures", async () => {
    const run = serial();
    const order: number[] = [];
    const slow = (n: number, ms: number) => run(async () => { await Bun.sleep(ms); order.push(n); return n; });
    const failing = run(async () => { throw new Error("boom"); });
    const results = await Promise.allSettled([slow(1, 30), failing, slow(2, 1)]);
    expect(order).toEqual([1, 2]);
    expect(results.map((r) => r.status)).toEqual(["fulfilled", "rejected", "fulfilled"]);
  });
});

describe("vault abi", () => {
  test("paySupplier selector and the four events", () => {
    expect(PAY_SUPPLIER_SELECTOR).toMatch(/^0x[0-9a-f]{8}$/);
    expect(VAULT_EVENTS.map((e) => e.name)).toEqual(["OrderPlaced", "Delivered", "Declined", "Reclaimed"]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun test test/chain.test.ts`
Expected: FAIL, cannot find `../src/chain/keys.ts`.

- [ ] **Step 3: Write `apps/be/src/chain/keys.ts`**

```ts
import { deriveUnifiedAccount, isValidRecoveryCode, unifiedAccountFromSeed, type UnifiedAccount } from "@qorechain/sdk";

export type KeySpec = { mnemonic: string } | { privateKey: `0x${string}`; recoveryCode: string };

function fromValue(v: unknown): KeySpec {
  const o = (v ?? {}) as Record<string, unknown>;
  if (typeof o.mnemonic === "string" && o.mnemonic.trim().split(/\s+/).length >= 12) return { mnemonic: o.mnemonic.trim() };
  if (typeof o.privateKey === "string" && /^0x[0-9a-fA-F]{64}$/.test(o.privateKey) && typeof o.recoveryCode === "string") {
    return { privateKey: o.privateKey as `0x${string}`, recoveryCode: o.recoveryCode };
  }
  throw new Error('a key spec must be {"mnemonic":"<12+ words>"} or {"privateKey":"0x<64 hex>","recoveryCode":"QRC1-..."}');
}

export const parseKeySpec = (raw: string): KeySpec => fromValue(JSON.parse(raw));

export function parseKeyList(raw: string): KeySpec[] {
  const v = JSON.parse(raw);
  if (!Array.isArray(v)) throw new Error("expected a JSON array of key specs");
  return v.map(fromValue);
}

export async function accountFrom(spec: KeySpec): Promise<UnifiedAccount> {
  if ("mnemonic" in spec) return deriveUnifiedAccount(spec.mnemonic, 0);
  if (!isValidRecoveryCode(spec.recoveryCode)) throw new Error("invalid QRC1 recovery code");
  return unifiedAccountFromSeed(Uint8Array.from(Buffer.from(spec.privateKey.slice(2), "hex")), { recoveryCode: spec.recoveryCode });
}
```

- [ ] **Step 4: Write `apps/be/src/chain/tx.ts`**

```ts
import { StargateClient } from "@cosmjs/stargate";
import type { EncodeObject } from "@cosmjs/proto-signing";
import { EthNativeSigner, type UnifiedAccount } from "@qorechain/sdk";

export type Net = { chainId: string; rest: string; rpc: string };
export type RestEvent = { type: string; attributes: { key: string; value: string }[] };
export type Sent = { hash: string; code: number; rawLog?: string };

async function accountNumbers(rest: string, address: string): Promise<{ accountNumber: bigint; sequence: bigint }> {
  const res = await fetch(`${rest}/cosmos/auth/v1beta1/accounts/${address}`);
  if (res.status === 404) throw new Error(`${address} does not exist on chain yet`);
  if (!res.ok) throw new Error(`account query failed: HTTP ${res.status}`);
  const body = (await res.json()) as { account: Record<string, unknown> };
  const base = (body.account.base_account ?? body.account) as Record<string, string>;
  return { accountNumber: BigInt(base.account_number ?? "0"), sequence: BigInt(base.sequence ?? "0") };
}

/** Sign hybrid (secp256k1 + ML-DSA-87) and broadcast. Returns after CheckTx; use txEvents for the result. */
export async function broadcastHybrid(
  net: Net,
  acc: UnifiedAccount,
  messages: EncodeObject[],
  opts: { memo?: string; gas?: string; feeUqor?: string } = {},
): Promise<Sent> {
  const { accountNumber, sequence } = await accountNumbers(net.rest, acc.cosmos);
  const signer = new EthNativeSigner(acc, { signMode: "hybrid", rest: net.rest });
  const transport = await StargateClient.connect(net.rpc);
  try {
    const res = await signer.signAndBroadcast(transport, {
      chainId: net.chainId,
      accountNumber,
      sequence,
      memo: opts.memo ?? "",
      messages,
      fee: { amount: [{ denom: "uqor", amount: opts.feeUqor ?? "150000" }], gas: opts.gas ?? "1000000" },
    });
    return { hash: res.transactionHash, code: res.code, rawLog: res.rawLog };
  } finally {
    transport.disconnect();
  }
}

export async function txEvents(rest: string, hash: string, tries = 20, delayMs = 1500): Promise<RestEvent[]> {
  for (let i = 0; i < tries; i++) {
    const res = await fetch(`${rest}/cosmos/tx/v1beta1/txs/${hash}`);
    if (res.ok) {
      const body = (await res.json()) as { tx_response: { code: number; raw_log?: string; events: RestEvent[] } };
      if (body.tx_response.code !== 0) throw new Error(`tx ${hash} failed with code ${body.tx_response.code}: ${body.tx_response.raw_log ?? ""}`);
      return body.tx_response.events;
    }
    await Bun.sleep(delayMs);
  }
  throw new Error(`tx ${hash} not found after ${(tries * delayMs) / 1000} s`);
}

/** A refused MsgExecuteEVM still has tx code 0; the failure shows only as this event. */
export function executionFailure(events: RestEvent[]): string | null {
  const ev = events.find((e) => e.type === "abstractaccount_execution_failed");
  if (!ev) return null;
  return ev.attributes.find((a) => a.key === "reason" || a.key === "error")?.value || "execution failed";
}

/** Run async tasks one at a time (one signing account = one sequence). */
export function serial(): <T>(fn: () => Promise<T>) => Promise<T> {
  let tail: Promise<unknown> = Promise.resolve();
  return <T>(fn: () => Promise<T>) => {
    const run = tail.then(fn, fn);
    tail = run.then(() => undefined, () => undefined);
    return run;
  };
}
```

- [ ] **Step 5: Write `apps/be/src/chain/vault.ts`**

```ts
import { parseAbi, toFunctionSelector } from "viem";

export const VAULT_EVENTS = parseAbi([
  "event OrderPlaced(uint256 indexed orderId, address indexed buyer, uint256 serviceId, uint256 price, bytes32 requestRef, uint256 deadline)",
  "event Delivered(uint256 indexed orderId, bytes32 envelopeHash, uint256 toLenders, uint256 toOwner, uint256 toOpex)",
  "event Declined(uint256 indexed orderId, uint8 reasonCode)",
  "event Reclaimed(uint256 indexed orderId)",
]);

export const PAY_SUPPLIER_SELECTOR = toFunctionSelector("paySupplier(address,uint256,uint256)");
```

- [ ] **Step 6: Run the tests**

Run: `bun test test/chain.test.ts && bun run typecheck`
Expected: 4 pass. If `EthNativeSigner` or a cosmjs type import name differs, take the name from `node_modules/@qorechain/sdk/dist/index.d.ts` (it is the same API the spikes used in `engine/spikes/src/lib.ts`).

- [ ] **Step 7: Commit**

```bash
git add apps/be/src/chain apps/be/test/chain.test.ts
git commit -m "feat(be): add key loading, hybrid broadcast and the vault ABI"
```

---

### Task 4b: Transactions, and an atomic faucet reservation

**Files:**
- Modify: `apps/be/src/db.ts`, `apps/be/src/store.ts`
- Create: `apps/be/test/tx.test.ts`

**Interfaces:**
- Produces:
  - `type Queryable = { query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]> }`; `Db` gains `transaction<T>(fn: (q: Queryable) => Promise<T>): Promise<T>` (commit on resolve, rollback on throw).
  - Every store function takes `q: Queryable` instead of `db: Db` (a `Db` is a `Queryable`, so existing callers keep working).
  - `reserveGrant(q: Queryable, address: string, ipHash: string, cooldownHours: number, now: Date): Promise<{ ok: true; id: number } | { ok: false; retryAt: Date }>` — must run inside `db.transaction`; takes `pg_advisory_xact_lock(hashtext('qredit.faucet'))`, checks the cooldown, inserts a row with `tx = 'pending'`.
  - `completeGrant(q: Queryable, id: number, tx: string): Promise<void>`; `cancelGrant(q: Queryable, id: number): Promise<void>`.

- [ ] **Step 1: Write the failing test `apps/be/test/tx.test.ts`**

```ts
import { beforeEach, describe, expect, test } from "bun:test";
import { type Db, memoryDb } from "../src/db.ts";
import { MIGRATIONS_DIR, runMigrations } from "../src/migrate.ts";
import { cancelGrant, completeGrant, getWatchState, reserveGrant, setWatchState } from "../src/store.ts";

let db: Db;
beforeEach(async () => {
  db = await memoryDb();
  await runMigrations(db, MIGRATIONS_DIR);
});
const NOW = new Date("2030-01-01T00:00:00Z");

describe("transaction", () => {
  test("commits on success and rolls back on error", async () => {
    await db.transaction((q) => setWatchState(q, "0xa", 5));
    await expect(db.transaction(async (q) => { await setWatchState(q, "0xa", 9); throw new Error("boom"); })).rejects.toThrow("boom");
    expect(await getWatchState(db, "0xa")).toBe(5);
  });
});

describe("faucet reservation", () => {
  test("only one reservation per address or ip inside the cooldown", async () => {
    const a = await db.transaction((q) => reserveGrant(q, "qor1a", "ip1", 24, NOW));
    expect(a.ok).toBe(true);
    const b = await db.transaction((q) => reserveGrant(q, "qor1a", "ip2", 24, NOW));
    const c = await db.transaction((q) => reserveGrant(q, "qor1b", "ip1", 24, NOW));
    expect(b.ok || c.ok).toBe(false);
    if (!b.ok) expect(b.retryAt.getTime()).toBeGreaterThan(NOW.getTime());
  });

  test("concurrent reservations for the same address grant exactly one", async () => {
    const results = await Promise.all(
      [1, 2, 3].map(() => db.transaction((q) => reserveGrant(q, "qor1a", "ip1", 24, NOW))),
    );
    expect(results.filter((r) => r.ok).length).toBe(1);
  });

  test("a cancelled reservation frees the slot; a completed one records the tx", async () => {
    const a = await db.transaction((q) => reserveGrant(q, "qor1a", "ip1", 24, NOW));
    if (!a.ok) throw new Error("expected ok");
    await cancelGrant(db, a.id);
    const b = await db.transaction((q) => reserveGrant(q, "qor1a", "ip1", 24, NOW));
    if (!b.ok) throw new Error("expected ok after cancel");
    await completeGrant(db, b.id, "0xtx");
    const [row] = await db.query<{ tx: string }>("select tx from qredit.faucet_grants where id = $1", [b.id]);
    expect(row.tx).toBe("0xtx");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun test test/tx.test.ts`
Expected: FAIL (`db.transaction` is not a function / `reserveGrant` not exported).

- [ ] **Step 3: Add transactions to `apps/be/src/db.ts`**

Replace the file with:
```ts
import postgres from "postgres";

export type Queryable = {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
};

export interface Db extends Queryable {
  exec(text: string): Promise<void>;
  /** Run fn in one transaction: commit when it resolves, roll back when it throws. */
  transaction<T>(fn: (q: Queryable) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

/** Supabase Postgres through the session pooler; prepared statements off for pooling. */
export function pgDb(url: string): Db {
  // onnotice: Postgres NOTICEs (e.g. "already exists, skipping") are not errors; keep logs clean.
  const sql = postgres(url, { max: 5, prepare: false, idle_timeout: 30, connect_timeout: 15, onnotice: () => {} });
  const queryable = (s: postgres.Sql | postgres.TransactionSql): Queryable => ({
    // Return a plain array, without postgres.js result metadata.
    query: async <T>(text: string, params: unknown[] = []) => Array.from(await s.unsafe(text, params as never[])) as T[],
  });
  return {
    ...queryable(sql),
    exec: async (text: string) => {
      await sql.unsafe(text);
    },
    transaction: <T>(fn: (q: Queryable) => Promise<T>) => sql.begin((t) => fn(queryable(t))) as Promise<T>,
    close: () => sql.end(),
  };
}

/** In-process Postgres (PGlite) for tests. */
export async function memoryDb(): Promise<Db> {
  const { PGlite } = await import("@electric-sql/pglite");
  const pg = new PGlite();
  return {
    query: async <T>(text: string, params: unknown[] = []) => (await pg.query(text, params)).rows as T[],
    exec: async (text: string) => {
      await pg.exec(text);
    },
    transaction: <T>(fn: (q: Queryable) => Promise<T>) =>
      pg.transaction((t) => fn({ query: async <R>(text: string, params: unknown[] = []) => (await t.query(text, params)).rows as R[] })),
    close: () => pg.close(),
  };
}
```

- [ ] **Step 4: Make the store work on any `Queryable` and add the reservation functions**

In `apps/be/src/store.ts`: change the import to `import type { Queryable } from "./db.ts";`, rename every `db: Db` parameter to `db: Queryable` (no other change to those functions), and append:

```ts
/** Reserve a faucet slot atomically. Call inside db.transaction. */
export async function reserveGrant(
  q: Queryable,
  address: string,
  ipHash: string,
  cooldownHours: number,
  now: Date,
): Promise<{ ok: true; id: number } | { ok: false; retryAt: Date }> {
  await q.query("select pg_advisory_xact_lock(hashtext('qredit.faucet'))");
  const last = await lastGrant(q, address, ipHash);
  if (last) {
    const retryAt = new Date(last.getTime() + cooldownHours * 3_600_000);
    if (retryAt > now) return { ok: false, retryAt };
  }
  const [r] = await q.query<{ id: string | number }>(
    "insert into qredit.faucet_grants (address, ip_hash, tx, created_at) values ($1, $2, 'pending', $3) returning id",
    [address, ipHash, now],
  );
  return { ok: true, id: Number(r.id) };
}

export async function completeGrant(q: Queryable, id: number, tx: string): Promise<void> {
  await q.query("update qredit.faucet_grants set tx = $2 where id = $1", [id, tx]);
}

export async function cancelGrant(q: Queryable, id: number): Promise<void> {
  await q.query("delete from qredit.faucet_grants where id = $1", [id]);
}
```

`lastGrant` keeps its query; `recordGrant` stays for now (Task 7 stops using it; remove it there).

- [ ] **Step 5: Run the whole suite**

Run: `bun test && bun run typecheck`
Expected: every earlier suite still passes, plus 4 in `tx.test.ts`.

- [ ] **Step 6: Commit**

```bash
git add apps/be/src/db.ts apps/be/src/store.ts apps/be/test/tx.test.ts
git commit -m "feat(be): add transactions and an atomic faucet reservation"
```

---

### Task 5: Relayer

**Files:**
- Create: `apps/be/src/relayer.ts`, `apps/be/test/relayer.test.ts`

**Interfaces:**
- Consumes: `serial`, `executionFailure`, `RestEvent`, `Sent` (Task 4); `PAY_SUPPLIER_SELECTOR` (Task 4).
- Produces:
  - `EXECUTE_EVM_TYPE_URL = "/qorechain.abstractaccount.v1.MsgExecuteEVM"`
  - `type RelayRequest = { typeUrl: string; value: { relayer: string; account: string; scheme: string; pubkey: string; signature: string; to: string; value: string; data: string; gasLimit: string; nonce: string } }` — `pubkey`, `signature`, `data` are base64.
  - `type RelayResult = { txHash: string; success: boolean; reason?: string }`
  - `validateRelay(req: RelayRequest, ctx: { relayer: string; vaults: Set<string>; maxGas: number }): string | null` — error message or null
  - `createRelayer(deps: { relayerAddress: string; vaults: () => Promise<Set<string>>; send: (msg: EncodeObject) => Promise<Sent>; events: (hash: string) => Promise<RestEvent[]>; maxGas?: number }): (req: RelayRequest) => Promise<RelayResult>` — throws `RelayRejected` (with `.message`) on validation failure.

- [ ] **Step 1: Write the failing test `apps/be/test/relayer.test.ts`**

```ts
import { describe, expect, test } from "bun:test";
import { encodeFunctionData, parseAbi } from "viem";
import { createRelayer, EXECUTE_EVM_TYPE_URL, type RelayRequest, RelayRejected, validateRelay } from "../src/relayer.ts";

const VAULT = "0x00000000000000000000000000000000000000aa";
const RELAYER = "qor1relayer";
const abi = parseAbi(["function paySupplier(address,uint256,uint256)", "function deliver(uint256,bytes32)"]);
const b64 = (hex: `0x${string}`) => Buffer.from(hex.slice(2), "hex").toString("base64");

const req = (over: Partial<RelayRequest["value"]> = {}, typeUrl = EXECUTE_EVM_TYPE_URL): RelayRequest => ({
  typeUrl,
  value: {
    relayer: RELAYER, account: "qor1spender", scheme: "ed25519",
    pubkey: Buffer.alloc(32, 1).toString("base64"), signature: Buffer.alloc(64, 2).toString("base64"),
    to: VAULT, value: "0",
    data: b64(encodeFunctionData({ abi, functionName: "paySupplier", args: ["0x00000000000000000000000000000000000000cc", 1000n, 1n] })),
    gasLimit: "200000", nonce: "3", ...over,
  },
});
const ctx = { relayer: RELAYER, vaults: new Set([VAULT]), maxGas: 1_000_000 };

describe("validateRelay", () => {
  test("accepts a paySupplier call to a known vault", () => {
    expect(validateRelay(req(), ctx)).toBeNull();
    expect(validateRelay(req({ to: VAULT.toUpperCase().replace("0X", "0x") }), ctx)).toBeNull();
  });
  test("refuses everything else", () => {
    expect(validateRelay(req({}, "/cosmos.bank.v1beta1.MsgSend"), ctx)).toMatch(/type/);
    expect(validateRelay(req({ relayer: "qor1other" }), ctx)).toMatch(/relayer/);
    expect(validateRelay(req({ to: "0x00000000000000000000000000000000000000ff" }), ctx)).toMatch(/vault/);
    expect(validateRelay(req({ value: "1" }), ctx)).toMatch(/value/);
    expect(validateRelay(req({ gasLimit: "5000000" }), ctx)).toMatch(/gas/);
    expect(validateRelay(req({ data: b64(encodeFunctionData({ abi, functionName: "deliver", args: [1n, `0x${"00".repeat(32)}`] })) }), ctx)).toMatch(/paySupplier/);
    expect(validateRelay(req({ nonce: "x" }), ctx)).toMatch(/nonce/);
  });
});

describe("createRelayer", () => {
  const deps = (events: { type: string; attributes: { key: string; value: string }[] }[], code = 0) => {
    const sent: unknown[] = [];
    return {
      sent,
      relay: createRelayer({
        relayerAddress: RELAYER,
        vaults: async () => new Set([VAULT]),
        send: async (msg) => { sent.push(msg); return { hash: "ABC", code, rawLog: code ? "out of gas" : undefined }; },
        events: async () => events,
      }),
    };
  };

  test("decodes base64 fields and reports success", async () => {
    const { sent, relay } = deps([{ type: "message", attributes: [] }]);
    expect(await relay(req())).toEqual({ txHash: "ABC", success: true });
    const msg = sent[0] as { typeUrl: string; value: { pubkey: Uint8Array; data: Uint8Array; nonce: string } };
    expect(msg.typeUrl).toBe(EXECUTE_EVM_TYPE_URL);
    expect(msg.value.pubkey).toBeInstanceOf(Uint8Array);
    expect(msg.value.pubkey.length).toBe(32);
    expect(Buffer.from(msg.value.data.slice(0, 4)).toString("hex")).toBe(Buffer.from(req().value.data, "base64").subarray(0, 4).toString("hex"));
  });

  test("a refused execution is reported as failure, not success", async () => {
    const { relay } = deps([{ type: "abstractaccount_execution_failed", attributes: [{ key: "reason", value: "over daily cap" }] }]);
    expect(await relay(req())).toEqual({ txHash: "ABC", success: false, reason: "over daily cap" });
  });

  test("a tx refused at CheckTx is a failure", async () => {
    const { relay } = deps([], 11);
    expect(await relay(req())).toEqual({ txHash: "ABC", success: false, reason: "code 11: out of gas" });
  });

  test("invalid requests are rejected before signing", async () => {
    const { sent, relay } = deps([]);
    await expect(relay(req({ value: "5" }))).rejects.toBeInstanceOf(RelayRejected);
    expect(sent.length).toBe(0);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun test test/relayer.test.ts`
Expected: FAIL, cannot find `../src/relayer.ts`.

- [ ] **Step 3: Write `apps/be/src/relayer.ts`**

```ts
import type { EncodeObject } from "@cosmjs/proto-signing";
import { executionFailure, type RestEvent, type Sent, serial } from "./chain/tx.ts";
import { PAY_SUPPLIER_SELECTOR } from "./chain/vault.ts";

export const EXECUTE_EVM_TYPE_URL = "/qorechain.abstractaccount.v1.MsgExecuteEVM";

export type RelayRequest = {
  typeUrl: string;
  value: {
    relayer: string; account: string; scheme: string;
    pubkey: string; signature: string; // base64
    to: string; value: string;
    data: string; // base64 calldata
    gasLimit: string; nonce: string;
  };
};
export type RelayResult = { txHash: string; success: boolean; reason?: string };

export class RelayRejected extends Error {}

const b64 = (s: string) => Uint8Array.from(Buffer.from(s, "base64"));

export function validateRelay(req: RelayRequest, ctx: { relayer: string; vaults: Set<string>; maxGas: number }): string | null {
  if (req.typeUrl !== EXECUTE_EVM_TYPE_URL) return `wrong message type: only ${EXECUTE_EVM_TYPE_URL} is relayed`;
  const v = req.value;
  if (v.relayer !== ctx.relayer) return "the message must name this relayer";
  if (!/^0x[0-9a-fA-F]{40}$/.test(v.to) || !ctx.vaults.has(v.to.toLowerCase())) return "the target is not a Qredit vault";
  if (v.value !== "0") return "value must be 0";
  if (!/^[0-9]+$/.test(v.gasLimit) || Number(v.gasLimit) > ctx.maxGas || Number(v.gasLimit) === 0) return `gas limit must be 1..${ctx.maxGas}`;
  if (!/^[0-9]+$/.test(v.nonce)) return "nonce must be a decimal integer";
  const data = b64(v.data);
  const selector = `0x${Buffer.from(data.subarray(0, 4)).toString("hex")}`;
  if (selector !== PAY_SUPPLIER_SELECTOR) return "only vault.paySupplier is relayed";
  return null;
}

export function createRelayer(deps: {
  relayerAddress: string;
  vaults: () => Promise<Set<string>>;
  send: (msg: EncodeObject) => Promise<Sent>;
  events: (hash: string) => Promise<RestEvent[]>;
  maxGas?: number;
}): (req: RelayRequest) => Promise<RelayResult> {
  const run = serial();
  return async (req) => {
    const error = validateRelay(req, { relayer: deps.relayerAddress, vaults: await deps.vaults(), maxGas: deps.maxGas ?? 1_000_000 });
    if (error) throw new RelayRejected(error);
    const v = req.value;
    const msg: EncodeObject = {
      typeUrl: EXECUTE_EVM_TYPE_URL,
      value: {
        relayer: v.relayer, account: v.account, scheme: v.scheme,
        pubkey: b64(v.pubkey), signature: b64(v.signature),
        to: v.to, value: v.value, data: b64(v.data), gasLimit: v.gasLimit, nonce: v.nonce,
      },
    };
    return run(async () => {
      const sent = await deps.send(msg);
      if (sent.code !== 0) return { txHash: sent.hash, success: false, reason: `code ${sent.code}: ${sent.rawLog ?? ""}` };
      const failure = executionFailure(await deps.events(sent.hash));
      return failure ? { txHash: sent.hash, success: false, reason: failure } : { txHash: sent.hash, success: true };
    });
  };
}
```

- [ ] **Step 4: Run the tests**

Run: `bun test test/relayer.test.ts && bun run typecheck`
Expected: 6 pass.

- [ ] **Step 5: Commit**

```bash
git add apps/be/src/relayer.ts apps/be/test/relayer.test.ts
git commit -m "feat(be): add the relayer that forwards only vault.paySupplier"
```

---

### Task 6: Watcher

**Files:**
- Create: `apps/be/src/watcher.ts`, `apps/be/test/watcher.test.ts`

**Interfaces:**
- Consumes: `applyVaultEvent`, `getWatchState`, `setWatchState`, `VaultEvent` (Task 3); `db.transaction` (Task 4b); `VAULT_EVENTS` (Task 4).
- Produces: `interface LogSource { latestBlock(): Promise<number>; events(vault: string, from: number, to: number): Promise<VaultEvent[]> }`; `syncVault(db: Db, src: LogSource, vault: string, startBlock: number, maxRange?: number): Promise<number>`; `viemLogSource(client: PublicClient): LogSource`.

- [ ] **Step 1: Write the failing test `apps/be/test/watcher.test.ts`**

```ts
import { beforeEach, describe, expect, test } from "bun:test";
import { type Db, memoryDb } from "../src/db.ts";
import { MIGRATIONS_DIR, runMigrations } from "../src/migrate.ts";
import { getWatchState, listOrders, type VaultEvent } from "../src/store.ts";
import { type LogSource, syncVault } from "../src/watcher.ts";

const V = "0x00000000000000000000000000000000000000aa";
let db: Db;
beforeEach(async () => {
  db = await memoryDb();
  await runMigrations(db, MIGRATIONS_DIR);
});

function fakeSource(head: number, events: VaultEvent[]) {
  const calls: [number, number][] = [];
  const src: LogSource = {
    latestBlock: async () => head,
    events: async (_v, from, to) => {
      calls.push([from, to]);
      return events.filter((e) => e.block >= from && e.block <= to);
    },
  };
  return { src, calls };
}

const placed = (id: string, block: number, logIndex = 0): VaultEvent => ({
  kind: "OrderPlaced", vault: V, orderId: id, block, logIndex, tx: `0x${id}`,
  buyer: "0x00000000000000000000000000000000000000bb", serviceId: 1, price: "5000000", requestRef: `0x${"1".repeat(64)}`, deadline: 9,
});

describe("syncVault", () => {
  test("scans from the start block in ranges and remembers where it stopped", async () => {
    const { src, calls } = fakeSource(4500, [placed("1", 1500), { kind: "Delivered", vault: V, orderId: "1", block: 3100, logIndex: 0, tx: "0xd", envelopeHash: `0x${"2".repeat(64)}` }]);
    expect(await syncVault(db, src, V, 1000, 2000)).toBe(4500);
    expect(calls).toEqual([[1000, 2999], [3000, 4500]]);
    expect(await getWatchState(db, V)).toBe(4500);
    expect((await listOrders(db, V))[0].status).toBe("delivered");
  });

  test("resumes after the saved block and applies events in log order", async () => {
    const first = fakeSource(1200, [placed("1", 1100)]);
    await syncVault(db, first.src, V, 1000);
    const second = fakeSource(1300, [placed("1", 1100), { kind: "Declined", vault: V, orderId: "1", block: 1250, logIndex: 1, tx: "0xe" }, placed("2", 1250, 0)]);
    await syncVault(db, second.src, V, 1000);
    expect(second.calls).toEqual([[1201, 1300]]);
    const orders = await listOrders(db, V);
    expect(orders.find((o) => o.orderId === "1")?.status).toBe("declined");
    expect(orders.find((o) => o.orderId === "2")?.status).toBe("open");
  });

  test("does nothing when already at head", async () => {
    const { src, calls } = fakeSource(1000, []);
    await syncVault(db, src, V, 1001);
    expect(calls).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun test test/watcher.test.ts`
Expected: FAIL, cannot find `../src/watcher.ts`.

- [ ] **Step 3: Write `apps/be/src/watcher.ts`**

```ts
import type { PublicClient } from "viem";
import { VAULT_EVENTS } from "./chain/vault.ts";
import type { Db } from "./db.ts";
import { applyVaultEvent, getWatchState, setWatchState, type VaultEvent } from "./store.ts";

export interface LogSource {
  latestBlock(): Promise<number>;
  events(vault: string, from: number, to: number): Promise<VaultEvent[]>;
}

/** Bring one vault's orders up to the chain head. Returns the last block scanned. */
export async function syncVault(db: Db, src: LogSource, vault: string, startBlock: number, maxRange = 2000): Promise<number> {
  const saved = await getWatchState(db, vault);
  let from = saved === null ? startBlock : saved + 1;
  const head = await src.latestBlock();
  let last = from - 1;
  while (from <= head) {
    const to = Math.min(head, from + maxRange - 1);
    const events = (await src.events(vault, from, to)).sort((a, b) => a.block - b.block || a.logIndex - b.logIndex);
    // Events of one range and the saved position commit together, or not at all.
    await db.transaction(async (q) => {
      for (const e of events) await applyVaultEvent(q, e);
      await setWatchState(q, vault, to);
    });
    last = to;
    from = to + 1;
  }
  return last;
}

export function viemLogSource(client: PublicClient): LogSource {
  return {
    latestBlock: async () => Number(await client.getBlockNumber()),
    async events(vault, from, to) {
      const logs = await client.getLogs({ address: vault as `0x${string}`, events: VAULT_EVENTS, fromBlock: BigInt(from), toBlock: BigInt(to) });
      return logs.map((l): VaultEvent => {
        const base = { vault: vault.toLowerCase(), orderId: String(l.args.orderId), block: Number(l.blockNumber), logIndex: Number(l.logIndex), tx: l.transactionHash.toLowerCase() };
        switch (l.eventName) {
          case "OrderPlaced":
            return { ...base, kind: "OrderPlaced", buyer: l.args.buyer!.toLowerCase(), serviceId: Number(l.args.serviceId), price: String(l.args.price), requestRef: l.args.requestRef!.toLowerCase(), deadline: Number(l.args.deadline) };
          case "Delivered":
            return { ...base, kind: "Delivered", envelopeHash: l.args.envelopeHash!.toLowerCase() };
          case "Declined":
            return { ...base, kind: "Declined" };
          default:
            return { ...base, kind: "Reclaimed" };
        }
      });
    },
  };
}
```

- [ ] **Step 4: Run the tests**

Run: `bun test test/watcher.test.ts && bun run typecheck`
Expected: 3 pass. If viem's typed `l.args` narrowing complains, cast `l` to `{ eventName: string; args: Record<string, any>; blockNumber: bigint; logIndex: number; transactionHash: string }` inside the map; behaviour must stay the same.

- [ ] **Step 5: Commit**

```bash
git add apps/be/src/watcher.ts apps/be/test/watcher.test.ts
git commit -m "feat(be): add the vault watcher"
```

---

### Task 7: Window keeper and faucet

**Files:**
- Create: `apps/be/src/windows.ts`, `apps/be/src/faucet.ts`, `apps/be/test/windows.test.ts`, `apps/be/test/faucet.test.ts`

**Interfaces:**
- Consumes: `broadcastHybrid`, `txEvents`, `serial`, `Net` (Task 4); `reserveGrant`, `completeGrant`, `cancelGrant`, `db.transaction` (Task 4b); `FUSD_DENOM` (Task 1). Remove the now unused `recordGrant` from `store.ts` and its use in `store.test.ts` (keep `lastGrant`, which `reserveGrant` uses).
- Produces:
  - `interface WindowChain { status(address: string): Promise<{ blocks: number; txs: number }>; open(acc: UnifiedAccount, targets: string[], o: WindowOptions): Promise<string> }`; `type WindowOptions = { blocks: number; maxTxs: number; maxValue: bigint }`
  - `keepWindows(items: { account: UnifiedAccount; targets: string[] }[], chain: WindowChain, o: WindowOptions & { minBlocks: number; minTxs?: number }): Promise<{ address: string; action: "kept" | "renewed" | "error"; tx?: string; error?: string }[]>`
  - `sdkWindowChain(net: Net): WindowChain`
  - `class FaucetCooldown extends Error { retryAt: Date }`; `createFaucet(deps: { db: Db; send: (address: string) => Promise<string>; cooldownHours: number; hashIp: (ip: string) => string; now?: () => Date }): (address: string, ip: string) => Promise<{ tx: string }>`; `treasurySender(net: Net, treasury: UnifiedAccount, uqor: bigint, fusdUnits: bigint): (address: string) => Promise<string>`; `ipHasher(salt: string): (ip: string) => string`

- [ ] **Step 1: Write the failing tests**

`apps/be/test/windows.test.ts`:
```ts
import { describe, expect, test } from "bun:test";
import type { UnifiedAccount } from "@qorechain/sdk";
import { keepWindows, type WindowChain } from "../src/windows.ts";

const acc = (cosmos: string) => ({ cosmos, evm: "0x0" }) as unknown as UnifiedAccount;
const opts = { blocks: 17280, maxTxs: 500, maxValue: 25_000_000n, minBlocks: 3600, minTxs: 10 };

describe("keepWindows", () => {
  test("renews only windows that are low on blocks or txs", async () => {
    const opened: [string, string[]][] = [];
    const chain: WindowChain = {
      status: async (a) => (a === "qor1full" ? { blocks: 9000, txs: 400 } : a === "qor1low" ? { blocks: 100, txs: 400 } : { blocks: 9000, txs: 3 }),
      open: async (a, targets) => { opened.push([a.cosmos, targets]); return `TX-${a.cosmos}`; },
    };
    const res = await keepWindows(
      [{ account: acc("qor1full"), targets: ["0xa"] }, { account: acc("qor1low"), targets: ["0xb"] }, { account: acc("qor1fewtx"), targets: ["0xc"] }],
      chain, opts,
    );
    expect(res).toEqual([
      { address: "qor1full", action: "kept" },
      { address: "qor1low", action: "renewed", tx: "TX-qor1low" },
      { address: "qor1fewtx", action: "renewed", tx: "TX-qor1fewtx" },
    ]);
    expect(opened).toEqual([["qor1low", ["0xb"]], ["qor1fewtx", ["0xc"]]]);
  });

  test("one failing account does not stop the others", async () => {
    const chain: WindowChain = {
      status: async (a) => { if (a === "qor1bad") throw new Error("rpc down"); return { blocks: 0, txs: 0 }; },
      open: async () => "TX",
    };
    const res = await keepWindows([{ account: acc("qor1bad"), targets: [] }, { account: acc("qor1ok"), targets: [] }], chain, opts);
    expect(res[0]).toEqual({ address: "qor1bad", action: "error", error: "rpc down" });
    expect(res[1]).toEqual({ address: "qor1ok", action: "renewed", tx: "TX" });
  });
});
```

`apps/be/test/faucet.test.ts`:
```ts
import { beforeEach, describe, expect, test } from "bun:test";
import { type Db, memoryDb } from "../src/db.ts";
import { createFaucet, FaucetCooldown, ipHasher } from "../src/faucet.ts";
import { MIGRATIONS_DIR, runMigrations } from "../src/migrate.ts";

let db: Db;
beforeEach(async () => {
  db = await memoryDb();
  await runMigrations(db, MIGRATIONS_DIR);
});

describe("faucet", () => {
  test("sends once per cooldown per address and per ip", async () => {
    const sent: string[] = [];
    const faucet = createFaucet({ db, cooldownHours: 24, hashIp: ipHasher("salt-salt-salt-salt"), send: async (a) => { sent.push(a); return `TX${sent.length}`; } });
    expect(await faucet("qor1a", "1.1.1.1")).toEqual({ tx: "TX1" });
    await expect(faucet("qor1a", "2.2.2.2")).rejects.toBeInstanceOf(FaucetCooldown);
    await expect(faucet("qor1b", "1.1.1.1")).rejects.toBeInstanceOf(FaucetCooldown);
    expect(await faucet("qor1c", "3.3.3.3")).toEqual({ tx: "TX2" });
    expect(sent).toEqual(["qor1a", "qor1c"]);
  });

  test("allows again after the cooldown", async () => {
    let now = new Date("2030-01-01T00:00:00Z");
    const faucet = createFaucet({ db, cooldownHours: 1, hashIp: ipHasher("salt-salt-salt-salt"), send: async () => "TX", now: () => now });
    await faucet("qor1a", "1.1.1.1");
    await db.query("update qredit.faucet_grants set created_at = $1", [new Date("2030-01-01T00:00:00Z")]);
    now = new Date("2030-01-01T01:00:01Z");
    expect(await faucet("qor1a", "1.1.1.1")).toEqual({ tx: "TX" });
  });

  test("a failed send releases the reservation", async () => {
    let fail = true;
    const faucet = createFaucet({ db, cooldownHours: 24, hashIp: ipHasher("salt-salt-salt-salt"), send: async () => { if (fail) throw new Error("rpc down"); return "TX"; } });
    await expect(faucet("qor1a", "1.1.1.1")).rejects.toThrow("rpc down");
    fail = false;
    expect(await faucet("qor1a", "1.1.1.1")).toEqual({ tx: "TX" });
  });

  test("ip hashes are salted and stable", () => {
    const h = ipHasher("salt-salt-salt-salt");
    expect(h("1.1.1.1")).toBe(h("1.1.1.1"));
    expect(h("1.1.1.1")).not.toBe(ipHasher("other-salt-other")("1.1.1.1"));
    expect(h("1.1.1.1")).not.toContain("1.1.1.1");
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `bun test test/windows.test.ts test/faucet.test.ts`
Expected: FAIL, modules not found.

- [ ] **Step 3: Write `apps/be/src/windows.ts`**

```ts
import { openEvmWindowMsg, type UnifiedAccount } from "@qorechain/sdk";
import { evmWindowStatus } from "@qorechain/evm";
import { broadcastHybrid, type Net, txEvents } from "./chain/tx.ts";

export type WindowOptions = { blocks: number; maxTxs: number; maxValue: bigint };
export interface WindowChain {
  status(address: string): Promise<{ blocks: number; txs: number }>;
  open(acc: UnifiedAccount, targets: string[], o: WindowOptions): Promise<string>;
}

export async function keepWindows(
  items: { account: UnifiedAccount; targets: string[] }[],
  chain: WindowChain,
  o: WindowOptions & { minBlocks: number; minTxs?: number },
): Promise<{ address: string; action: "kept" | "renewed" | "error"; tx?: string; error?: string }[]> {
  const out: { address: string; action: "kept" | "renewed" | "error"; tx?: string; error?: string }[] = [];
  for (const { account, targets } of items) {
    try {
      const s = await chain.status(account.cosmos);
      if (s.blocks >= o.minBlocks && s.txs >= (o.minTxs ?? 10)) {
        out.push({ address: account.cosmos, action: "kept" });
        continue;
      }
      out.push({ address: account.cosmos, action: "renewed", tx: await chain.open(account, targets, o) });
    } catch (e) {
      out.push({ address: account.cosmos, action: "error", error: (e as Error).message });
    }
  }
  return out;
}

export function sdkWindowChain(net: Net): WindowChain {
  return {
    async status(address) {
      const w = await evmWindowStatus({ rest: net.rest, address });
      if (!w.found || !w.live) return { blocks: 0, txs: 0 };
      return { blocks: Number(w.remainingBlocks), txs: Number(w.remainingTxs) };
    },
    async open(acc, targets, o) {
      const msg = openEvmWindowMsg({
        sender: acc.cosmos,
        blocks: BigInt(o.blocks),
        maxTxs: BigInt(o.maxTxs),
        maxValue: o.maxValue.toString(),
        allowedTargets: targets.map((t) => t.toLowerCase()),
      });
      const sent = await broadcastHybrid(net, acc, [msg], { memo: "qredit operator window" });
      if (sent.code !== 0) throw new Error(`window refused: code ${sent.code} ${sent.rawLog ?? ""}`);
      await txEvents(net.rest, sent.hash);
      return sent.hash;
    },
  };
}
```

- [ ] **Step 4: Write `apps/be/src/faucet.ts`**

```ts
import { createHash } from "node:crypto";
import type { UnifiedAccount } from "@qorechain/sdk";
import { broadcastHybrid, type Net, serial, txEvents } from "./chain/tx.ts";
import { FUSD_DENOM } from "./config.ts";
import type { Db } from "./db.ts";
import { cancelGrant, completeGrant, reserveGrant } from "./store.ts";

export class FaucetCooldown extends Error {
  constructor(readonly retryAt: Date) {
    super(`test funds were already sent to this address or network; try again after ${retryAt.toISOString()}`);
  }
}

export const ipHasher = (salt: string) => (ip: string) => createHash("sha256").update(`${salt}|${ip}`).digest("hex");

export function createFaucet(deps: {
  db: Db;
  send: (address: string) => Promise<string>;
  cooldownHours: number;
  hashIp: (ip: string) => string;
  now?: () => Date;
}): (address: string, ip: string) => Promise<{ tx: string }> {
  const now = deps.now ?? (() => new Date());
  return async (address, ip) => {
    const ipHash = deps.hashIp(ip);
    // Reserve atomically (advisory lock + check + insert in one transaction), then send.
    const slot = await deps.db.transaction((q) => reserveGrant(q, address, ipHash, deps.cooldownHours, now()));
    if (!slot.ok) throw new FaucetCooldown(slot.retryAt);
    try {
      const tx = await deps.send(address);
      await completeGrant(deps.db, slot.id, tx);
      return { tx };
    } catch (e) {
      await cancelGrant(deps.db, slot.id);
      throw e;
    }
  };
}

/** One native MsgSend with test QOR and faucet fUSD (bank coin); coins sorted by denom. */
export function treasurySender(net: Net, treasury: UnifiedAccount, uqor: bigint, fusdUnits: bigint): (address: string) => Promise<string> {
  const run = serial();
  return (address) =>
    run(async () => {
      const amount = [
        { denom: FUSD_DENOM, amount: fusdUnits.toString() },
        { denom: "uqor", amount: uqor.toString() },
      ].sort((a, b) => (a.denom < b.denom ? -1 : 1));
      const msg = { typeUrl: "/cosmos.bank.v1beta1.MsgSend", value: { fromAddress: treasury.cosmos, toAddress: address, amount } };
      const sent = await broadcastHybrid(net, treasury, [msg], { memo: "Qredit test funds", gas: "300000", feeUqor: "60000" });
      if (sent.code !== 0) throw new Error(`treasury send refused: code ${sent.code} ${sent.rawLog ?? ""}`);
      await txEvents(net.rest, sent.hash);
      return sent.hash;
    });
}
```

- [ ] **Step 5: Run the tests**

Run: `bun test test/windows.test.ts test/faucet.test.ts && bun run typecheck`
Expected: 6 pass. If `evmWindowStatus` field names differ (`remainingBlocks`, `remainingTxs`, `found`, `live`), take them from `node_modules/@qorechain/evm/dist/window.d.ts` (the spikes used these names).

- [ ] **Step 6: Commit**

```bash
git add apps/be/src/windows.ts apps/be/src/faucet.ts apps/be/test/windows.test.ts apps/be/test/faucet.test.ts
git commit -m "feat(be): add the operator window keeper and the test-funds faucet"
```

---

### Task 8: HTTP API and card verification

**Files:**
- Create: `apps/be/src/cards.ts`, `apps/be/src/http.ts`, `apps/be/test/http.test.ts`

**Interfaces:**
- Consumes: store functions (Task 3), `RelayRequest`, `RelayResult`, `RelayRejected` (Task 5), `FaucetCooldown` (Task 7).
- Produces: `createApp(deps: AppDeps): Hono`, where
  `AppDeps = { db: Db; engineToken: string; corsOrigins: string[]; relayerAddress: string; relay: (r: RelayRequest) => Promise<RelayResult>; faucet: (address: string, ip: string) => Promise<{ tx: string }>; verifyCard: (address: string, card: unknown) => Promise<boolean> }`;
  `chainCardVerifier(net: Net): (address: string, card: unknown) => Promise<boolean>`.
- Routes (JSON; errors `{ error: string }`):

| Method | Path | Auth | Body / query | Response |
|---|---|---|---|---|
| GET | `/health` | — | — | `{ ok: true }` |
| GET | `/v1/relayer` | — | — | `{ address }` |
| GET | `/v1/businesses` | — | — | `Business[]` |
| GET | `/v1/businesses/:slug` | — | — | `Business` or 404 |
| POST | `/v1/businesses` | engine | `Business` | 204 |
| POST | `/v1/envelopes` | `request`: public; `report`/`sample`: engine | `{ kind, body }` (body ≤ 262,144 bytes) | `{ hash }` |
| GET | `/v1/envelopes/:hash` | — | — | `{ kind, body }` or 404 |
| PUT | `/v1/cards/:address` | — | `{ card }`, verified on chain | 204, or 422 |
| GET | `/v1/cards/:address` | — | — | `{ card }` or 404 |
| GET | `/v1/decisions?vault=&limit=` | — | — | `Decision[]` |
| POST | `/v1/decisions` | engine | `Decision` | `{ id }` |
| GET | `/v1/orders?vault=&status=` | — | — | `Order[]` |
| POST | `/v1/orders/claim` | engine | `{ vaults: string[] }` | `{ order: Order \| null }` |
| POST | `/v1/relay` | engine | `RelayRequest` | `RelayResult`, or 422 if rejected |
| POST | `/v1/faucet` | — | `{ address }` | `{ tx }`, or 429 with `retryAt` |

- [ ] **Step 1: Write the failing test `apps/be/test/http.test.ts`**

```ts
import { beforeEach, describe, expect, test } from "bun:test";
import { type Db, memoryDb } from "../src/db.ts";
import { FaucetCooldown } from "../src/faucet.ts";
import { createApp } from "../src/http.ts";
import { MIGRATIONS_DIR, runMigrations } from "../src/migrate.ts";
import { RelayRejected } from "../src/relayer.ts";
import { applyVaultEvent } from "../src/store.ts";

const TOKEN = "t".repeat(32);
const V = "0x00000000000000000000000000000000000000aa";
const ADDR = "qor1lcukj5fkcfqxfphjsp5snjj5lrngy6sxug7jwl";
let db: Db;
let app: ReturnType<typeof createApp>;
let faucetCalls: [string, string][];

beforeEach(async () => {
  db = await memoryDb();
  await runMigrations(db, MIGRATIONS_DIR);
  faucetCalls = [];
  app = createApp({
    db, engineToken: TOKEN, corsOrigins: ["https://app.qredit.fun"], relayerAddress: "qor1relayer",
    relay: async (r) => { if (r.value.value !== "0") throw new RelayRejected("value must be 0"); return { txHash: "H", success: true }; },
    faucet: async (address, ip) => { faucetCalls.push([address, ip]); if (address === ADDR && faucetCalls.length > 1) throw new FaucetCooldown(new Date("2030-01-01T00:00:00Z")); return { tx: "F" }; },
    verifyCard: async (_a, card) => (card as { ok?: boolean }).ok === true,
  });
});

const engine = { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" };
const json = { "content-type": "application/json" };
const post = (path: string, body: unknown, headers: Record<string, string> = json) => app.request(path, { method: "POST", headers, body: JSON.stringify(body) });

describe("public routes", () => {
  test("health and relayer", async () => {
    expect(await (await app.request("/health")).json()).toEqual({ ok: true });
    expect(await (await app.request("/v1/relayer")).json()).toEqual({ address: "qor1relayer" });
  });

  test("request envelopes round trip; report envelopes need the engine", async () => {
    const res = await post("/v1/envelopes", { kind: "request", body: "sealed-bytes" });
    expect(res.status).toBe(200);
    const { hash } = (await res.json()) as { hash: string };
    expect(await (await app.request(`/v1/envelopes/${hash}`)).json()).toEqual({ kind: "request", body: "sealed-bytes" });
    expect((await post("/v1/envelopes", { kind: "report", body: "x" })).status).toBe(401);
    expect((await post("/v1/envelopes", { kind: "report", body: "x" }, engine)).status).toBe(200);
    expect((await app.request(`/v1/envelopes/0x${"0".repeat(64)}`)).status).toBe(404);
    expect((await post("/v1/envelopes", { kind: "request", body: "x".repeat(262_145) })).status).toBe(413);
    expect((await post("/v1/envelopes", { kind: "nope", body: "x" })).status).toBe(400);
  });

  test("cards are stored only when they verify", async () => {
    const put = (card: unknown) => app.request(`/v1/cards/${ADDR}`, { method: "PUT", headers: json, body: JSON.stringify({ card }) });
    expect((await put({ ok: false })).status).toBe(422);
    expect((await app.request(`/v1/cards/${ADDR}`)).status).toBe(404);
    expect((await put({ ok: true })).status).toBe(204);
    expect(await (await app.request(`/v1/cards/${ADDR}`)).json()).toEqual({ card: { ok: true } });
    expect((await app.request("/v1/cards/not-an-address", { method: "PUT", headers: json, body: "{}" })).status).toBe(400);
  });

  test("faucet takes the client ip from x-forwarded-for and maps cooldown to 429", async () => {
    const res = await post("/v1/faucet", { address: ADDR }, { ...json, "x-forwarded-for": "9.9.9.9, 10.0.0.1" });
    expect(await res.json()).toEqual({ tx: "F" });
    expect(faucetCalls[0]).toEqual([ADDR, "9.9.9.9"]);
    const again = await post("/v1/faucet", { address: ADDR });
    expect(again.status).toBe(429);
    expect(await again.json()).toMatchObject({ retryAt: "2030-01-01T00:00:00.000Z" });
    expect((await post("/v1/faucet", { address: "0xabc" })).status).toBe(400);
  });

  test("cors allows the app origin only", async () => {
    const ok = await app.request("/health", { headers: { origin: "https://app.qredit.fun" } });
    expect(ok.headers.get("access-control-allow-origin")).toBe("https://app.qredit.fun");
    const other = await app.request("/health", { headers: { origin: "https://evil.example" } });
    expect(other.headers.get("access-control-allow-origin")).toBeNull();
  });
});

describe("engine routes", () => {
  const biz = { slug: "counterparty", vault: V, name: "Counterparty Check", tagline: "t", services: [], operator: V, spender: V, startBlock: 5 };

  test("reject a missing or wrong token", async () => {
    expect((await post("/v1/businesses", biz)).status).toBe(401);
    expect((await post("/v1/businesses", biz, { ...json, authorization: `Bearer ${"x".repeat(32)}` })).status).toBe(401);
  });

  test("businesses, orders, claims and decisions", async () => {
    expect((await post("/v1/businesses", biz, engine)).status).toBe(204);
    expect(((await (await app.request("/v1/businesses")).json()) as unknown[]).length).toBe(1);
    expect((await app.request("/v1/businesses/counterparty")).status).toBe(200);
    expect((await app.request("/v1/businesses/none")).status).toBe(404);

    await applyVaultEvent(db, { kind: "OrderPlaced", vault: V, orderId: "1", block: 9, logIndex: 0, tx: "0x1", buyer: V, serviceId: 0, price: "1", requestRef: `0x${"a".repeat(64)}`, deadline: 1 });
    expect(((await (await app.request(`/v1/orders?vault=${V}`)).json()) as unknown[]).length).toBe(1);
    const claim = (await (await post("/v1/orders/claim", { vaults: [V] }, engine)).json()) as { order: { orderId: string } | null };
    expect(claim.order?.orderId).toBe("1");
    expect(((await (await post("/v1/orders/claim", { vaults: [V] }, engine)).json()) as { order: null }).order).toBeNull();

    const d = await post("/v1/decisions", { vault: V, orderId: "1", decision: "accepted", reason: "fits budget", suppliers: [], cost: "0" }, engine);
    expect(await d.json()).toEqual({ id: 1 });
    expect(((await (await app.request(`/v1/decisions?vault=${V}`)).json()) as unknown[]).length).toBe(1);
  });

  test("relay maps a rejection to 422", async () => {
    const r = (value: string) => ({ typeUrl: "x", value: { relayer: "qor1relayer", account: "a", scheme: "ed25519", pubkey: "", signature: "", to: V, value, data: "", gasLimit: "1", nonce: "0" } });
    expect(await (await post("/v1/relay", r("0"), engine)).json()).toEqual({ txHash: "H", success: true });
    const bad = await post("/v1/relay", r("9"), engine);
    expect(bad.status).toBe(422);
    expect(await bad.json()).toEqual({ error: "value must be 0" });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun test test/http.test.ts`
Expected: FAIL, cannot find `../src/http.ts`.

- [ ] **Step 3: Write `apps/be/src/cards.ts`**

```ts
import { verifyRecipientCard, type RecipientCard } from "@qorechain/qoreseal";
import { fetchMlkemPublicKey } from "@qorechain/qoreseal/network";
import { fetchPqcStatus } from "@qorechain/sdk";
import type { Net } from "./chain/tx.ts";

const bytes = (k: string | Uint8Array): Uint8Array =>
  typeof k === "string" ? Uint8Array.from(Buffer.from(k.replace(/^0x/, ""), /^(0x)?[0-9a-fA-F]+$/.test(k) ? "hex" : "base64")) : k;

/** A card is accepted only if it binds the account's on-chain ML-KEM-1024 and ML-DSA-87 keys. */
export function chainCardVerifier(net: Net): (address: string, card: unknown) => Promise<boolean> {
  return async (address, card) => {
    try {
      const mlkemPublicKey = await fetchMlkemPublicKey({ rest: net.rest, address });
      const pqc = await fetchPqcStatus({ rest: net.rest, address });
      if (!pqc.registered || !pqc.pubkey) return false;
      verifyRecipientCard({ card: card as RecipientCard, chainId: net.chainId, address, mlkemPublicKey, pqPublicKey: bytes(pqc.pubkey) });
      return true;
    } catch {
      return false;
    }
  };
}
```

- [ ] **Step 4: Write `apps/be/src/http.ts`**

```ts
import { timingSafeEqual } from "node:crypto";
import { Hono, type Context } from "hono";
import { cors } from "hono/cors";
import { z } from "zod";
import type { Db } from "./db.ts";
import { FaucetCooldown } from "./faucet.ts";
import { type RelayRequest, RelayRejected, type RelayResult } from "./relayer.ts";
import * as store from "./store.ts";

export type AppDeps = {
  db: Db;
  engineToken: string;
  corsOrigins: string[];
  relayerAddress: string;
  relay: (r: RelayRequest) => Promise<RelayResult>;
  faucet: (address: string, ip: string) => Promise<{ tx: string }>;
  verifyCard: (address: string, card: unknown) => Promise<boolean>;
};

const MAX_ENVELOPE = 262_144;
const qorAddress = z.string().regex(/^qor1[02-9ac-hj-np-z]{38,58}$/);
const evmAddress = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
const hash32 = z.string().regex(/^0x[0-9a-fA-F]{64}$/);

const businessSchema = z.object({
  slug: z.string().regex(/^[a-z0-9-]{2,40}$/), vault: evmAddress, name: z.string().min(1).max(80),
  tagline: z.string().max(200), services: z.unknown(), operator: evmAddress, spender: evmAddress,
  startBlock: z.number().int().nonnegative(),
});
const decisionSchema = z.object({
  vault: evmAddress, orderId: z.string().nullable(), decision: z.enum(["accepted", "declined", "delivered", "failed"]),
  reason: z.string().max(500), suppliers: z.array(z.unknown()).max(20), cost: z.string().regex(/^[0-9]+$/),
});
const relaySchema = z.object({
  typeUrl: z.string(),
  value: z.object({
    relayer: z.string(), account: z.string(), scheme: z.string(), pubkey: z.string(), signature: z.string(),
    to: z.string(), value: z.string(), data: z.string(), gasLimit: z.string(), nonce: z.string(),
  }),
});

export function createApp(deps: AppDeps): Hono {
  const app = new Hono();
  app.use("*", cors({ origin: (origin) => (deps.corsOrigins.includes(origin) ? origin : null), allowMethods: ["GET", "POST", "PUT"] }));

  const token = Buffer.from(deps.engineToken);
  const isEngine = (c: Context) => {
    const given = Buffer.from((c.req.header("authorization") ?? "").replace(/^Bearer /, ""));
    return given.length === token.length && timingSafeEqual(given, token);
  };
  const bad = (c: Context, error: string, status: 400 | 401 | 404 | 413 | 422 | 429 = 400) => c.json({ error }, status);
  const body = async <T>(c: Context, schema: z.ZodType<T>): Promise<T | null> => {
    const parsed = schema.safeParse(await c.req.json().catch(() => undefined));
    return parsed.success ? parsed.data : null;
  };

  app.get("/health", (c) => c.json({ ok: true }));
  app.get("/v1/relayer", (c) => c.json({ address: deps.relayerAddress }));

  app.get("/v1/businesses", async (c) => c.json(await store.listBusinesses(deps.db)));
  app.get("/v1/businesses/:slug", async (c) => {
    const b = await store.getBusiness(deps.db, c.req.param("slug"));
    return b ? c.json(b) : bad(c, "not found", 404);
  });
  app.post("/v1/businesses", async (c) => {
    if (!isEngine(c)) return bad(c, "unauthorized", 401);
    const b = await body(c, businessSchema);
    if (!b) return bad(c, "invalid business");
    await store.upsertBusiness(deps.db, b);
    return c.body(null, 204);
  });

  app.post("/v1/envelopes", async (c) => {
    const e = await body(c, z.object({ kind: z.enum(["request", "report", "sample"]), body: z.string().min(1) }));
    if (!e) return bad(c, "invalid envelope");
    if (new TextEncoder().encode(e.body).length > MAX_ENVELOPE) return bad(c, "envelope too large", 413);
    if (e.kind !== "request" && !isEngine(c)) return bad(c, "unauthorized", 401);
    return c.json({ hash: await store.putEnvelope(deps.db, e.kind, e.body) });
  });
  app.get("/v1/envelopes/:hash", async (c) => {
    const h = hash32.safeParse(c.req.param("hash"));
    if (!h.success) return bad(c, "invalid hash");
    const e = await store.getEnvelope(deps.db, h.data);
    return e ? c.json(e) : bad(c, "not found", 404);
  });

  app.put("/v1/cards/:address", async (c) => {
    const address = qorAddress.safeParse(c.req.param("address"));
    if (!address.success) return bad(c, "invalid address");
    const b = await body(c, z.object({ card: z.unknown() }));
    if (!b || b.card === undefined) return bad(c, "invalid card");
    if (!(await deps.verifyCard(address.data, b.card))) return bad(c, "the card does not match the keys registered on chain", 422);
    await store.putCard(deps.db, address.data, b.card);
    return c.body(null, 204);
  });
  app.get("/v1/cards/:address", async (c) => {
    const card = await store.getCard(deps.db, c.req.param("address"));
    return card === null ? bad(c, "not found", 404) : c.json({ card });
  });

  app.get("/v1/decisions", async (c) => {
    const vault = evmAddress.safeParse(c.req.query("vault"));
    if (!vault.success) return bad(c, "invalid vault");
    const limit = Math.min(Math.max(Number(c.req.query("limit") ?? 50) || 50, 1), 200);
    return c.json(await store.listDecisions(deps.db, vault.data, limit));
  });
  app.post("/v1/decisions", async (c) => {
    if (!isEngine(c)) return bad(c, "unauthorized", 401);
    const d = await body(c, decisionSchema);
    if (!d) return bad(c, "invalid decision");
    return c.json({ id: await store.addDecision(deps.db, d) });
  });

  app.get("/v1/orders", async (c) => {
    const vault = evmAddress.safeParse(c.req.query("vault"));
    if (!vault.success) return bad(c, "invalid vault");
    const status = z.enum(["open", "claimed", "delivered", "declined", "reclaimed"]).optional().safeParse(c.req.query("status"));
    return c.json(await store.listOrders(deps.db, vault.data, status.success ? status.data : undefined));
  });
  app.post("/v1/orders/claim", async (c) => {
    if (!isEngine(c)) return bad(c, "unauthorized", 401);
    const b = await body(c, z.object({ vaults: z.array(evmAddress).max(50) }));
    if (!b) return bad(c, "invalid claim");
    return c.json({ order: await store.claimNextOrder(deps.db, b.vaults) });
  });

  app.post("/v1/relay", async (c) => {
    if (!isEngine(c)) return bad(c, "unauthorized", 401);
    const r = await body(c, relaySchema);
    if (!r) return bad(c, "invalid relay request");
    try {
      return c.json(await deps.relay(r));
    } catch (e) {
      if (e instanceof RelayRejected) return bad(c, e.message, 422);
      throw e;
    }
  });

  app.post("/v1/faucet", async (c) => {
    const b = await body(c, z.object({ address: qorAddress }));
    if (!b) return bad(c, "invalid qor1 address");
    const ip = (c.req.header("x-forwarded-for") ?? "").split(",")[0]?.trim() || "unknown";
    try {
      return c.json(await deps.faucet(b.address, ip));
    } catch (e) {
      if (e instanceof FaucetCooldown) return c.json({ error: e.message, retryAt: e.retryAt.toISOString() }, 429);
      throw e;
    }
  });

  app.onError((err, c) => {
    console.error("[http]", err.message);
    return c.json({ error: "internal error" }, 500);
  });

  return app;
}
```

- [ ] **Step 5: Run the tests**

Run: `bun test test/http.test.ts && bun run typecheck`
Expected: 8 pass. If `RecipientCard` is not exported from `@qorechain/qoreseal`'s root, import the type from where `verifyRecipientCard` is declared (see `node_modules/@qorechain/qoreseal/dist/index.d.ts`).

- [ ] **Step 6: Commit**

```bash
git add apps/be/src/cards.ts apps/be/src/http.ts apps/be/test/http.test.ts
git commit -m "feat(be): add the HTTP API and on-chain card verification"
```

---

### Task 9: Server wiring and live smoke test

**Files:**
- Create: `apps/be/src/server.ts`
- Modify: `apps/be/CLAUDE.md` (add "Deployed" section with the smoke results)

**Interfaces:**
- Consumes: everything above.

- [ ] **Step 1: Write `apps/be/src/server.ts`**

```ts
import { createPublicClient, http } from "viem";
import { accountFrom, parseKeyList, parseKeySpec } from "./chain/keys.ts";
import { broadcastHybrid, type Net, txEvents } from "./chain/tx.ts";
import { chainCardVerifier } from "./cards.ts";
import { loadConfig } from "./config.ts";
import { pgDb } from "./db.ts";
import { createFaucet, ipHasher, treasurySender } from "./faucet.ts";
import { createApp } from "./http.ts";
import { MIGRATIONS_DIR, runMigrations } from "./migrate.ts";
import { createRelayer } from "./relayer.ts";
import { listBusinesses } from "./store.ts";
import { syncVault, viemLogSource } from "./watcher.ts";
import { keepWindows, sdkWindowChain } from "./windows.ts";

const cfg = loadConfig();
const net: Net = { chainId: cfg.QORE_CHAIN_ID, rest: cfg.QORE_REST_URL, rpc: cfg.QORE_RPC_URL };
const db = pgDb(cfg.DATABASE_URL);
console.log("[migrate] applied:", await runMigrations(db, MIGRATIONS_DIR));

const relayer = await accountFrom(parseKeySpec(cfg.RELAYER_KEY));
const treasury = await accountFrom(parseKeySpec(cfg.TREASURY_KEY));
const operators = await Promise.all(parseKeyList(cfg.OPERATOR_KEYS).map(accountFrom));
const client = createPublicClient({ transport: http(cfg.QORE_EVM_URL) });

const vaultSet = async () => new Set((await listBusinesses(db)).map((b) => b.vault));
const relay = createRelayer({
  relayerAddress: relayer.cosmos,
  vaults: vaultSet,
  send: (msg) => broadcastHybrid(net, relayer, [msg], { memo: "qredit relay", gas: "1500000", feeUqor: "200000" }),
  events: (hash) => txEvents(net.rest, hash),
});
const faucet = createFaucet({
  db,
  send: treasurySender(net, treasury, cfg.FAUCET_UQOR, cfg.FAUCET_FUSD_UNITS),
  cooldownHours: cfg.FAUCET_COOLDOWN_HOURS,
  hashIp: ipHasher(cfg.IP_SALT),
});

const app = createApp({
  db,
  engineToken: cfg.ENGINE_TOKEN,
  corsOrigins: cfg.CORS_ORIGINS.split(",").map((s) => s.trim()).filter(Boolean),
  relayerAddress: relayer.cosmos,
  relay,
  faucet,
  verifyCard: chainCardVerifier(net),
});

function loop(name: string, everyMs: number, fn: () => Promise<void>) {
  let busy = false;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      await fn();
    } catch (e) {
      console.error(`[${name}]`, (e as Error).message);
    } finally {
      busy = false;
    }
  };
  setInterval(tick, everyMs);
  void tick();
}

const logs = viemLogSource(client);
loop("watcher", cfg.WATCH_INTERVAL_MS, async () => {
  for (const b of await listBusinesses(db)) await syncVault(db, logs, b.vault, b.startBlock);
});

const windowChain = sdkWindowChain(net);
loop("windows", cfg.WINDOW_CHECK_INTERVAL_MS, async () => {
  const businesses = await listBusinesses(db);
  const items = operators
    .map((account) => ({ account, targets: businesses.filter((b) => b.operator === account.evm.toLowerCase()).map((b) => b.vault) }))
    .filter((i) => i.targets.length > 0);
  for (const r of await keepWindows(items, windowChain, {
    blocks: 17_280, maxTxs: cfg.WINDOW_MAX_TXS, maxValue: cfg.WINDOW_MAX_UQOR, minBlocks: cfg.WINDOW_MIN_BLOCKS,
  })) {
    if (r.action !== "kept") console.log("[windows]", JSON.stringify(r));
  }
});

Bun.serve({ port: cfg.PORT, fetch: app.fetch });
console.log(`[http] listening on :${cfg.PORT}; relayer ${relayer.cosmos}; treasury ${treasury.cosmos}; operators ${operators.length}`);
```

- [ ] **Step 2: Typecheck and run the full suite**

Run (in `apps/be`): `bun run typecheck && bun test`
Expected: all suites pass (config 4, migrate 2, store 10, chain 4, tx 4, relayer 6, watcher 3, windows 2, faucet 4, http 8).

- [ ] **Step 3: Prepare a local `.env` for the smoke test**

The human has already put `DATABASE_URL` in `apps/be/.env`. Add the rest without printing secrets:

```bash
cd apps/be
printf 'ENGINE_TOKEN=%s\nIP_SALT=%s\n' "$(openssl rand -hex 24)" "$(openssl rand -hex 12)" >> .env
RELAYER=$(cat ../../engine/spikes/.keys/relayer.json | tr -d '\n ')
TREASURY=$(cat ../../engine/spikes/.keys/deployer.json | tr -d '\n ')
printf "RELAYER_KEY=%s\nTREASURY_KEY=%s\nOPERATOR_KEYS=[]\n" "$RELAYER" "$TREASURY" >> .env
git check-ignore .env
```
Expected: `git check-ignore` prints `.env`. (For now the spike relayer and the spike deployer, which holds bank fUSD, act as relayer and treasury; Plan 2b creates dedicated accounts.)

- [ ] **Step 4: Run the server and smoke-test it**

Run (in `apps/be`, background): `bun run dev`
Expected log: `[migrate] applied: []` and `[http] listening on :8787; relayer qor1f54l…; treasury qor1s6jr…; operators 0`.

Then:
```bash
curl -s localhost:8787/health
curl -s localhost:8787/v1/relayer
curl -s -X POST localhost:8787/v1/envelopes -H 'content-type: application/json' -d '{"kind":"request","body":"smoke"}'
curl -s -X POST localhost:8787/v1/faucet -H 'content-type: application/json' -d '{"address":"qor14wh9e6z8l8rtg9tk3n9pu4sdzfepgr2npxxfk6"}'
curl -s -X POST localhost:8787/v1/faucet -H 'content-type: application/json' -d '{"address":"qor14wh9e6z8l8rtg9tk3n9pu4sdzfepgr2npxxfk6"}'
```
Expected: `{"ok":true}`; the relayer address; `{"hash":"0x…"}`; a `{"tx":"…"}` whose REST lookup shows a `MsgSend` of `uqor` and `erc20:0x97143…` to the buyer; then HTTP 429 with `retryAt`. Stop the server.

- [ ] **Step 5: Record the smoke result in `apps/be/CLAUDE.md`**

Append:
```markdown
## Smoke test on qorechain-diana

- `/health`, `/v1/relayer`, `/v1/envelopes` answered against Supabase (schema `qredit`, migration 001 applied).
- `/v1/faucet` sent test QOR and faucet fUSD in one hybrid `MsgSend`: tx `<hash from Step 4>`; a second call within the cooldown answered 429.
- Relay and window renewal are exercised end to end in the engine plan, once the agent vaults exist.
```
Fill in the real hash.

- [ ] **Step 6: Commit**

```bash
git add apps/be/src/server.ts apps/be/CLAUDE.md
git commit -m "feat(be): wire the server, its loops and a testnet smoke test"
```

---

## After this plan

- Plan 2b (engine): dedicated relayer/treasury/operator/spender accounts, the owner CLI that creates the four vaults through the factory and registers them with `POST /v1/businesses`, the Mastra agents that claim orders, pay suppliers through `/v1/relay`, seal reports and deliver; then hosting `apps/be` and `engine` on an always-on host behind api.qredit.fun.
- Update the spec's storage line: envelopes live in Postgres (`qredit.envelopes`), not Supabase Storage; the backend needs only `DATABASE_URL` from Supabase.
