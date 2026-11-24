import { publicClientFor, TESTNET, VAULT_ABI, VAULT_STATE } from "@qredit/qore";
import { loadEngineConfig, requireAgentConfig } from "../config.ts";
import { keystore } from "../keystore.ts";
import { SERVICES } from "../services/index.ts";
import { agentKey, loadAccount, SUPPLIER_ACCOUNTS } from "../setup/accounts.ts";
import { loadCatalog, type SupplierRole } from "../setup/businesses.ts";
import { readDeployments } from "../setup/deployments.ts";
import { chainPayments } from "../suppliers/app.ts";
import { createApi } from "./api.ts";
import { createOperator, createSpenderSigner, createVaultReader } from "./chain.ts";
import { createOpenRouterLlm } from "./llm.ts";
import { handleOrder, type BusinessRuntime, type Outcome, type PipelineDeps } from "./pipeline.ts";
import { createRecipientResolver } from "./recipient.ts";
import { loadSealKeys } from "./seal.ts";
import { createSuppliersClient } from "./suppliers-client.ts";
import type { Order, Prices } from "./types.ts";
import type { Hex } from "viem";

const detail = (e: unknown) => (e instanceof Error ? e.message : String(e));
const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Claims one order at a time across all vaults and serves it; one failure never stops the loop. Exits when `signal` aborts. */
export async function runLoop(o: {
  businesses: BusinessRuntime[];
  deps: PipelineDeps;
  pollMs: number;
  signal: AbortSignal;
  claim: (vaults: string[]) => Promise<Order | null>;
  handle?: (order: Order, biz: BusinessRuntime, deps: PipelineDeps) => Promise<Outcome>;
  sleep?: (ms: number) => Promise<void>;
}): Promise<void> {
  const handle = o.handle ?? handleOrder;
  const sleep = o.sleep ?? defaultSleep;
  const byVault = new Map(o.businesses.map((b) => [b.vault.toLowerCase(), b]));
  const vaults = o.businesses.map((b) => b.vault);
  while (!o.signal.aborted) {
    let order: Order | null = null;
    try {
      order = await o.claim(vaults);
    } catch (e) {
      o.deps.log(`claim failed: ${detail(e)}`);
    }
    if (!order) {
      if (o.signal.aborted) break;
      await sleep(o.pollMs);
      continue;
    }
    const biz = byVault.get(order.vault.toLowerCase());
    if (!biz) {
      o.deps.log(`order ${order.orderId}: unknown vault ${order.vault}; skipped`);
      continue;
    }
    o.deps.log(`order ${order.orderId} (${biz.slug}): claimed`);
    try {
      const out = await handle(order, biz, o.deps);
      o.deps.log(`order ${order.orderId} (${biz.slug}): ${out.status}${out.code ? ` code ${out.code}` : ""}${out.tx ? ` tx ${out.tx}` : ""}${out.reason ? ` (${out.reason})` : ""}`);
    } catch (e) {
      o.deps.log(`order ${order.orderId} (${biz.slug}): handler threw: ${detail(e)}`);
    }
  }
}

const SERVING = new Set<number>([VAULT_STATE.Active, VAULT_STATE.Trapped, VAULT_STATE.Repaid]);

async function main(): Promise<void> {
  const cfg = requireAgentConfig(loadEngineConfig());
  const ks = keystore(cfg.KEYS_DIR);
  const log = (line: string) => console.log(`[agent ${new Date().toISOString()}] ${line}`);
  const client = publicClientFor(TESTNET.evm);
  const api = createApi({ url: cfg.API_URL, token: cfg.ENGINE_TOKEN });
  const relayer = await api.relayer();
  const { suppliers: catalog, businesses: businessParams } = loadCatalog();
  const prices = Object.fromEntries(Object.entries(catalog).map(([r, s]) => [r, BigInt(s.priceUnits)])) as Prices;
  const supplierAddress = Object.fromEntries(
    await Promise.all(Object.entries(SUPPLIER_ACCOUNTS).map(async ([role, name]) => [role, (await loadAccount(ks, name)).evm.toLowerCase()])),
  ) as Record<SupplierRole, string>;

  const deployments = readDeployments();
  const runtimes: BusinessRuntime[] = [];
  const signers = new Map<string, ReturnType<typeof createSpenderSigner>>();
  const operators = new Map<string, ReturnType<typeof createOperator>>();
  for (const d of Object.values(deployments)) {
    const service = SERVICES[d.slug];
    if (!service) { log(`${d.slug}: no service module; skipped`); continue; }
    const state = Number(await client.readContract({ address: d.vault as Hex, abi: VAULT_ABI, functionName: "state" }));
    if (!SERVING.has(state)) { log(`${d.slug}: vault state ${state} is not serving orders; skipped`); continue; }
    const spender = await loadAccount(ks, `${d.slug}-spender`);
    const ag = agentKey(ks, d.slug);
    signers.set(d.vault.toLowerCase(), createSpenderSigner({ agentSecret: ag.secret, spenderQor: spender.cosmos, relayer, net: TESTNET }));
    operators.set(d.vault.toLowerCase(), createOperator({ privateKey: ks.read(`${d.slug}-operator`).privateKey as Hex, evm: TESTNET.evm }));
    runtimes.push({
      slug: d.slug, vault: d.vault, spenderQor: spender.cosmos, service,
      servicePrices: businessParams.find((b) => b.slug === d.slug)!.services.map((x) => BigInt(x.priceUnits)), sealKeys: loadSealKeys(ks, d.slug), supplierAddress,
    });
    log(`${d.slug}: serving vault ${d.vault}`);
  }
  if (runtimes.length === 0) throw new Error("no business vault is serving orders");

  const startBlockOf = new Map(Object.values(deployments).map((d) => [d.vault.toLowerCase(), d.startBlock]));
  const payments = chainPayments(client, { rest: TESTNET.rest, relayer });
  const base = {
    api, vaults: createVaultReader(client), suppliers: createSuppliersClient({ url: cfg.SUPPLIERS_URL }), llm: createOpenRouterLlm(cfg),
    prices, chainId: TESTNET.chainId, log,
    resolveBuyer: createRecipientResolver({ rest: TESTNET.rest, chainId: TESTNET.chainId, card: (qor) => api.card(qor) }),
    paidOnChain: (vault: string, orderId: string, supplier: string) => payments.paid(vault, orderId, supplier, startBlockOf.get(vault.toLowerCase()) ?? 0),
  };
  // Signer and operator belong to one business each; the pipeline gets them through per-vault routing.
  const deps: PipelineDeps = {
    ...base,
    signer: { payRequest: (vault, ...rest) => signers.get(vault.toLowerCase())!.payRequest(vault, ...rest) },
    operator: {
      deliver: (vault, ...rest) => operators.get(vault.toLowerCase())!.deliver(vault, ...rest),
      decline: (vault, ...rest) => operators.get(vault.toLowerCase())!.decline(vault, ...rest),
    },
  };

  const ctl = new AbortController();
  for (const sig of ["SIGINT", "SIGTERM"] as const) process.on(sig, () => { log(`${sig}: stopping after the current step`); ctl.abort(); });
  log(`running for ${runtimes.length} business(es)`);
  await runLoop({ businesses: runtimes, deps, pollMs: cfg.AGENT_POLL_MS, signal: ctl.signal, claim: (v) => api.claim(v) });
  log("stopped");
}

if (import.meta.main) {
  main().catch((e) => { console.error(detail(e)); process.exit(1); });
}
