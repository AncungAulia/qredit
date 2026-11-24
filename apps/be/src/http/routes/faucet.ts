import type { Hono } from "hono";
import { z } from "zod";
import { FaucetCapReached, FaucetCooldown } from "../../services/faucet.ts";
import type { ClientIp } from "../middleware/client-ip.ts";
import type { RateLimit } from "../middleware/rate-limit.ts";
import { bad, parseBody, qorAddress } from "../validation.ts";

export function faucetRoutes(
  app: Hono,
  deps: { rateLimit: RateLimit; perMinute: number; clientIp: ClientIp; faucet: (address: string, ip: string) => Promise<{ tx: string }> },
): void {
  app.post("/v1/faucet", deps.rateLimit(deps.perMinute), async (c) => {
    const b = await parseBody(c, z.object({ address: qorAddress }));
    if (!b) return bad(c, "invalid qor1 address");
    try {
      return c.json(await deps.faucet(b.address, deps.clientIp(c)));
    } catch (e) {
      if (e instanceof FaucetCapReached) return bad(c, e.message, 503);
      if (e instanceof FaucetCooldown) return c.json({ error: e.message, retryAt: e.retryAt.toISOString() }, 429);
      throw e;
    }
  });
}
