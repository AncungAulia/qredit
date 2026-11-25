# Hosting on Railway

Project `qredit`, environment `production`, three services built from the repo root with the Dockerfiles at the root.

| Service | Dockerfile | Role | Port | Public |
|---|---|---|---|---|
| `api` | `Dockerfile.be` | mailbox API, relayer, watcher, window keeper | 8787 | yes (`api-production-dae6bbfb.up.railway.app`, custom `api.qredit.fun`) |
| `suppliers` | `Dockerfile.engine`, `ENGINE_ROLE=suppliers` | simulated suppliers | 8788 | no |
| `agent` | `Dockerfile.engine`, `ENGINE_ROLE=agent` | agent runner (health on Railway's `PORT`) | - | no |

Services reach each other over Railway's private IPv6 network: `http://api.railway.internal:8787`, `http://suppliers.railway.internal:8788`. Every Bun server binds `::`. Ports are fixed variables, not reference variables.

## Variables (names only)

- `api`: `DATABASE_URL`, `ENGINE_TOKEN`, `IP_SALT`, `RELAYER_KEY`, `TREASURY_KEY`, `OPERATOR_KEYS`, `PORT=8787`, `TRUSTED_PROXY_HOPS=1`, `RAILWAY_DOCKERFILE_PATH`. Only names listed in `apps/be/.env.example` are sent.
- `suppliers`: `OWNER_ADDRESS`, `ENGINE_TOKEN`, `API_URL`, `PORT=8788`, `ENGINE_ROLE`, `RAILWAY_DOCKERFILE_PATH`.
- `agent`: `OWNER_ADDRESS`, `ENGINE_TOKEN`, `OPENROUTER_API_KEY`, `API_URL`, `SUPPLIERS_URL`, `ENGINE_KEYS_JSON`, `ENGINE_ROLE`, `RAILWAY_DOCKERFILE_PATH`.
- `ENGINE_KEYS_JSON` holds only `<slug>-agent.ed25519`, `<slug>-operator.privateKey`, `<slug>-seal.seed` for each business. No mnemonic, recovery code, spender, treasury, supplier or buyer key is deployed.

## Commands

`bun scripts/railway/deploy.ts <cmd>` with `RAILWAY_API_TOKEN` in the gitignored `.env.railway` (workspace token). Output has names, lengths and ids only.

- `project`: ensure project, environment, services, build variables and the api's Railway domain (idempotent).
- `vars`: upsert variables from `apps/be/.env`, `engine/.env` and the keystore; only changed names are written (`skipDeploys`).
- `up <service>`: creates a project token, runs `railway up --detach` with `RAILWAY_TOKEN` in the child env only, deletes the token, polls the deployment, prints the last log lines on failure.
- `logs <service>`, `status`, `cleanup` (deletes leftover `deploy-*` tokens), `domain` (adds `api.qredit.fun`, prints the DNS record).

## Redeploy and rotate

- Code change: `up <service>`. Variable change: `vars`, then `up <service>` (variables are applied at the next deploy).
- Rotate a key: change it locally (`apps/be/.env`, `engine/.env` or the keystore), run `vars`, redeploy the affected service.

## Cut-over rule

Only one backend may use the relayer and treasury keys at a time (shared account sequences). Stop any local backend before the Railway `api` serves, and never start a local one while it runs.

## Custom domain

Add at the DNS provider (Hostinger for qredit.fun):

- `CNAME api -> vypt94fw.up.railway.app` (traffic).
- `TXT _railway-verify.api -> railway-verify=<token>` (ownership). Railway issues no certificate until this record exists; read the token from the domain status in Railway (it is not a secret, but it is per domain).

Both records are set and the certificate is issued: `GET https://api.qredit.fun/health` returns `{"ok":true}`.

## Railway API names used (verified by introspection)

Mutations `projectCreate`, `serviceCreate`, `variableCollectionUpsert(skipDeploys)`, `serviceDomainCreate`, `customDomainCreate`, `projectTokenCreate`, `projectTokenDelete`; queries `apiToken { workspaces }`, `projects`, `project`, `variables`, `domains`, `deployments`, `buildLogs`, `deploymentLogs`. The workspace token cannot call `me`, and the Railway CLI rejects it, so the CLI is used only with a project token.

## Cost

Three always-on services on the Hobby plan (usage-billed per CPU, memory and egress). Check the Railway usage page before leaving it running.

## Known issues

- Both Dockerfiles pin `oven/bun:1.3.13` (the version used locally); the floating `1.3` tag moved to 1.3.14.
- Bun 1.3.14 (the floating `1.3` tag) crashed once on cold start with `require() async module ... is unsupported` (`@noble/hashes` / `@scure/base` through `@cosmjs`); with the 1.3.13 pin all three services start cleanly on the first try (verified after redeploy).
- The hosted api sets `CLIENT_IP_HEADER=x-real-ip`: Railway's edge overwrites that header, so the per-IP limits and the faucet cooldown key on the real client. Checked live: 15 requests to the 10 per minute card route, each with a different spoofed `X-Real-IP` and `X-Forwarded-For`, got 429 from the 11th.
