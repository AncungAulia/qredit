import { beforeEach, describe, expect, test } from "bun:test";
import { type Db } from "../../src/db/client.ts";
import { useTestDb } from "../helpers/db.ts";
import { FaucetCapReached, FaucetCooldown } from "../../src/services/faucet.ts";
import { createApp } from "../../src/http/app.ts";
import { RelayRejected } from "../../src/services/relayer.ts";
import { applyVaultEvent } from "../../src/db/store/index.ts";

const TOKEN = "t".repeat(32);
const V = "0x00000000000000000000000000000000000000aa";
const ADDR = "qor1lcukj5fkcfqxfphjsp5snjj5lrngy6sxug7jwl";
const testDb = useTestDb();
let db: Db;
let app: ReturnType<typeof createApp>;
let faucetCalls: [string, string][];

beforeEach(async () => {
  db = await testDb();
  faucetCalls = [];
  app = createApp({
    db, engineToken: TOKEN, corsOrigins: ["https://app.qredit.fun"], relayerAddress: "qor1relayer",
    relay: async (r) => { if (r.value.value !== "0") throw new RelayRejected("value must be 0"); return { txHash: "H", success: true }; },
    faucet: async (address, ip) => { faucetCalls.push([address, ip]); if (address === ADDR && faucetCalls.length > 1) throw new FaucetCooldown(new Date("2030-01-01T00:00:00Z")); return { tx: "F" }; },
    verifyCard: async (_a, card) => {
      const c = card as { ok?: boolean; down?: boolean };
      return c.down ? { ok: false, reason: "unavailable" } : c.ok === true ? { ok: true } : { ok: false, reason: "mismatch" };
    },
    trustedProxyHops: 1,
    rateLimits: { envelopes: 1000, cards: 1000, faucet: 1000 },
  });
});

