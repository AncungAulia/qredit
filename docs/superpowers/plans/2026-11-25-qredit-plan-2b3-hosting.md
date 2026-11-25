# Qredit Plan 2b-3: Hosting on Railway — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run the backend (`apps/be`), the agent runner and the simulated suppliers as three always-on Railway services, with no key file on disk, so that `https://api.qredit.fun` (and the Railway URL before DNS) serves the API and the agents deliver orders without the developer's laptop.

**Architecture:** One Railway project `qredit`, environment `production`, three services built from Dockerfiles in this repo (Bun 1.3 image, workspace install). `api` is public; `suppliers` and `agent` talk to it over Railway private networking. Secrets are Railway variables: the backend keeps its existing env names; the engine gets one `ENGINE_KEYS_JSON` variable holding only the runtime key material (agent ed25519 keys, operator classical private keys, seal seeds), read into an in-memory keystore. Public supplier addresses move to a committed `engine/suppliers.json`, so no supplier key is deployed. Deployment uses the Railway public GraphQL API with the workspace token from `.env.railway`, and `railway up` with a project token for uploads.

**Tech Stack:** Railway (Hobby), Docker (`oven/bun:1.3`), Railway CLI 5.75.0, Railway GraphQL `https://backboard.railway.com/graphql/v2`, Bun workspaces.

## Global Constraints

- Railway credentials: `RAILWAY_API_TOKEN` in the gitignored `.env.railway` at the repo root (a workspace token scoped to "ancung's Projects"; verified: GraphQL `projects` works with `Authorization: Bearer`, `me` does not). Never print it; read it into an env var inside the same command.
- No secret is printed, logged, committed or written outside gitignored files. Variables are sent to Railway straight from the local `.env` files / keystore by a script; the script prints only names and lengths.
- Runtime key material on Railway: per business `<slug>-agent` (`ed25519`), `<slug>-operator` (`privateKey` only — never `recoveryCode`), `<slug>-seal` (`seed`). Never deployed: any mnemonic, recovery code, spender/treasury/supplier/demo-buyer key files. The backend's existing `RELAYER_KEY`, `TREASURY_KEY`, `OPERATOR_KEYS` stay backend-only (as today).
- Only one backend may run against the relayer and treasury keys at a time (shared account sequences). Cut-over: stop the local backend before the Railway `api` starts serving.
- `TRUSTED_PROXY_HOPS=1` behind Railway's edge (one proxy hop); verify with a request that the logged client IP is the caller's, not Railway's.
- Custom domain `api.qredit.fun` is added in Railway; the CNAME at the domain registrar is a human step (print the exact record to add).
- Root `CLAUDE.md` rules apply (evidence, stop and ask, English, no build durations).

---

### Task 1: Runtime keys without key files

**Files:**
- Create: `engine/src/runtime-keys.ts`, `engine/suppliers.json`, `engine/test/runtime-keys.test.ts`
- Modify: `engine/src/keystore.ts` (add `memoryKeystore`), `engine/src/agent/run.ts`, `engine/src/suppliers/server.ts`, `engine/src/cli/owner.ts` (commands `suppliers-json`, `runtime-keys check`), `engine/CLAUDE.md`

**Interfaces:**
- Produces:
  - `memoryKeystore(files: Record<string, Record<string, string>>): Keystore` — `has`, `read`, `list` work; `write` throws `"read-only keystore"`.
  - `RUNTIME_KEY_FIELDS = { agent: ["ed25519"], operator: ["privateKey"], seal: ["seed"] }` and `runtimeBundle(ks, slugs): Record<string, Record<string, string>>` — builds `{ "<slug>-agent": { ed25519 }, "<slug>-operator": { privateKey }, "<slug>-seal": { seed } }` and nothing else (drops every other field).
  - `runtimeKeystore(env, dir): Keystore` — `ENGINE_KEYS_JSON` set → `memoryKeystore(JSON.parse(...))` (with a clear error naming the variable, never its value, on bad JSON); otherwise the file keystore at `dir`.
  - `engine/suppliers.json`: `{ "dataIndexer": "0x…", "listOracle": "0x…", "computeBasic": "0x…", "computeDeep": "0x…" }` (public EVM addresses), written by `bun run owner suppliers-json`, read by `loadSupplierAddresses()`.

- [ ] **Step 1: Failing tests** — `runtimeBundle` keeps only the allowed fields (a fixture operator with `recoveryCode` and a fixture spender with `mnemonic` must not appear); `memoryKeystore` read/has/list and write throws; `runtimeKeystore` picks memory when `ENGINE_KEYS_JSON` is set and reports bad JSON without echoing it; `loadSupplierAddresses` validates four 0x addresses.
- [ ] **Step 2: Implement**, then switch `run.ts` and `suppliers/server.ts` to `runtimeKeystore(process.env, cfg.KEYS_DIR)` and `loadSupplierAddresses()` (no more `loadAccount` of supplier accounts at runtime). Generate and commit `engine/suppliers.json` with `bun run owner suppliers-json`. `runtime-keys check` prints, for each business, which runtime fields exist locally (names only).
- [ ] **Step 3: Verify** — `cd engine && bun test && bun run typecheck`; then run the agent locally once with `ENGINE_KEYS_JSON` built in-process (a one-off `bun -e` that sets the env from `runtimeBundle` and imports `run.ts` with `--once` or a short timeout) and with `KEYS_DIR` pointing at an empty temp dir, to prove the runtime needs no key files. Do not print the bundle.
- [ ] **Step 4: Commit** `feat(engine): in-memory runtime keys and public supplier addresses`.

---

### Task 2: Container images and health endpoints

