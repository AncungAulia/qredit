import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Db } from "../db/client.ts";
import type { CardVerdict } from "../services/cards.ts";
import type { RelayRequest, RelayResult } from "../services/relayer.ts";
import { bodyLimits } from "./middleware/body-limit.ts";
import { clientIpResolver } from "./middleware/client-ip.ts";
import { engineAuth } from "./middleware/engine-auth.ts";
import { rateLimiter } from "./middleware/rate-limit.ts";
import { businessRoutes } from "./routes/businesses.ts";
import { cardRoutes } from "./routes/cards.ts";
import { decisionRoutes } from "./routes/decisions.ts";
import { envelopeRoutes } from "./routes/envelopes.ts";
import { faucetRoutes } from "./routes/faucet.ts";
import { healthRoutes } from "./routes/health.ts";
import { orderRoutes } from "./routes/orders.ts";
import { relayRoutes } from "./routes/relay.ts";

export { MAX_BODY_DEFAULT, MAX_BODY_ENVELOPE } from "./middleware/body-limit.ts";

export type AppDeps = {
  db: Db;
  engineToken: string;
  corsOrigins: string[];
  relayerAddress: string;
  relay: (r: RelayRequest) => Promise<RelayResult>;
  faucet: (address: string, ip: string) => Promise<{ tx: string }>;
  verifyCard: (address: string, card: unknown) => Promise<CardVerdict>;
  /** Reverse proxies in front of the server (0 = ignore x-forwarded-for). */
  trustedProxyHops: number;
  /** Requests per minute per client ip; in memory, per instance. */
  rateLimits: { envelopes: number; cards: number; faucet: number };
  now?: () => number;
};

export function createApp(deps: AppDeps): Hono {
  const app = new Hono();
  app.use("*", cors({ origin: (origin) => (deps.corsOrigins.includes(origin) ? origin : null), allowMethods: ["GET", "POST", "PUT"] }));
  app.use("*", bodyLimits());

  const auth = engineAuth(deps.engineToken);
  const clientIp = clientIpResolver(deps.trustedProxyHops);
  const rateLimit = rateLimiter(clientIp, deps.now);

  healthRoutes(app, deps);
  businessRoutes(app, { db: deps.db, auth });
  envelopeRoutes(app, { db: deps.db, auth, rateLimit, perMinute: deps.rateLimits.envelopes });
  cardRoutes(app, { db: deps.db, rateLimit, perMinute: deps.rateLimits.cards, verifyCard: deps.verifyCard });
  decisionRoutes(app, { db: deps.db, auth });
  orderRoutes(app, { db: deps.db, auth });
  relayRoutes(app, { auth, relay: deps.relay });
  faucetRoutes(app, { rateLimit, perMinute: deps.rateLimits.faucet, clientIp, faucet: deps.faucet });

  app.onError((err, c) => {
    console.error("[http]", err.message);
    return c.json({ error: "internal error" }, 500);
  });

  return app;
}