const engine = { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" };
const json = { "content-type": "application/json" };
const post = (path: string, body: unknown, headers: Record<string, string> = json, env?: unknown) =>
  app.request(path, { method: "POST", headers, body: JSON.stringify(body) }, env);
const peer = (address: string) => ({ server: { requestIP: () => ({ address, family: "IPv4", port: 1 }) } });

const mkApp = (over: Partial<Parameters<typeof createApp>[0]> = {}) =>
  createApp({
    db, engineToken: TOKEN, corsOrigins: [], relayerAddress: "qor1relayer",
    relay: async () => ({ txHash: "H", success: true }),
    faucet: async () => ({ tx: "F" }),
    verifyCard: async () => ({ ok: true }),
    trustedProxyHops: 1,
    rateLimits: { envelopes: 1000, cards: 1000, faucet: 1000 },
    ...over,
  });

describe("client ip", () => {
  const ipOf = async (hops: number, headers: Record<string, string>, env?: unknown, clientIpHeader?: string) => {
    const seen: string[] = [];
    const a = mkApp({ trustedProxyHops: hops, clientIpHeader, faucet: async (_a, ip) => { seen.push(ip); return { tx: "F" }; } });
    await a.request("/v1/faucet", { method: "POST", headers: { ...json, ...headers }, body: JSON.stringify({ address: ADDR }) }, env);
    return seen[0];
  };
  test("takes the entry the trusted proxy appended and ignores spoofed leftmost ones", async () => {
    expect(await ipOf(1, { "x-forwarded-for": "6.6.6.6, 7.7.7.7, 203.0.113.9" }, peer("10.0.0.1"))).toBe("203.0.113.9");
    expect(await ipOf(2, { "x-forwarded-for": "6.6.6.6, 203.0.113.9, 10.1.1.1" }, peer("10.0.0.1"))).toBe("203.0.113.9");
  });
  test("a header shorter than the hops falls back to the socket peer", async () => {
    expect(await ipOf(2, { "x-forwarded-for": "6.6.6.6" }, peer("198.51.100.4"))).toBe("198.51.100.4");
    expect(await ipOf(1, {}, peer("198.51.100.4"))).toBe("198.51.100.4");
  });
  test("with zero hops the header is ignored entirely", async () => {
    expect(await ipOf(0, { "x-forwarded-for": "6.6.6.6" }, peer("198.51.100.4"))).toBe("198.51.100.4");
  });
  test("a non-ip entry falls back to the peer; no peer at all is unknown", async () => {
    expect(await ipOf(1, { "x-forwarded-for": "not-an-ip" }, peer("198.51.100.4"))).toBe("198.51.100.4");
    expect(await ipOf(1, {})).toBe("unknown");
  });
});

describe("client ip header", () => {
  const ipOf = async (headers: Record<string, string>, clientIpHeader: string | undefined, env?: unknown) => {
    const seen: string[] = [];
    const a = mkApp({ clientIpHeader, faucet: async (_a, ip) => { seen.push(ip); return { tx: "F" }; } });
    await a.request("/v1/faucet", { method: "POST", headers: { ...json, ...headers }, body: JSON.stringify({ address: ADDR }) }, env);
    return seen[0];
  };
  test("a valid ip in the configured header wins over x-forwarded-for and the peer", async () => {
    expect(await ipOf({ "x-real-ip": "203.0.113.7", "x-forwarded-for": "6.6.6.6, 9.9.9.9" }, "x-real-ip", peer("10.0.0.1"))).toBe("203.0.113.7");
    expect(await ipOf({ "x-real-ip": "2001:db8::1" }, "x-real-ip", peer("10.0.0.1"))).toBe("2001:db8::1");
  });
  test("a missing or invalid value falls back to the x-forwarded-for logic", async () => {
    expect(await ipOf({ "x-forwarded-for": "6.6.6.6, 203.0.113.9" }, "x-real-ip", peer("10.0.0.1"))).toBe("203.0.113.9");
    expect(await ipOf({ "x-real-ip": "nope", "x-forwarded-for": "6.6.6.6, 203.0.113.9" }, "x-real-ip", peer("10.0.0.1"))).toBe("203.0.113.9");
    expect(await ipOf({ "x-real-ip": "nope" }, "x-real-ip", peer("198.51.100.4"))).toBe("198.51.100.4");
  });
  test("when not configured the header is ignored", async () => {
    expect(await ipOf({ "x-real-ip": "203.0.113.7" }, undefined, peer("198.51.100.4"))).toBe("198.51.100.4");
  });
});

describe("body limits", () => {
  test("16 KB everywhere but envelopes (300 KB); 413 before parsing and auth", async () => {
    const big = "x".repeat(20 * 1024);
    expect((await post("/v1/faucet", { address: big })).status).toBe(413);
    expect((await post("/v1/decisions", { reason: big }, engine)).status).toBe(413);
    expect((await post("/v1/envelopes", { kind: "request", body: big })).status).toBe(200);
    expect((await post("/v1/envelopes", { kind: "request", body: "x".repeat(301 * 1024) })).status).toBe(413);
    // announced size: refused before the engine-auth check and before any parsing
    const res = await app.request("/v1/relay", { method: "POST", headers: { ...json, "content-length": "99999" }, body: "{}" });
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: "request body too large" });
  });
});

