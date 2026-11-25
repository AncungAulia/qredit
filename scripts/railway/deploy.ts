// Railway deployment for Qredit. `bun scripts/railway/deploy.ts <project|vars|up <service>|domain|status>`.
// Reads RAILWAY_API_TOKEN from .env.railway (gitignored). Prints ids, names and lengths, never values.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileKeystore, runtimeBundle } from "./keys.ts";
import {
  API_PORT, ENV_NAME, PROJECT_NAME, SERVICES, agentVars, apiVars, buildVars, describeVars, diffVars, exampleKeys, isServiceName,
  parseEnv, suppliersVars, tail, type ServiceName, type Vars,
} from "./lib.ts";

const ROOT = join(import.meta.dir, "..", "..");
const ENDPOINT = "https://backboard.railway.com/graphql/v2";
const NAMES = Object.keys(SERVICES) as ServiceName[];
const read = (rel: string): string => readFileSync(join(ROOT, rel), "utf8");
const readEnv = (rel: string): Vars => {
  if (!existsSync(join(ROOT, rel))) throw new Error(`${rel} is missing`);
  return parseEnv(read(rel));
};

const apiToken = (): string => {
  const t = process.env.RAILWAY_API_TOKEN ?? readEnv(".env.railway").RAILWAY_API_TOKEN;
  if (!t) throw new Error("RAILWAY_API_TOKEN is not set (.env.railway)");
  return t;
};

/** The single GraphQL entry point. Errors carry Railway's message, never the request variables. */
export async function gql<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${apiToken()}` },
    body: JSON.stringify({ query, variables }),
  });
  const body = (await res.json().catch(() => ({}))) as { data?: T; errors?: { message: string }[] };
  if (!res.ok || body.errors?.length) throw new Error(`Railway API ${res.status}: ${(body.errors ?? []).map((e) => e.message).join("; ") || "no body"}`);
  return body.data as T;
}

type Edges<T> = { edges: { node: T }[] };
type Ctx = { projectId: string; environmentId: string; services: Record<ServiceName, string> };
const SCOPE = `$p: String!, $e: String!, $s: String!`;

async function findProject(): Promise<string | undefined> {
  const d = await gql<{ projects: Edges<{ id: string; name: string }> }>(`{ projects { edges { node { id name } } } }`);
  return d.projects.edges.map((e) => e.node).find((p) => p.name === PROJECT_NAME)?.id;
}

async function loadCtx(): Promise<Ctx | undefined> {
  const id = await findProject();
  if (!id) return undefined;
  const { project } = await gql<{ project: { id: string; environments: Edges<{ id: string; name: string }>; services: Edges<{ id: string; name: string }> } }>(
    `query($id: String!) { project(id: $id) { id environments { edges { node { id name } } } services { edges { node { id name } } } } }`,
    { id },
  );
  const env = project.environments.edges.map((e) => e.node).find((e) => e.name === ENV_NAME);
  if (!env) throw new Error(`project ${PROJECT_NAME} has no ${ENV_NAME} environment`);
  const byName = new Map(project.services.edges.map((e) => [e.node.name, e.node.id]));
  const services = {} as Record<ServiceName, string>;
  for (const s of NAMES) {
    const sid = byName.get(s);
    if (sid) services[s] = sid;
  }
  return { projectId: project.id, environmentId: env.id, services };
}

const requireCtx = async (): Promise<Ctx> => {
  const c = await loadCtx();
  if (!c || NAMES.some((s) => !c.services[s])) throw new Error("run `project` first");
  return c;
};

const scope = (ctx: Ctx, s: ServiceName) => ({ p: ctx.projectId, e: ctx.environmentId, s: ctx.services[s] });

/** Upsert only what differs; compares against Railway's current values locally and prints names and lengths. */
async function upsert(ctx: Ctx, service: ServiceName, wanted: Vars, show = true): Promise<void> {
  const cur = await gql<{ variables: Vars }>(`query(${SCOPE}) { variables(projectId: $p, environmentId: $e, serviceId: $s) }`, scope(ctx, service));
  const d = diffVars(cur.variables, wanted);
  if (d.add.length + d.change.length > 0) {
    await gql(`mutation($i: VariableCollectionUpsertInput!) { variableCollectionUpsert(input: $i) }`, {
      i: { projectId: ctx.projectId, environmentId: ctx.environmentId, serviceId: ctx.services[service], variables: wanted, skipDeploys: true },
    });
  }
  if (show) {
    for (const l of describeVars(service, wanted)) console.log(l);
    console.log(`${service}: ${d.add.length} added, ${d.change.length} changed, ${d.same.length} unchanged`);
  }
}

async function cmdProject(): Promise<void> {
  let projectId = await findProject();
  if (!projectId) {
    const { apiToken: t } = await gql<{ apiToken: { workspaces: { id: string }[] } }>(`{ apiToken { workspaces { id } } }`);
    const workspaceId = t.workspaces[0]?.id;
    if (!workspaceId) throw new Error("the token has no workspace");
    const d = await gql<{ projectCreate: { id: string } }>(`mutation($i: ProjectCreateInput!) { projectCreate(input: $i) { id } }`, {
      i: { name: PROJECT_NAME, workspaceId, defaultEnvironmentName: ENV_NAME, description: "Qredit: backend, suppliers and agent runner" },
    });
    projectId = d.projectCreate.id;
    console.log(`created project ${PROJECT_NAME}`);
  }
  let ctx = (await loadCtx())!;
  for (const s of NAMES) {
    if (ctx.services[s]) continue;
    await gql(`mutation($i: ServiceCreateInput!) { serviceCreate(input: $i) { id } }`, { i: { projectId, environmentId: ctx.environmentId, name: s } });
    console.log(`created service ${s}`);
  }
  ctx = (await loadCtx())!;
  // Build settings go in as variables so a redeploy needs nothing else.
  for (const s of NAMES) await upsert(ctx, s, buildVars(s), false);
  const doms = await gql<{ domains: { serviceDomains: { domain: string }[] } }>(
    `query(${SCOPE}) { domains(projectId: $p, environmentId: $e, serviceId: $s) { serviceDomains { domain } } }`, scope(ctx, "api"),
  );
  let domain = doms.domains.serviceDomains[0]?.domain;
  if (!domain) {
    const d = await gql<{ serviceDomainCreate: { domain: string } }>(`mutation($i: ServiceDomainCreateInput!) { serviceDomainCreate(input: $i) { domain } }`, {
      i: { serviceId: ctx.services.api, environmentId: ctx.environmentId, targetPort: Number(API_PORT) },
    });
    domain = d.serviceDomainCreate.domain;
  }
  console.log(`project ${ctx.projectId} environment ${ctx.environmentId}`);
  for (const s of NAMES) console.log(`service ${s} ${ctx.services[s]}`);
  console.log(`api url https://${domain}`);
}

