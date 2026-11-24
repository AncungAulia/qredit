// Proves the runtime needs no key files: the bundle is built from the real keystore, then the runtime is rebuilt from env alone.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hexToQor } from "@qredit/qore";
import { buildRuntime } from "../src/agent/run.ts";
import { loadEngineConfig, requireAgentConfig } from "../src/config.ts";
import { keystore } from "../src/keystore.ts";
import { loadAccount } from "../src/setup/accounts.ts";
import { loadBusinesses } from "../src/setup/businesses.ts";
import { readDeployments } from "../src/setup/deployments.ts";
import { runtimeBundle, runtimeKeystore } from "../src/runtime-keys.ts";

const real = keystore(loadEngineConfig().KEYS_DIR);
process.env.ENGINE_KEYS_JSON = JSON.stringify(runtimeBundle(real, loadBusinesses().map((b) => b.slug)));
process.env.KEYS_DIR = mkdtempSync(join(tmpdir(), "qredit-empty-keys-"));

// The spender's qor1 address is derived from deployments.json; check it matches the account the key file gives.
for (const d of Object.values(readDeployments())) {
  const acc = await loadAccount(real, `${d.slug}-spender`);
  if (hexToQor(d.spender) !== acc.cosmos) throw new Error(`${d.slug}: derived spender address differs from the account`);
}

const cfg = requireAgentConfig(loadEngineConfig());
const ks = runtimeKeystore(process.env, cfg.KEYS_DIR);
if (ks.list().some((n) => n.endsWith("-spender") || n === "relayer" || n === "treasury")) throw new Error("bundle holds more than runtime keys");
const { runtimes } = await buildRuntime(cfg, ks, () => {});
console.log(`runtime ok: ${runtimes.length} businesses`);
