import { timingSafeEqual } from "node:crypto";
import { Hono, type Context } from "hono";
import { cors } from "hono/cors";
import { z } from "zod";
import type { Db } from "./db.ts";
import { FaucetCooldown } from "./faucet.ts";
import { type RelayRequest, RelayRejected, type RelayResult } from "./relayer.ts";
import * as store from "./store.ts";

export type AppDeps = {
  db: Db;
  engineToken: string;
  corsOrigins: string[];
  relayerAddress: string;
  relay: (r: RelayRequest) => Promise<RelayResult>;
  faucet: (address: string, ip: string) => Promise<{ tx: string }>;
  verifyCard: (address: string, card: unknown) => Promise<boolean>;
};

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
  typeUrl: z.string(),
  value: z.object({
    relayer: z.string(), account: z.string(), scheme: z.string(), pubkey: z.string(), signature: z.string(),
    to: z.string(), value: z.string(), data: z.string(), gasLimit: z.string(), nonce: z.string(),
  }),
});

export function createApp(deps: AppDeps): Hono {
  const app = new Hono();
  app.use("*", cors({ origin: (origin) => (deps.corsOrigins.includes(origin) ? origin : null), allowMethods: ["GET", "POST", "PUT"] }));

  const token = Buffer.from(deps.engineToken);
  const isEngine = (c: Context) => {
    const given = Buffer.from((c.req.header("authorization") ?? "").replace(/^Bearer /, ""));
    return given.length === token.length && timingSafeEqual(given, token);
  };
  const bad = (c: Context, error: string, status: 400 | 401 | 404 | 413 | 422 | 429 = 400) => c.json({ error }, status);
  const body = async <T>(c: Context, schema: z.ZodType<T>): Promise<T | null> => {
    const parsed = schema.safeParse(await c.req.json().catch(() => undefined));
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

  app.post("/v1/envelopes", async (c) => {
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

  app.put("/v1/cards/:address", async (c) => {
    const address = qorAddress.safeParse(c.req.param("address"));
    if (!address.success) return bad(c, "invalid address");
    const b = await body(c, z.object({ card: z.unknown() }));
    if (!b || b.card === undefined) return bad(c, "invalid card");
    if (!(await deps.verifyCard(address.data, b.card))) return bad(c, "the card does not match the keys registered on chain", 422);
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

  app.post("/v1/faucet", async (c) => {
    const b = await body(c, z.object({ address: qorAddress }));
    if (!b) return bad(c, "invalid qor1 address");
    const ip = (c.req.header("x-forwarded-for") ?? "").split(",")[0]?.trim() || "unknown";
    try {
      return c.json(await deps.faucet(b.address, ip));
    } catch (e) {
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