describe("rate limits", () => {
  const call = (a: ReturnType<typeof createApp>, path: string, method: string, body: unknown, headers: Record<string, string> = json, ip = "1.1.1.1") =>
    a.request(path, { method, headers, body: JSON.stringify(body) }, peer(ip));

  test("429 with retryAfter, per ip, before validation", async () => {
    let t = 0;
    const a = mkApp({ rateLimits: { envelopes: 2, cards: 1, faucet: 1 }, now: () => t });
    expect((await call(a, "/v1/faucet", "POST", { address: "bad" })).status).toBe(400);
    const res = await call(a, "/v1/faucet", "POST", { address: "bad" });
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: "too many requests", retryAfter: 60 });
    expect(res.headers.get("retry-after")).toBe("60");
    expect((await call(a, "/v1/faucet", "POST", { address: "bad" }, json, "2.2.2.2")).status).toBe(400);
    t = 61_000;
    expect((await call(a, "/v1/faucet", "POST", { address: "bad" })).status).toBe(400);
  });

  test("cards and envelopes are limited; the engine is not", async () => {
    const a = mkApp({ rateLimits: { envelopes: 2, cards: 1, faucet: 1 }, now: () => 0 });
    const card = () => call(a, `/v1/cards/${ADDR}`, "PUT", { card: {} });
    expect((await card()).status).toBe(204);
    expect((await card()).status).toBe(429);
    const env = () => call(a, "/v1/envelopes", "POST", { kind: "request", body: "x" });
    expect((await env()).status).toBe(200);
    expect((await env()).status).toBe(200);
    expect((await env()).status).toBe(429);
    for (let i = 0; i < 5; i++) expect((await call(a, "/v1/envelopes", "POST", { kind: "report", body: "x" }, engine)).status).toBe(200);
  });
});

describe("relay field caps", () => {
  test("oversized value fields are rejected at the schema", async () => {
    const r = (over: Record<string, string>) => ({ typeUrl: "x", value: { relayer: "r", account: "a", scheme: "ed25519", pubkey: "", signature: "", to: V, value: "0", data: "", gasLimit: "1", nonce: "0", ...over } });
    expect((await post("/v1/relay", r({}), engine)).status).toBe(200);
    for (const [f, n] of [["data", 401], ["pubkey", 65], ["signature", 133], ["nonce", 129]] as const) {
      expect((await post("/v1/relay", r({ [f]: "A".repeat(n) }), engine)).status).toBe(400);
    }
  });
});

describe("public routes", () => {
  test("health and relayer", async () => {
    expect(await (await app.request("/health")).json()).toEqual({ ok: true });
    expect(await (await app.request("/v1/relayer")).json()).toEqual({ address: "qor1relayer" });
  });

  test("request envelopes round trip; report envelopes need the engine", async () => {
    const res = await post("/v1/envelopes", { kind: "request", body: "sealed-bytes" });
    expect(res.status).toBe(200);
    const { hash } = (await res.json()) as { hash: string };
    expect(await (await app.request(`/v1/envelopes/${hash}`)).json()).toEqual({ kind: "request", body: "sealed-bytes" });
    expect((await post("/v1/envelopes", { kind: "report", body: "x" })).status).toBe(401);
    expect((await post("/v1/envelopes", { kind: "report", body: "x" }, engine)).status).toBe(200);
    expect((await app.request(`/v1/envelopes/0x${"0".repeat(64)}`)).status).toBe(404);
    expect((await post("/v1/envelopes", { kind: "request", body: "x".repeat(262_145) })).status).toBe(413);
    expect((await post("/v1/envelopes", { kind: "nope", body: "x" })).status).toBe(400);
  });

  test("cards are stored only when they verify", async () => {
    const put = (card: unknown) => app.request(`/v1/cards/${ADDR}`, { method: "PUT", headers: json, body: JSON.stringify({ card }) });
    expect((await put({ ok: false })).status).toBe(422);
    expect((await app.request(`/v1/cards/${ADDR}`)).status).toBe(404);
    expect((await put({ ok: true })).status).toBe(204);
    expect(await (await app.request(`/v1/cards/${ADDR}`)).json()).toEqual({ card: { ok: true } });
    expect((await app.request("/v1/cards/not-an-address", { method: "PUT", headers: json, body: "{}" })).status).toBe(400);
  });

  test("faucet takes the client ip from x-forwarded-for and maps cooldown to 429", async () => {
    const res = await post("/v1/faucet", { address: ADDR }, { ...json, "x-forwarded-for": "9.9.9.9, 10.0.0.1" });
    expect(await res.json()).toEqual({ tx: "F" });
    expect(faucetCalls[0]).toEqual([ADDR, "10.0.0.1"]);
    const again = await post("/v1/faucet", { address: ADDR });
    expect(again.status).toBe(429);
    expect(await again.json()).toMatchObject({ retryAt: "2030-01-01T00:00:00.000Z" });
    expect((await post("/v1/faucet", { address: "0xabc" })).status).toBe(400);
  });

  test("faucet daily cap maps to 503", async () => {
    const capped = mkApp({ faucet: async () => { throw new FaucetCapReached(); } });
    const res = await capped.request("/v1/faucet", { method: "POST", headers: json, body: JSON.stringify({ address: ADDR }) });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: expect.stringContaining("daily limit") });
  });

  test("card lookups: unavailable chain is 503, mismatch is 422", async () => {
    const put = (card: unknown) => app.request(`/v1/cards/${ADDR}`, { method: "PUT", headers: json, body: JSON.stringify({ card }) });
    expect((await put({ down: true })).status).toBe(503);
    expect((await put({})).status).toBe(422);
  });

  test("cors allows the app origin only", async () => {
    const ok = await app.request("/health", { headers: { origin: "https://app.qredit.fun" } });
    expect(ok.headers.get("access-control-allow-origin")).toBe("https://app.qredit.fun");
    const other = await app.request("/health", { headers: { origin: "https://evil.example" } });
    expect(other.headers.get("access-control-allow-origin")).toBeNull();
  });
});

