import type { Hono } from "hono";
import { z } from "zod";
import type { Db } from "../../db/client.ts";
import * as store from "../../db/store/index.ts";
import type { EngineAuth } from "../middleware/engine-auth.ts";
import { bad, evmAddress, parseBody } from "../validation.ts";

const businessSchema = z.object({
  slug: z.string().regex(/^[a-z0-9-]{2,40}$/), vault: evmAddress, name: z.string().min(1).max(80),
  tagline: z.string().max(200), services: z.custom<unknown>((v) => v !== undefined), operator: evmAddress, spender: evmAddress,
  startBlock: z.number().int().nonnegative(),
  version: z.union([z.literal(1), z.literal(2)]).default(1),
});

const NO_STATS: store.BusinessStats = { delivered: 0, rejected: 0, uniqueBuyers: 0 };

export function businessRoutes(app: Hono, deps: { db: Db; auth: EngineAuth }): void {
  app.get("/v1/businesses", async (c) => {
    const [list, stats] = await Promise.all([store.listBusinesses(deps.db), store.orderStats(deps.db)]);
    return c.json(list.map((b) => ({ ...b, stats: stats.get(b.vault) ?? NO_STATS })));
  });
  app.get("/v1/businesses/:slug", async (c) => {
    const b = await store.getBusiness(deps.db, c.req.param("slug"));
    if (!b) return bad(c, "not found", 404);
    const stats = await store.orderStats(deps.db, b.vault);
    return c.json({ ...b, stats: stats.get(b.vault) ?? NO_STATS });
  });
  app.post("/v1/businesses", deps.auth.requireEngine, async (c) => {
    const b = await parseBody(c, businessSchema);
    if (!b) return bad(c, "invalid business");
    await store.upsertBusiness(deps.db, { ...b, services: b.services });
    return c.body(null, 204);
  });
}