async function cmdVars(): Promise<void> {
  const ctx = await requireCtx();
  const be = readEnv("apps/be/.env");
  const engine = readEnv("engine/.env");
  const slugs = Object.keys(JSON.parse(read("engine/deployments.json")) as Record<string, unknown>);
  const keysJson = JSON.stringify(runtimeBundle(fileKeystore(join(ROOT, "engine", ".keys")), slugs));
  await upsert(ctx, "api", { ...buildVars("api"), ...apiVars(be, exampleKeys(read("apps/be/.env.example"))) });
  await upsert(ctx, "suppliers", { ...buildVars("suppliers"), ...suppliersVars(engine) });
  await upsert(ctx, "agent", { ...buildVars("agent"), ...agentVars(engine, keysJson) });
}

type Deployment = { id: string; status: string };
async function latestDeployment(ctx: Ctx, service: ServiceName): Promise<Deployment | undefined> {
  const d = await gql<{ deployments: Edges<Deployment> }>(`query($i: DeploymentListInput!) { deployments(first: 1, input: $i) { edges { node { id status } } } }`, {
    i: { projectId: ctx.projectId, environmentId: ctx.environmentId, serviceId: ctx.services[service] },
  });
  return d.deployments.edges[0]?.node;
}

async function logs(deploymentId: string): Promise<string[]> {
  const out: string[] = [];
  for (const [field, label] of [["buildLogs", "build"], ["deploymentLogs", "deploy"]] as const) {
    const d = await gql<Record<string, { message: string }[]>>(`query($d: String!) { ${field}(deploymentId: $d, limit: 40) { message } }`, { d: deploymentId }).catch(() => ({ [field]: [] as { message: string }[] }));
    out.push(...(d[field] ?? []).map((l) => `[${label}] ${l.message}`));
  }
  return out;
}

async function cmdLogs(service: string | undefined): Promise<void> {
  if (!service || !isServiceName(service)) throw new Error(`usage: logs <${NAMES.join("|")}>`);
  const dep = await latestDeployment(await requireCtx(), service);
  if (!dep) throw new Error(`${service} has no deployment`);
  for (const l of tail(await logs(dep.id), 80)) console.log(l);
}

