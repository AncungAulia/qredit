import { timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";
import { Hono, type Context, type MiddlewareHandler } from "hono";
import { getConnInfo } from "hono/bun";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
import { z } from "zod";
import type { CardVerdict } from "./cards.ts";
import type { Db } from "./db.ts";
import { FaucetCapReached, FaucetCooldown } from "./faucet.ts";
import { createRateLimiter } from "./ratelimit.ts";
import { type RelayRequest, RelayRejected, type RelayResult } from "./relayer.ts";
import * as store from "./store.ts";

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

export const MAX_BODY_DEFAULT = 16 * 1024;
export const MAX_BODY_ENVELOPE = 300 * 1024;
const RATE_WINDOW_MS = 60_000;

const MAX_ENVELOPE = 262_144;
const qorAddress = z.string().regex(/^qor1[02-9ac-hj-np-z]{38,58}$/);
const evmAddress = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
const hash32 = z.string().regex(/^0x[0-9a-fA-F]{64}$/);

const businessSchema = z.object({
  slug: z.string().regex(/^[a-z0-9-]{2,40}$/), vault: evmAddress, name: z.string().min(1).max(80),
  tagline: z.string().max(200), services: z.custom<unknown>((v) => v !== undefined), operator: evmAddress, spender: evmAddress,
  startBlock: z.number().int().nonnegative(),
});
const decisionSchema = z.object({
  vault: evmAddress, orderId: z.string().nullable(), decision: z.enum(["accepted", "declined", "delivered", "failed"]),
  reason: z.string().max(500), suppliers: z.array(z.unknown()).max(20), cost: z.string().regex(/^[0-9]+$/),
});
const relaySchema = z.object({
  typeUrl: z.string().max(128),
  value: z.object({
    relayer: z.string().max(128), account: z.string().max(128), scheme: z.string().max(128),
    pubkey: z.string().max(64), signature: z.string().max(132),
    to: z.string().max(128), value: z.string().max(128), data: z.string().max(400), gasLimit: z.string().max(128), nonce: z.string().max(128),
  }),
});

export function createApp(deps: AppDeps): Hono {
  const app = new Hono();
  app.use("*", cors({ origin: (origin) => (deps.corsOrigins.includes(origin) ? origin : null), allowMethods: ["GET", "POST", "PUT"] }));

  // Size limits run before any JSON parsing or auth that needs the body.
  const tooLarge = (c: Context) => c.json({ error: "request body too large" }, 413);
  const small = bodyLimit({ maxSize: MAX_BODY_DEFAULT, onError: tooLarge });
  const large = bodyLimit({ maxSize: MAX_BODY_ENVELOPE, onError: tooLarge });
  app.use("*", (c, next) => (c.req.method === "POST" && c.req.path === "/v1/envelopes" ? large(c, next) : small(c, next)));

  /** The address the trusted proxy appended to x-forwarded-for; otherwise the socket peer. Never the leftmost entry. */
  const clientIp = (c: Context): string => {
    if (deps.trustedProxyHops > 0) {
      const parts = (c.req.header("x-forwarded-for") ?? "").split(",").map((p) => p.trim());
      const candidate = parts.length >= deps.trustedProxyHops ? parts[parts.length - deps.trustedProxyHops] : undefined;
      if (candidate && isIP(candidate)) return candidate;
    }
    try {
      return getConnInfo(c).remote.address ?? "unknown";
    } catch {
      return "unknown";
    }
  };
  const limited = (perMinute: number, skip?: (c: Context) => boolean): MiddlewareHandler => {
    const hit = createRateLimiter({ limit: perMinute, windowMs: RATE_WINDOW_MS, now: deps.now });
    return async (c, next) => {
      if (skip?.(c)) return next();
      const r = hit(clientIp(c));
      if (r.ok) return next();
      c.header("retry-after", String(r.retryAfter));
      return c.json({ error: "too many requests", retryAfter: r.retryAfter }, 429);
    };
  };

  const token = Buffer.from(deps.engineToken);
  const isEngine = (c: Context) => {
    const given = Buffer.from((c.req.header("authorization") ?? "").replace(/^Bearer /, ""));
    return given.length === token.length && timingSafeEqual(given, token);
  };
  const bad = (c: Context, error: string, status: 400 | 401 | 404 | 413 | 422 | 429 | 503 = 400) => c.json({ error }, status);
  const body = async <T>(c: Context, schema: z.ZodType<T>): Promise<T | null> => {
    const parsed = schema.safeParse(await c.req.json().catch((e) => { if (e instanceof SyntaxError) return undefined; throw e; }));
    return parsed.success ? parsed.data : null;
  };

  app.get("/health", (c) => c.json({ ok: true }));
  app.get("/v1/relayer", (c) => c.json({ address: deps.relayerAddress }));

  app.get("/v1/businesses", async (c) => c.json(await store.listBusinesses(deps.db)));
  app.get("/v1/businesses/:slug", async (c) => {
    const b = await store.getBusiness(deps.db, c.req.param("slug"));
    return b ? c.json(b) : bad(c, "not found", 404);
  });
  app.post("/v1/businesses", async (c) => {
    if (!isEngine(c)) return bad(c, "unauthorized", 401);
    const b = await body(c, businessSchema);
    if (!b) return bad(c, "invalid business");
    await store.upsertBusiness(deps.db, { ...b, services: b.services });
    return c.body(null, 204);
  });

  app.post("/v1/envelopes", limited(deps.rateLimits.envelopes, isEngine), async (c) => {
    const e = await body(c, z.object({ kind: z.enum(["request", "report", "sample"]), body: z.string().min(1) }));
    if (!e) return bad(c, "invalid envelope");
    if (new TextEncoder().encode(e.body).length > MAX_ENVELOPE) return bad(c, "envelope too large", 413);
    if (e.kind !== "request" && !isEngine(c)) return bad(c, "unauthorized", 401);
    return c.json({ hash: await store.putEnvelope(deps.db, e.kind, e.body) });
  });
  app.get("/v1/envelopes/:hash", async (c) => {
    const h = hash32.safeParse(c.req.param("hash"));
    if (!h.success) return bad(c, "invalid hash");
    const e = await store.getEnvelope(deps.db, h.data);
    return e ? c.json(e) : bad(c, "not found", 404);
  });

  app.put("/v1/cards/:address", limited(deps.rateLimits.cards), async (c) => {
    const address = qorAddress.safeParse(c.req.param("address"));
    if (!address.success) return bad(c, "invalid address");
    const b = await body(c, z.object({ card: z.unknown() }));
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

  app.get("/v1/decisions", async (c) => {
    const vault = evmAddress.safeParse(c.req.query("vault"));
    if (!vault.success) return bad(c, "invalid vault");
    const limit = Math.min(Math.max(Number(c.req.query("limit") ?? 50) || 50, 1), 200);
    return c.json(await store.listDecisions(deps.db, vault.data, limit));
  });
  app.post("/v1/decisions", async (c) => {
    if (!isEngine(c)) return bad(c, "unauthorized", 401);
    const d = await body(c, decisionSchema);
    if (!d) return bad(c, "invalid decision");
    return c.json({ id: await store.addDecision(deps.db, d) });
  });

  app.get("/v1/orders", async (c) => {
    const vault = evmAddress.safeParse(c.req.query("vault"));
    if (!vault.success) return bad(c, "invalid vault");
    const status = z.enum(["open", "claimed", "delivered", "declined", "reclaimed"]).optional().safeParse(c.req.query("status"));
    return c.json(await store.listOrders(deps.db, vault.data, status.success ? status.data : undefined));
  });
  app.post("/v1/orders/claim", async (c) => {
    if (!isEngine(c)) return bad(c, "unauthorized", 401);
    const b = await body(c, z.object({ vaults: z.array(evmAddress).max(50) }));
    if (!b) return bad(c, "invalid claim");
    return c.json({ order: await store.claimNextOrder(deps.db, b.vaults) });
  });

  app.post("/v1/relay", async (c) => {
    if (!isEngine(c)) return bad(c, "unauthorized", 401);
    const r = await body(c, relaySchema);
    if (!r) return bad(c, "invalid relay request");
    try {
      return c.json(await deps.relay(r));
    } catch (e) {
      if (e instanceof RelayRejected) return bad(c, e.message, 422);
      throw e;
    }
  });

  app.post("/v1/faucet", limited(deps.rateLimits.faucet), async (c) => {
    const b = await body(c, z.object({ address: qorAddress }));
    if (!b) return bad(c, "invalid qor1 address");
    try {
      return c.json(await deps.faucet(b.address, clientIp(c)));
    } catch (e) {
      if (e instanceof FaucetCapReached) return bad(c, e.message, 503);
      if (e instanceof FaucetCooldown) return c.json({ error: e.message, retryAt: e.retryAt.toISOString() }, 429);
      throw e;
    }
  });

  app.onError((err, c) => {
    console.error("[http]", err.message);
    return c.json({ error: "internal error" }, 500);
  });

  return app;
}