**Files:**
- Create: `Dockerfile.be`, `Dockerfile.engine`, `.dockerignore`, `engine/src/health.ts` (if needed)
- Modify: `engine/src/suppliers/server.ts` (`GET /health`), `engine/src/agent/run.ts` (optional `AGENT_HEALTH_PORT` serving `GET /health` with last-loop timestamp), `engine/package.json` (scripts `start:agent`, `start:suppliers` without `--env-file`)

**Interfaces:**
- `Dockerfile.be`: `FROM oven/bun:1.3` → copy `package.json bun.lock` and the workspace `package.json` files → `bun install --frozen-lockfile --production` (fall back to a full install only if a needed runtime dep is a devDependency; say so) → copy `packages/qore`, `apps/be` → `WORKDIR /app/apps/be` → `CMD ["bun", "src/server.ts"]`. Runs migrations? No: migrations stay a manual step (`bun run migrate` locally, already applied).
- `Dockerfile.engine`: same base and install; copies `packages/qore`, `engine` (excluding `.keys`, `spikes`, `.env`); `ENV ENGINE_ROLE=agent`; `CMD ["sh", "-c", "exec bun run start:$ENGINE_ROLE"]`.
- `.dockerignore`: `**/node_modules`, `**/.env`, `**/.env.*`, `!**/.env.example`, `engine/.keys`, `engine/spikes`, `sc`, `docs`, `.superpowers`, `notes`, `.git`.

- [ ] **Step 1:** Write the files. Check whether Docker is available locally (`docker version`); if yes, build both images and run `docker run --rm <be-image> bun -e "import('./src/config.ts')"`-style smoke that the image starts and fails only on missing env (expected), and that `docker run` of the engine image never contains `/app/engine/.keys` (`ls` it). If Docker is not available, say so and rely on Railway's build logs in Task 3.
- [ ] **Step 2:** `bun test` in engine and apps/be; commit `build: Dockerfiles for the backend and the engine`.

---

### Task 3: Railway project, variables and first deploy

**Files:**
- Create: `scripts/railway/deploy.ts` (GraphQL client + steps, idempotent), `docs/hosting.md` (runbook)
- Modify: `.gitignore` (`.railway/` if the CLI creates it)

**Interfaces:**
- `deploy.ts` subcommands (`bun scripts/railway/deploy.ts <cmd>`), each idempotent (find by name before create):
  - `project` — ensure project `qredit` and its `production` environment; ensure services `api`, `suppliers`, `agent`; set each service's Dockerfile path (`RAILWAY_DOCKERFILE_PATH` = `Dockerfile.be` / `Dockerfile.engine`), `ENGINE_ROLE` (`suppliers` / `agent`); generate a Railway domain for `api` only; print project/service ids and the api URL.
  - `vars` — upsert variables without printing values:
    - `api`: every key in `apps/be/.env` except `PORT` (Railway sets it), plus `TRUSTED_PROXY_HOPS=1`, `CORS_ORIGINS` unchanged.
    - `suppliers`: `API_URL=http://api.railway.internal:${{api.PORT}}` style private URL (check Railway's reference-variable syntax), `SUPPLIERS_PORT` = Railway `PORT`, `OWNER_ADDRESS` from engine/.env.
    - `agent`: `OWNER_ADDRESS`, `ENGINE_TOKEN`, `OPENROUTER_API_KEY`, `API_URL` (private api URL), `SUPPLIERS_URL` (private suppliers URL), and `ENGINE_KEYS_JSON` = `JSON.stringify(runtimeBundle(fileKeystore, slugs))`.
    - Prints `service: NAME (len N)` lines only.
  - `up <service>` — create a project token (GraphQL), then `railway up --service <service> --detach` with `RAILWAY_TOKEN` set in the child env only; print the deployment id; poll its status until SUCCESS/FAILED and print the last 40 build/deploy log lines on failure (logs may contain nothing secret; still never echo env).
  - `domain` — add custom domain `api.qredit.fun` to `api` and print the DNS record Railway asks for.
- Railway GraphQL names (`projectCreate`, `serviceCreate`, `variableCollectionUpsert`, `serviceDomainCreate`, `customDomainCreate`, `projectTokenCreate`, `serviceInstanceUpdate`, deployment queries) must be checked against the live schema first (introspection query or docs.railway.com/reference/public-api via a web-fetch agent); record what was used in `docs/hosting.md`. If the workspace token cannot do a step, stop and report which one.

- [ ] **Step 1:** Implement `deploy.ts` (pure helpers — env-file parsing, bundle building, variable diffing — unit-tested in `scripts/railway/deploy.test.ts`; GraphQL calls behind one `gql(query, vars)` function).
- [ ] **Step 2: Live** — `project`, `vars`, then `up suppliers`, `up agent` (agent pointed at the Railway api only after cut-over, see Step 3).
- [ ] **Step 3: Cut-over** — stop the local backend (the developer's background process; the controller does this), then `up api`. Check `GET https://<api railway domain>/health` → `{"ok":true}`, `GET /v1/businesses` lists four businesses, `GET /v1/relayer` returns the relayer address; the agent's Railway logs show it polling; the suppliers' logs show the MCP tools loaded.
- [ ] **Step 4: Live order through the hosted stack** — from the laptop, `API_URL=https://<api railway domain> bun run owner demo-order counterparty-check "<demo buyer qor1>"`, then `demo-report` → the report opens. Record tx hashes in `engine/RESULTS.md` ("hosted").
- [ ] **Step 5:** `domain` → print the CNAME for the human. Write `docs/hosting.md`: services, variables (names only), how to redeploy, how to rotate keys, the cut-over rule, cost notes. Commit `feat(ops): Railway deployment script and runbook`.

---

## Out of scope

- DNS change at the registrar (human), Vercel for `apps/fe` and `apps/landing` (Plan 3).
- Alerts and uptime monitoring beyond Railway's restart policy.