/** Deletes every deploy token this script created (they are named deploy-<timestamp>). */
async function deleteDeployTokens(ctx: Ctx): Promise<number> {
  const d = await gql<{ projectTokens: Edges<{ id: string; name: string }> }>(`query($p: String!) { projectTokens(projectId: $p) { edges { node { id name } } } }`, { p: ctx.projectId });
  const mine = d.projectTokens.edges.map((e) => e.node).filter((t) => t.name.startsWith("deploy-"));
  for (const t of mine) await gql(`mutation($id: String!) { projectTokenDelete(id: $id) }`, { id: t.id });
  return mine.length;
}

async function cmdCleanup(): Promise<void> {
  console.log(`deleted ${await deleteDeployTokens(await requireCtx())} deploy token(s)`);
}

async function cmdUp(service: string | undefined): Promise<void> {
  if (!service || !isServiceName(service)) throw new Error(`usage: up <${NAMES.join("|")}>`);
  const ctx = await requireCtx();
  const before = (await latestDeployment(ctx, service))?.id;
  const { projectTokenCreate: token } = await gql<{ projectTokenCreate: string }>(`mutation($i: ProjectTokenCreateInput!) { projectTokenCreate(input: $i) }`, {
    i: { projectId: ctx.projectId, environmentId: ctx.environmentId, name: `deploy-${Date.now()}` },
  });
  // The project token lives only in the child's environment; the CLI writes no link file.
  const bin = process.platform === "win32" ? "railway.cmd" : "railway";
  const child = Bun.spawn([bin, "up", "--service", service, "--environment", ENV_NAME, "--detach"], {
    cwd: ROOT, env: { ...process.env, RAILWAY_TOKEN: token }, stdout: "inherit", stderr: "inherit",
  });
  const code = await child.exited;
  await deleteDeployTokens(ctx).catch(() => console.error("warning: deploy token cleanup failed; run `cleanup`"));
  if (code !== 0) throw new Error(`railway up exited with ${code}`);
  let dep: Deployment | undefined;
  for (let i = 0; i < 20 && (!dep || dep.id === before); i++) {
    await Bun.sleep(3000);
    dep = await latestDeployment(ctx, service);
  }
  if (!dep || dep.id === before) throw new Error("no new deployment appeared");
  console.log(`deployment ${dep.id}`);
  const done = new Set(["SUCCESS", "FAILED", "CRASHED", "REMOVED"]);
  for (let i = 0; i < 120 && !done.has(dep.status); i++) {
    await Bun.sleep(5000);
    dep = (await latestDeployment(ctx, service)) ?? dep;
  }
  console.log(`status ${dep.status}`);
  if (dep.status !== "SUCCESS") {
    for (const l of tail(await logs(dep.id), 40)) console.log(l);
    process.exitCode = 1;
  }
}

async function cmdDomain(): Promise<void> {
  const ctx = await requireCtx();
  const domain = "api.qredit.fun";
  const list = `query(${SCOPE}) { domains(projectId: $p, environmentId: $e, serviceId: $s) { customDomains { id domain status { dnsRecords { recordType fqdn requiredValue currentValue status } } } } }`;
  type Dom = { domains: { customDomains: { domain: string; status: { dnsRecords: { recordType: string; fqdn: string; requiredValue: string; currentValue: string; status: string }[] } }[] } };
  let d = await gql<Dom>(list, scope(ctx, "api"));
  if (!d.domains.customDomains.some((c) => c.domain === domain)) {
    await gql(`mutation($i: CustomDomainCreateInput!) { customDomainCreate(input: $i) { id } }`, {
      i: { domain, projectId: ctx.projectId, environmentId: ctx.environmentId, serviceId: ctx.services.api, targetPort: Number(API_PORT) },
    });
    d = await gql<Dom>(list, scope(ctx, "api"));
  }
  for (const c of d.domains.customDomains.filter((x) => x.domain === domain)) {
    for (const r of c.status.dnsRecords) console.log(`${r.recordType} ${r.fqdn} -> ${r.requiredValue} (now: ${r.currentValue || "unset"}, ${r.status})`);
  }
}

async function cmdStatus(): Promise<void> {
  const ctx = await requireCtx();
  for (const s of NAMES) {
    const d = await latestDeployment(ctx, s);
    console.log(`${s}: ${d ? `${d.status} ${d.id}` : "no deployment"}`);
  }
}

if (import.meta.main) {
  const [cmd, arg] = Bun.argv.slice(2);
  const commands: Record<string, () => Promise<void>> = { project: cmdProject, vars: cmdVars, up: () => cmdUp(arg), logs: () => cmdLogs(arg), domain: cmdDomain, status: cmdStatus, cleanup: cmdCleanup };
  const run = commands[cmd ?? ""];
  if (!run) { console.error("usage: deploy.ts <project|vars|up <service>|logs <service>|domain|status|cleanup>"); process.exit(2); }
  await run().catch((e: Error) => { console.error(`error: ${e.message}`); process.exit(1); });
}
