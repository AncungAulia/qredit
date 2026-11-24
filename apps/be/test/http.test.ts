import { beforeEach, describe, expect, test } from "bun:test";
import { type Db, memoryDb } from "../src/db.ts";
import { FaucetCooldown } from "../src/faucet.ts";
import { createApp } from "../src/http.ts";
import { MIGRATIONS_DIR, runMigrations } from "../src/migrate.ts";
import { RelayRejected } from "../src/relayer.ts";
import { applyVaultEvent } from "../src/store.ts";

const TOKEN = "t".repeat(32);
const V = "0x00000000000000000000000000000000000000aa";
const ADDR = "qor1lcukj5fkcfqxfphjsp5snjj5lrngy6sxug7jwl";
let db: Db;
let app: ReturnType<typeof createApp>;
let faucetCalls: [string, string][];

beforeEach(async () => {
  db = await memoryDb();
  await runMigrations(db, MIGRATIONS_DIR);
  faucetCalls = [];
  app = createApp({
    db, engineToken: TOKEN, corsOrigins: ["https://app.qredit.fun"], relayerAddress: "qor1relayer",
    relay: async (r) => { if (r.value.value !== "0") throw new RelayRejected("value must be 0"); return { txHash: "H", success: true }; },
    faucet: async (address, ip) => { faucetCalls.push([address, ip]); if (address === ADDR && faucetCalls.length > 1) throw new FaucetCooldown(new Date("2030-01-01T00:00:00Z")); return { tx: "F" }; },
    verifyCard: async (_a, card) => (card as { ok?: boolean }).ok === true,
  });
});

const engine = { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" };
const json = { "content-type": "application/json" };
const post = (path: string, body: unknown, headers: Record<string, string> = json) => app.request(path, { method: "POST", headers, body: JSON.stringify(body) });

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
    expect(faucetCalls[0]).toEqual([ADDR, "9.9.9.9"]);
    const again = await post("/v1/faucet", { address: ADDR });
    expect(again.status).toBe(429);
    expect(await again.json()).toMatchObject({ retryAt: "2030-01-01T00:00:00.000Z" });
    expect((await post("/v1/faucet", { address: "0xabc" })).status).toBe(400);
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
