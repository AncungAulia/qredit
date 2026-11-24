import type { Hono } from "hono";
import { z } from "zod";
import type { Db } from "../../db/client.ts";
import * as store from "../../db/store/index.ts";
import type { EngineAuth } from "../middleware/engine-auth.ts";
import { bad, evmAddress, parseBody } from "../validation.ts";

export function orderRoutes(app: Hono, deps: { db: Db; auth: EngineAuth }): void {
  app.get("/v1/orders", async (c) => {
    const vault = evmAddress.safeParse(c.req.query("vault"));
    if (!vault.success) return bad(c, "invalid vault");
    const status = z.enum(["open", "claimed", "delivered", "declined", "reclaimed"]).optional().safeParse(c.req.query("status"));
    return c.json(await store.listOrders(deps.db, vault.data, status.success ? status.data : undefined));
  });
  app.post("/v1/orders/claim", deps.auth.requireEngine, async (c) => {
    const b = await parseBody(c, z.object({ vaults: z.array(evmAddress).max(50) }));
    if (!b) return bad(c, "invalid claim");
    return c.json({ order: await store.claimNextOrder(deps.db, b.vaults) });
  });
}
