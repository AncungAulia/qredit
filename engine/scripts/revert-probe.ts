// Live probe: relay a paySupplier that reverts (amount above the supplier's per-tx cap), then show how the tx index
// records it and whether relayedPayments counts it. No money moves. Run: bun --env-file=.env scripts/revert-probe.ts
import { publicClientFor, relayedPayments, TESTNET } from "@qredit/qore";
import { createApi } from "../src/agent/api.ts";
import { createSpenderSigner, createVaultReader } from "../src/agent/chain.ts";
import { loadEngineConfig, requireAgentConfig } from "../src/config.ts";
import { keystore } from "../src/keystore.ts";
import { agentKey, loadAccount, SUPPLIER_ACCOUNTS } from "../src/setup/accounts.ts";
import { readDeployments } from "../src/setup/deployments.ts";

const SLUG = "counterparty-check";
const ORDER_ID = 999999n;
const cfg = requireAgentConfig(loadEngineConfig());
const ks = keystore(cfg.KEYS_DIR);
const api = createApi({ url: cfg.API_URL, token: cfg.ENGINE_TOKEN });
const relayer = await api.relayer();
const d = Object.values(readDeployments()).find((x) => x.slug === SLUG)!;
const supplier = (await loadAccount(ks, SUPPLIER_ACCOUNTS.dataIndexer)).evm.toLowerCase();
const cap = await createVaultReader(publicClientFor(TESTNET.evm)).supplierCap(d.vault, supplier);
if (cap === 0n) throw new Error("supplier not allowed on this vault; the probe would not isolate OverSupplierCap");
const amount = cap + 1n;
console.log(`vault ${d.vault} supplier ${supplier} cap ${cap} amount ${amount}`);

const spender = await loadAccount(ks, `${SLUG}-spender`);
const signer = createSpenderSigner({ agentSecret: agentKey(ks, SLUG).secret, spenderQor: spender.cosmos, relayer, net: TESTNET });
const result = await api.relay(await signer.payRequest(d.vault, supplier, amount, ORDER_ID));
console.log("relay result", JSON.stringify(result));
const hash = result.txHash;
if (hash) {
  await Bun.sleep(8000);
  const j = (await (await fetch(`${TESTNET.rest}/cosmos/tx/v1beta1/txs/${hash}`)).json()) as { tx_response?: { code: number; height: string; raw_log?: string; events?: { type: string }[] } };
  const r = j.tx_response;
  console.log("tx code", r?.code, "height", r?.height, "events", JSON.stringify([...new Set(r?.events?.map((e) => e.type))]));
}
const counted = await relayedPayments({ rest: TESTNET.rest, relayer, vault: d.vault, orderId: ORDER_ID, supplier, minHeight: d.startBlock });
console.log("relayedPayments for order 999999:", counted.length, JSON.stringify(counted, (_k, v) => (typeof v === "bigint" ? v.toString() : v)));
