import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { keystore, memoryKeystore, type Keystore } from "./keystore.ts";
import { SUPPLIER_ACCOUNTS } from "./setup/accounts.ts";

/** The only key fields the runtime (agent runner, suppliers) may hold; everything else stays on the owner's machine. */
export const RUNTIME_KEY_FIELDS = { agent: ["ed25519"], operator: ["privateKey"], seal: ["seed"] } as const;

export type SupplierAddresses = Record<keyof typeof SUPPLIER_ACCOUNTS, string>;
/** The supplier addresses live in packages/qore so the engine and the web app read the same file; the owner CLI writes it. */
export const SUPPLIERS_PATH = join(import.meta.dir, "..", "..", "packages", "qore", "src", "suppliers.json");

/** Builds the ENGINE_KEYS_JSON payload: per business the agent, operator and seal records cut down to the runtime fields. Errors name files and fields, never values. */
export function runtimeBundle(ks: Keystore, slugs: string[]): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = {};
  for (const slug of slugs) {
    for (const [kind, fields] of Object.entries(RUNTIME_KEY_FIELDS)) {
      const name = `${slug}-${kind}`;
      if (!ks.has(name)) throw new Error(`missing key file ${name}`);
      const rec = ks.read(name);
      out[name] = Object.fromEntries(
        fields.map((f) => {
          if (typeof rec[f] !== "string" || rec[f] === "") throw new Error(`${name} has no ${f}`);
          return [f, rec[f]];
        }),
      );
    }
  }
  return out;
}

const isStringRecord = (v: unknown): v is Record<string, string> =>
  typeof v === "object" && v !== null && !Array.isArray(v) && Object.values(v).every((x) => typeof x === "string");

/** ENGINE_KEYS_JSON set: in-memory keystore; otherwise the key folder. Bad input is reported without echoing it. */
export function runtimeKeystore(env: Record<string, string | undefined>, dir: string): Keystore {
  const raw = env.ENGINE_KEYS_JSON;
  if (raw === undefined || raw === "") return keystore(dir);
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("ENGINE_KEYS_JSON is not valid JSON");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed) || !Object.values(parsed).every(isStringRecord)) {
    throw new Error("ENGINE_KEYS_JSON must be an object of objects of strings");
  }
  return memoryKeystore(parsed as Record<string, Record<string, string>>);
}

/** Public supplier EVM addresses (packages/qore/src/suppliers.json), so the runtime needs no supplier key files. */
export function loadSupplierAddresses(path = SUPPLIERS_PATH): SupplierAddresses {
  if (!existsSync(path)) throw new Error("packages/qore/src/suppliers.json is missing; run `bun run owner suppliers-json`");
  const data = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  const out = {} as SupplierAddresses;
  for (const role of Object.keys(SUPPLIER_ACCOUNTS) as (keyof SupplierAddresses)[]) {
    const a = data[role];
    if (typeof a !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(a)) throw new Error(`suppliers.json has no valid address for ${role}`);
    out[role] = a.toLowerCase();
  }
  return out;
}
