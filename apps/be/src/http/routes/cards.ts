import type { Hono } from "hono";
import { z } from "zod";
import type { Db } from "../../db/client.ts";
import * as store from "../../db/store/index.ts";
import type { CardVerdict } from "../../services/cards.ts";
import type { RateLimit } from "../middleware/rate-limit.ts";
import { bad, parseBody, qorAddress } from "../validation.ts";

export function cardRoutes(
  app: Hono,
  deps: { db: Db; rateLimit: RateLimit; perMinute: number; verifyCard: (address: string, card: unknown) => Promise<CardVerdict> },
): void {
  app.put("/v1/cards/:address", deps.rateLimit(deps.perMinute), async (c) => {
    const address = qorAddress.safeParse(c.req.param("address"));
    if (!address.success) return bad(c, "invalid address");
    const b = await parseBody(c, z.object({ card: z.unknown() }));
    if (!b || b.card === undefined) return bad(c, "invalid card");
    const verdict = await deps.verifyCard(address.data, b.card);
    if (!verdict.ok) {
      return verdict.reason === "unavailable"
        ? bad(c, "the chain could not be reached to check the card; try again shortly", 503)
        : bad(c, "the card does not match the keys registered on chain", 422);
    }
    await store.putCard(deps.db, address.data, b.card);
    return c.body(null, 204);
  });
  app.get("/v1/cards/:address", async (c) => {
    const card = await store.getCard(deps.db, c.req.param("address"));
    return card === null ? bad(c, "not found", 404) : c.json({ card });
  });
}
