import type { Hono } from "hono";
import { z } from "zod";
import { type RelayRequest, RelayRejected, type RelayResult } from "../../services/relayer.ts";
import type { EngineAuth } from "../middleware/engine-auth.ts";
import { bad, parseBody } from "../validation.ts";

const relaySchema = z.object({
  typeUrl: z.string().max(128),
  value: z.object({
    relayer: z.string().max(128), account: z.string().max(128), scheme: z.string().max(128),
    pubkey: z.string().max(64), signature: z.string().max(132),
    to: z.string().max(128), value: z.string().max(128), data: z.string().max(400), gasLimit: z.string().max(128), nonce: z.string().max(128),
  }),
});

export function relayRoutes(app: Hono, deps: { auth: EngineAuth; relay: (r: RelayRequest) => Promise<RelayResult> }): void {
  app.post("/v1/relay", deps.auth.requireEngine, async (c) => {
    const r = await parseBody(c, relaySchema);
    if (!r) return bad(c, "invalid relay request");
    try {
      return c.json(await deps.relay(r));
    } catch (e) {
      if (e instanceof RelayRejected) return bad(c, e.message, 422);
      throw e;
    }
  });
}
