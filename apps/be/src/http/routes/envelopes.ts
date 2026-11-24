import type { Hono } from "hono";
import { z } from "zod";
import type { Db } from "../../db/client.ts";
import * as store from "../../db/store/index.ts";
import type { EngineAuth } from "../middleware/engine-auth.ts";
import type { RateLimit } from "../middleware/rate-limit.ts";
import { bad, hash32, parseBody } from "../validation.ts";

const MAX_ENVELOPE = 262_144;

export function envelopeRoutes(app: Hono, deps: { db: Db; auth: EngineAuth; rateLimit: RateLimit; perMinute: number }): void {
  app.post("/v1/envelopes", deps.rateLimit(deps.perMinute, deps.auth.isEngine), async (c) => {
    const e = await parseBody(c, z.object({ kind: z.enum(["request", "report", "sample"]), body: z.string().min(1) }));
    if (!e) return bad(c, "invalid envelope");
    if (new TextEncoder().encode(e.body).length > MAX_ENVELOPE) return bad(c, "envelope too large", 413);
    if (e.kind !== "request" && !deps.auth.isEngine(c)) return bad(c, "unauthorized", 401);
    return c.json({ hash: await store.putEnvelope(deps.db, e.kind, e.body) });
  });
  app.get("/v1/envelopes/:hash", async (c) => {
    const h = hash32.safeParse(c.req.param("hash"));
    if (!h.success) return bad(c, "invalid hash");
    const e = await store.getEnvelope(deps.db, h.data);
    return e ? c.json(e) : bad(c, "not found", 404);
  });
}
