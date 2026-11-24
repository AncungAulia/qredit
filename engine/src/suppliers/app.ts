import { Hono } from "hono";
import type { PublicClient } from "viem";
import { SUPPLIER_PAID_EVENT } from "@qredit/qore";
import type { SupplierRole } from "../setup/businesses.ts";

export interface PaymentSource {
  paid(vault: string, orderId: string, supplier: string): Promise<bigint>;
}

type Entry = { name: string; priceUnits: string; address: string };

export function createSupplierApp(deps: {
  payments: PaymentSource;
  catalog: Record<SupplierRole, Entry>;
  data: Record<SupplierRole, (query: Record<string, string>) => Promise<unknown>>;
}): Hono {
  const app = new Hono();
  app.get("/v1/:role", async (c) => {
    const role = c.req.param("role") as SupplierRole;
    const entry = deps.catalog[role];
    if (!entry) return c.json({ error: "unknown supplier" }, 404);
    const q = c.req.query();
    if (!/^0x[0-9a-fA-F]{40}$/.test(q.vault ?? "") || !/^[0-9]+$/.test(q.orderId ?? "")) return c.json({ error: "vault and orderId are required" }, 400);
    const paid = await deps.payments.paid(q.vault.toLowerCase(), q.orderId, entry.address.toLowerCase());
    if (paid < BigInt(entry.priceUnits)) return c.json({ error: "payment required", priceUnits: entry.priceUnits, payTo: entry.address }, 402);
    return c.json({ supplier: entry.name, data: await deps.data[role](q) });
  });
  return app;
}

/** Sum of SupplierPaid amounts the vault sent to this supplier for this order (recent blocks). */
export function chainPayments(client: PublicClient, lookbackBlocks = 50_000n): PaymentSource {
  return {
    async paid(vault, orderId, supplier) {
      const head = await client.getBlockNumber();
      const logs = await client.getLogs({
        address: vault as `0x${string}`, event: SUPPLIER_PAID_EVENT[0],
        args: { supplier: supplier as `0x${string}`, orderId: BigInt(orderId) },
        fromBlock: head > lookbackBlocks ? head - lookbackBlocks : 0n, toBlock: head,
      });
      return logs.reduce((sum, l) => sum + (l.args.amount ?? 0n), 0n);
    },
  };
}
