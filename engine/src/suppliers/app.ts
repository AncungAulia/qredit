import { Hono } from "hono";
import type { PublicClient } from "viem";
import { scanChunked, SUPPLIER_PAID_EVENT } from "@qredit/qore";
import type { SupplierRole } from "../setup/businesses.ts";

export interface PaymentSource {
  paid(vault: string, orderId: string, supplier: string, startBlock: number): Promise<bigint>;
}

type Entry = { name: string; priceUnits: string; address: string };
/** Qredit vaults the supplier serves, keyed by lowercase address. */
export type VaultAllowList = Map<string, { startBlock: number }>;

/** uint256 has at most 78 decimal digits. */
const ORDER_ID = /^[0-9]{1,78}$/;
const HEX_ADDRESS = /^0x[0-9a-fA-F]{40}$/;

export function createSupplierApp(deps: {
  payments: PaymentSource;
  vaults: VaultAllowList;
  catalog: Record<SupplierRole, Entry>;
  data: Record<SupplierRole, (query: Record<string, string>) => Promise<unknown>>;
}): Hono {
  const app = new Hono();
  app.get("/v1/:role", async (c) => {
    const role = c.req.param("role");
    if (!Object.hasOwn(deps.catalog, role)) return c.json({ error: "unknown supplier" }, 404);
    const entry = deps.catalog[role as SupplierRole];
    const q = c.req.query();
    if (!HEX_ADDRESS.test(q.vault ?? "") || !ORDER_ID.test(q.orderId ?? "")) return c.json({ error: "vault and orderId are required" }, 400);
    const vault = deps.vaults.get(q.vault.toLowerCase());
    if (!vault) return c.json({ error: "unknown vault" }, 404);
    let paid: bigint;
    try {
      paid = await deps.payments.paid(q.vault.toLowerCase(), q.orderId, entry.address.toLowerCase(), vault.startBlock);
    } catch (e) {
      console.error(`[suppliers] payment check failed: ${(e as Error).message}`);
      return c.json({ error: "payment check unavailable" }, 503);
    }
    if (paid < BigInt(entry.priceUnits)) return c.json({ error: "payment required", priceUnits: entry.priceUnits, payTo: entry.address }, 402);
    return c.json({ supplier: entry.name, data: await deps.data[role as SupplierRole](q) });
  });
  return app;
}

/** Sum of SupplierPaid amounts the vault sent to this supplier for this order, scanned from the vault's start block. */
export function chainPayments(client: PublicClient): PaymentSource {
  return {
    async paid(vault, orderId, supplier, startBlock) {
      const head = Number(await client.getBlockNumber());
      const logs = await scanChunked(startBlock, head, (fromBlock, toBlock) =>
        client.getLogs({
          address: vault as `0x${string}`, event: SUPPLIER_PAID_EVENT[0],
          args: { supplier: supplier as `0x${string}`, orderId: BigInt(orderId) },
          fromBlock, toBlock,
        }),
      );
      return logs.reduce((sum, l) => sum + (l.args.amount ?? 0n), 0n);
    },
  };
}