describe("engine routes", () => {
  const biz = { slug: "counterparty", vault: V, name: "Counterparty Check", tagline: "t", services: [], operator: V, spender: V, startBlock: 5 };

  test("reject a missing or wrong token", async () => {
    expect((await post("/v1/businesses", biz)).status).toBe(401);
    expect((await post("/v1/businesses", biz, { ...json, authorization: `Bearer ${"x".repeat(32)}` })).status).toBe(401);
  });

  test("businesses, orders, claims and decisions", async () => {
    expect((await post("/v1/businesses", biz, engine)).status).toBe(204);
    expect(((await (await app.request("/v1/businesses")).json()) as unknown[]).length).toBe(1);
    expect((await app.request("/v1/businesses/counterparty")).status).toBe(200);
    expect((await app.request("/v1/businesses/none")).status).toBe(404);

    await applyVaultEvent(db, { kind: "OrderPlaced", vault: V, orderId: "1", block: 9, logIndex: 0, tx: "0x1", buyer: V, serviceId: 0, price: "1", requestRef: `0x${"a".repeat(64)}`, deadline: 1 });
    expect(((await (await app.request(`/v1/orders?vault=${V}`)).json()) as unknown[]).length).toBe(1);
    const claim = (await (await post("/v1/orders/claim", { vaults: [V] }, engine)).json()) as { order: { orderId: string } | null };
    expect(claim.order?.orderId).toBe("1");
    expect(((await (await post("/v1/orders/claim", { vaults: [V] }, engine)).json()) as { order: null }).order).toBeNull();

    const d = await post("/v1/decisions", { vault: V, orderId: "1", decision: "accepted", reason: "fits budget", suppliers: [], cost: "0" }, engine);
    expect(await d.json()).toEqual({ id: 1 });
    expect(((await (await app.request(`/v1/decisions?vault=${V}`)).json()) as unknown[]).length).toBe(1);
  });

  test("relay maps a rejection to 422", async () => {
    const r = (value: string) => ({ typeUrl: "x", value: { relayer: "qor1relayer", account: "a", scheme: "ed25519", pubkey: "", signature: "", to: V, value, data: "", gasLimit: "1", nonce: "0" } });
    expect(await (await post("/v1/relay", r("0"), engine)).json()).toEqual({ txHash: "H", success: true });
    const bad = await post("/v1/relay", r("9"), engine);
    expect(bad.status).toBe(422);
    expect(await bad.json()).toEqual({ error: "value must be 0" });
  });
});
