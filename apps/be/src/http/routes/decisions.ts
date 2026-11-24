import type { Hono } from "hono";
import { z } from "zod";
import type { Db } from "../../db/client.ts";
import * as store from "../../db/store/index.ts";
import type { EngineAuth } from "../middleware/engine-auth.ts";
import { bad, evmAddress, parseBody } from "../validation.ts";

const decisionSchema = z.object({
  vault: evmAddress, orderId: z.string().nullable(), decision: z.enum(["accepted", "declined", "delivered", "failed"]),
  reason: z.string().max(500), suppliers: z.array(z.unknown()).max(20), cost: z.string().regex(/^[0-9]+$/),
});

export function decisionRoutes(app: Hono, deps: { db: Db; auth: EngineAuth }): void {
  app.get("/v1/decisions", async (c) => {
    const vault = evmAddress.safeParse(c.req.query("vault"));
    if (!vault.success) return bad(c, "invalid vault");
    const limit = Math.min(Math.max(Number(c.req.query("limit") ?? 50) || 50, 1), 200);
    return c.json(await store.listDecisions(deps.db, vault.data, limit));
  });
  app.post("/v1/decisions", deps.auth.requireEngine, async (c) => {
    const d = await parseBody(c, decisionSchema);
    if (!d) return bad(c, "invalid decision");
    return c.json({ id: await store.addDecision(deps.db, d) });
  });
}
