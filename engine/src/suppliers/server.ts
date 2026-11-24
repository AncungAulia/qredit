import { publicClientFor, TESTNET } from "@qredit/qore";
import { keystore } from "../keystore.ts";
import { loadEngineConfig } from "../config.ts";
import { loadAccount, SUPPLIER_ACCOUNTS } from "../setup/accounts.ts";
import { loadCatalog } from "../setup/businesses.ts";
import { readDeployments } from "../setup/deployments.ts";
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

const vaults = new Map(Object.values(readDeployments()).map((d) => [d.vault.toLowerCase(), { startBlock: d.startBlock }] as const));
if (vaults.size === 0) console.warn("[suppliers] deployments.json has no vaults: every request will be refused");

const SANCTIONED = new Set<string>(); // synthetic list, filled from a public fixture in Plan 2b-2

const app = createSupplierApp({
  payments: chainPayments(publicClientFor(TESTNET.evm)),
  vaults,
  catalog: entries,
  data: {
    dataIndexer: async (q) => {
      const r = await fetch(`${TESTNET.rest}/cosmos/auth/v1beta1/accounts/${encodeURIComponent(q.address ?? "")}`, { signal: AbortSignal.timeout(10_000) });
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
