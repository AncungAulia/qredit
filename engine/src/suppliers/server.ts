import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { MCPClient } from "@mastra/mcp";
import { parseAbi, type Hex } from "viem";
import { publicClientFor, TESTNET } from "@qredit/qore";
import { createApi } from "../agent/api.ts";
import { loadEngineConfig } from "../config.ts";
import { loadSupplierAddresses } from "../runtime-keys.ts";
import { loadCatalog } from "../setup/businesses.ts";
import { readDeployments } from "../setup/deployments.ts";
import { analyzeBytecode } from "./data/bytecode.ts";
import { createIndexer, type CallTool } from "./data/indexer.ts";
import { loadList, matchList, normalizeAddress } from "./data/lists.ts";
import { chainPayments, createSupplierApp } from "./app.ts";

const cfg = loadEngineConfig();
const catalog = loadCatalog().suppliers;
const addresses = loadSupplierAddresses();
const entries = Object.fromEntries(
  (Object.keys(addresses) as (keyof typeof addresses)[]).map((role) => [role, { ...catalog[role], address: addresses[role] }]),
) as Parameters<typeof createSupplierApp>[0]["catalog"];

const vaults = new Map(Object.values(readDeployments()).map((d) => [d.vault.toLowerCase(), { startBlock: d.startBlock }] as const));
if (vaults.size === 0) console.warn("[suppliers] deployments.json has no vaults: every request will be refused");

const client = publicClientFor(TESTNET.evm);
const relayer = await createApi({ url: cfg.API_URL, token: cfg.ENGINE_TOKEN ?? "" }).relayer().catch((e: Error) => {
  throw new Error(`cannot read the relayer address from ${cfg.API_URL}/v1/relayer (is the backend running?): ${e.message}`);
});
const sanctions = loadList("sanctions-synthetic");

const mcpBin = join(dirname(createRequire(import.meta.url).resolve("@qorechain/mcp/package.json")), "dist", "bin.js");
const mcp = new MCPClient({ servers: { qore: { command: process.execPath, args: [mcpBin, "--network", "testnet"] } }, timeout: 30_000 });
const tools = await mcp.listTools();
const callTool: CallTool = (name, args) => {
  const tool = tools[`qore_${name}`] as { execute: (a: unknown) => Promise<unknown> } | undefined;
  if (!tool) throw new Error(`MCP tool ${name} is not available`);
  return tool.execute(args);
};
const indexer = createIndexer({ callTool, flags: loadList("flagged-synthetic") });

const ERC20_ABI = parseAbi([
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function totalSupply() view returns (uint256)",
  "function owner() view returns (address)",
]);
/** A revert (or a non-contract) gives null instead of failing the whole report. */
const tryRead = async <T>(address: Hex, functionName: "name" | "symbol" | "decimals" | "totalSupply" | "owner", map: (v: any) => T): Promise<T | null> => {
  try { return map(await client.readContract({ address, abi: ERC20_ABI, functionName })); } catch { return null; }
};

function requireHex(q: Record<string, string>): Hex {
  const hex = normalizeAddress(q.address ?? "")?.hex;
  if (!hex) throw new Error("address required");
  return hex as Hex;
}
const bytecodeOf = async (address: Hex) => analyzeBytecode(address, (await client.getCode({ address })) ?? "0x");

const app = createSupplierApp({
  payments: chainPayments(client, { rest: TESTNET.rest, relayer }),
  vaults,
  catalog: entries,
  data: {
    dataIndexer: async (q) => {
      if (!normalizeAddress(q.address ?? "")) throw new Error("address required");
      return indexer.lookup(q.address);
    },
    listOracle: async (q) => matchList(sanctions, (q.addresses ?? "").split(",").filter(Boolean).slice(0, 20)),
    computeBasic: async (q) => bytecodeOf(requireHex(q)),
    computeDeep: async (q) => {
      const address = requireHex(q);
      const [facts, name, symbol, decimals, totalSupply, owner] = await Promise.all([
        bytecodeOf(address),
        tryRead(address, "name", String), tryRead(address, "symbol", String),
        tryRead(address, "decimals", Number), tryRead(address, "totalSupply", String),
        tryRead(address, "owner", (v: string) => v.toLowerCase()),
      ]);
      return { ...facts, token: { name, symbol, decimals, totalSupply }, owner };
    },
  },
});

const port = Number(process.env.SUPPLIERS_PORT ?? process.env.PORT ?? 8788);
Bun.serve({ port, fetch: app.fetch });
console.log(`[suppliers] listening on :${port}`);
