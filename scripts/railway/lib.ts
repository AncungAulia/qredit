/** Pure helpers for scripts/railway/deploy.ts: no I/O, no secrets in output. */

export type Vars = Record<string, string>;

export const PROJECT_NAME = "qredit";
export const ENV_NAME = "production";
export const API_PORT = "8787";
export const SUPPLIERS_PORT = "8788";
export const PRIVATE_API_URL = `http://api.railway.internal:${API_PORT}`;
export const PRIVATE_SUPPLIERS_URL = `http://suppliers.railway.internal:${SUPPLIERS_PORT}`;

export const SERVICES = {
  api: { dockerfile: "Dockerfile.be" },
  suppliers: { dockerfile: "Dockerfile.engine", role: "suppliers" },
  agent: { dockerfile: "Dockerfile.engine", role: "agent" },
} as const;
export type ServiceName = keyof typeof SERVICES;
export const isServiceName = (s: string): s is ServiceName => Object.hasOwn(SERVICES, s);

/** KEY=VALUE lines of a .env file; comments, blanks and empty values are dropped. Surrounding quotes are stripped. */
export function parseEnv(text: string): Vars {
  const out: Vars = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (value.length >= 2 && ((value[0] === '"' && value.at(-1) === '"') || (value[0] === "'" && value.at(-1) === "'"))) value = value.slice(1, -1);
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) && value !== "") out[key] = value;
  }
  return out;
}

/** Variable names an .env.example declares (active or commented-out defaults are ignored: only active lines count). */
export function exampleKeys(text: string): string[] {
  return text.split(/\r?\n/).map((l) => /^([A-Za-z_][A-Za-z0-9_]*)=/.exec(l.trim())?.[1]).filter((k): k is string => k !== undefined);
}

const need = (src: Vars, keys: string[], where: string): void => {
  const missing = keys.filter((k) => !src[k]);
  if (missing.length) throw new Error(`${where} is missing: ${missing.join(", ")}`);
};

/** api: only names the backend's .env.example declares (so stray local keys never ship), minus PORT, plus the proxy hop count. */
export function apiVars(be: Vars, allowed: string[]): Vars {
  const out: Vars = {};
  for (const k of allowed) if (k !== "PORT" && be[k] !== undefined) out[k] = be[k];
  need(out, ["DATABASE_URL", "ENGINE_TOKEN", "IP_SALT", "RELAYER_KEY", "TREASURY_KEY"], "apps/be/.env");
  return { ...out, PORT: API_PORT, TRUSTED_PROXY_HOPS: "1" };
}

export function suppliersVars(engine: Vars): Vars {
  need(engine, ["OWNER_ADDRESS", "ENGINE_TOKEN"], "engine/.env");
  return { OWNER_ADDRESS: engine.OWNER_ADDRESS!, ENGINE_TOKEN: engine.ENGINE_TOKEN!, API_URL: PRIVATE_API_URL, PORT: SUPPLIERS_PORT, ENGINE_ROLE: "suppliers" };
}

export function agentVars(engine: Vars, keysJson: string): Vars {
  need(engine, ["OWNER_ADDRESS", "ENGINE_TOKEN", "OPENROUTER_API_KEY"], "engine/.env");
  return {
    OWNER_ADDRESS: engine.OWNER_ADDRESS!, ENGINE_TOKEN: engine.ENGINE_TOKEN!, OPENROUTER_API_KEY: engine.OPENROUTER_API_KEY!,
    API_URL: PRIVATE_API_URL, SUPPLIERS_URL: PRIVATE_SUPPLIERS_URL, ENGINE_KEYS_JSON: keysJson, ENGINE_ROLE: "agent",
  };
}

/** Build settings every service gets as variables. */
export const buildVars = (s: ServiceName): Vars => ({ RAILWAY_DOCKERFILE_PATH: SERVICES[s].dockerfile });

/** Names and lengths only, sorted. */
export const describeVars = (service: string, v: Vars): string[] =>
  Object.keys(v).sort().map((k) => `${service}: ${k} (len ${v[k]!.length})`);

/** Which names change against what Railway holds (values only compared when both sides are given). */
export function diffVars(current: Vars, wanted: Vars): { add: string[]; change: string[]; same: string[] } {
  const add: string[] = [], change: string[] = [], same: string[] = [];
  for (const k of Object.keys(wanted).sort()) (current[k] === undefined ? add : current[k] === wanted[k] ? same : change).push(k);
  return { add, change, same };
}

/** Last n lines of a log blob, for failure output. */
export const tail = (lines: string[], n = 40): string[] => lines.slice(-n);
