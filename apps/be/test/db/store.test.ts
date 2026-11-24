import { beforeEach, describe, expect, test } from "bun:test";
import { type Db } from "../../src/db/client.ts";
import { useTestDb } from "../helpers/db.ts";
import { envelopeHash } from "@qredit/qore";
import * as store from "../../src/db/store/index.ts";

const V = "0x00000000000000000000000000000000000000aa";
const testDb = useTestDb();
let db: Db;

beforeEach(async () => {
  db = await testDb();
});

const placed = (orderId: string, block: number) => ({
  kind: "OrderPlaced" as const, vault: V, orderId, block, logIndex: 0, tx: `0xtx${orderId}`,
  buyer: "0x00000000000000000000000000000000000000bb", serviceId: 0, price: "250000",
  requestRef: `0x${orderId.padStart(64, "0")}`, deadline: 2_000_000_000,
});

describe("envelopes", () => {
  test("hash is keccak256 of the utf-8 text and storing is idempotent", async () => {
    const h = await store.putEnvelope(db, "request", "hello");
    expect(h).toBe(envelopeHash("hello"));
    expect(h).toBe("0x1c8aff950685c2ed4bc3174f3472287b56d9517b9c948127319a09a7a36deac8");
    expect(await store.putEnvelope(db, "request", "hello")).toBe(h);
    expect(await store.getEnvelope(db, h)).toEqual({ kind: "request", body: "hello" });
    expect(await store.getEnvelope(db, `0x${"0".repeat(64)}`)).toBeNull();
  });
});

describe("businesses", () => {
  test("upsert and read back", async () => {
    const b = { slug: "counterparty", vault: V, name: "Counterparty Check", tagline: "t", services: [{ id: 0 }], operator: V, spender: V, startBlock: 10 };
    await store.upsertBusiness(db, b);
    await store.upsertBusiness(db, { ...b, name: "Counterparty Check v2" });
    expect((await store.listBusinesses(db)).length).toBe(1);
    expect((await store.getBusiness(db, "counterparty"))?.name).toBe("Counterparty Check v2");
    expect(await store.getBusiness(db, "nope")).toBeNull();
  });
});

describe("orders", () => {
  test("watcher events drive the order lifecycle", async () => {
    await store.applyVaultEvent(db, placed("1", 100));
    await store.applyVaultEvent(db, placed("1", 100)); // duplicate log is ignored
    expect((await store.listOrders(db, V)).map((o) => o.status)).toEqual(["open"]);
    await store.applyVaultEvent(db, { kind: "Delivered", vault: V, orderId: "1", block: 101, logIndex: 0, tx: "0xd", envelopeHash: `0x${"ab".repeat(32)}` });
    const [o] = await store.listOrders(db, V);
    expect(o.status).toBe("delivered");
    expect(o.envelopeHash).toBe(`0x${"ab".repeat(32)}`);
  });

  test("a closed order is not reopened and an unknown order returns false", async () => {
    await store.applyVaultEvent(db, placed("1", 100));
    const hash = `0x${"ab".repeat(32)}`;
    expect(await store.applyVaultEvent(db, { kind: "Delivered", vault: V, orderId: "1", block: 101, logIndex: 0, tx: "0xd", envelopeHash: hash })).toBe(true);
    expect(await store.applyVaultEvent(db, { kind: "Declined", vault: V, orderId: "1", block: 102, logIndex: 0, tx: "0xe" })).toBe(false);
    expect((await store.listOrders(db, V))[0].status).toBe("delivered");
    expect(await store.applyVaultEvent(db, { kind: "Reclaimed", vault: V, orderId: "99", block: 103, logIndex: 0, tx: "0xf" })).toBe(false);
    expect(await store.applyVaultEvent(db, placed("1", 100))).toBe(false);
  });

  test("claimNextOrder orders numerically, not by text", async () => {
    await store.applyVaultEvent(db, placed("10", 100));
    await store.applyVaultEvent(db, placed("9", 100));
    expect((await store.claimNextOrder(db, [V]))?.orderId).toBe("9");
  });

  test("claimNextOrder rejects a bad staleAfterSeconds", async () => {
    for (const bad of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      await expect(store.claimNextOrder(db, [V], bad)).rejects.toThrow(/staleAfterSeconds/);
    }
  });

  test("setWatchState never moves backwards", async () => {
    await store.setWatchState(db, V, 50);
    await store.setWatchState(db, V, 40);
    expect(await store.getWatchState(db, V)).toBe(50);
  });

  test("claimNextOrder hands out the oldest open order once", async () => {
    await store.applyVaultEvent(db, placed("2", 200));
    await store.applyVaultEvent(db, placed("1", 100));
    expect((await store.claimNextOrder(db, [V]))?.orderId).toBe("1");
    expect((await store.claimNextOrder(db, [V]))?.orderId).toBe("2");
    expect(await store.claimNextOrder(db, [V])).toBeNull();
    expect(await store.claimNextOrder(db, ["0x00000000000000000000000000000000000000cc"])).toBeNull();
  });

  test("a stale claim can be claimed again", async () => {
    await store.applyVaultEvent(db, placed("1", 100));
    await store.claimNextOrder(db, [V]);
    await db.query("update qredit.orders set claimed_at = now() - interval '11 minutes'");
    expect(await store.claimNextOrder(db, [V])).toBeNull(); // default takeover age is 15 minutes
    expect((await store.claimNextOrder(db, [V], 600))?.orderId).toBe("1");
  });

  test("declined and reclaimed orders are not claimable", async () => {
    await store.applyVaultEvent(db, placed("1", 100));
    await store.applyVaultEvent(db, placed("2", 101));
    await store.applyVaultEvent(db, { kind: "Declined", vault: V, orderId: "1", block: 102, logIndex: 0, tx: "0x1" });
    await store.applyVaultEvent(db, { kind: "Reclaimed", vault: V, orderId: "2", block: 103, logIndex: 0, tx: "0x2" });
    expect(await store.claimNextOrder(db, [V])).toBeNull();
  });
});

describe("cards, decisions, watcher state, grants", () => {
  test("cards", async () => {
    await store.putCard(db, "qor1abc", { v: 1 });
    await store.putCard(db, "qor1abc", { v: 2 });
    expect(await store.getCard(db, "qor1abc")).toEqual({ v: 2 });
    expect(await store.getCard(db, "qor1zzz")).toBeNull();
  });

  test("decisions newest first", async () => {
    await store.addDecision(db, { vault: V, orderId: "1", decision: "accepted", reason: "in budget", suppliers: [], cost: "0" });
    await store.addDecision(db, { vault: V, orderId: "1", decision: "delivered", reason: "ok", suppliers: [{ to: "x" }], cost: "100" });
    const list = await store.listDecisions(db, V, 10);
    expect(list.map((d) => d.decision)).toEqual(["delivered", "accepted"]);
    expect(list[0].suppliers).toEqual([{ to: "x" }]);
  });

  test("watcher state", async () => {
    expect(await store.getWatchState(db, V)).toBeNull();
    await store.setWatchState(db, V, 500);
    await store.setWatchState(db, V, 600);
    expect(await store.getWatchState(db, V)).toBe(600);
  });

  test("addresses are matched case-insensitively", async () => {
    await store.putCard(db, "QOR1ABC", { v: 1 });
    expect(await store.getCard(db, "qor1abc")).toEqual({ v: 1 });
    const g = await store.reserveGrant(db, "QOR1A", "ip1", 24, new Date());
    expect(g.ok).toBe(true);
    expect(await store.lastGrant(db, "qor1a", "ipx")).toBeInstanceOf(Date);
  });

  test("faucet grants by address or ip", async () => {
    expect(await store.lastGrant(db, "qor1a", "ip1")).toBeNull();
    const g = await store.reserveGrant(db, "qor1a", "ip1", 24, new Date());
    if (!g.ok) throw new Error("reserve failed");
    await store.completeGrant(db, g.id, "0xt");
    expect(await store.lastGrant(db, "qor1a", "ip2")).toBeInstanceOf(Date);
    expect(await store.lastGrant(db, "qor1b", "ip1")).toBeInstanceOf(Date);
    expect(await store.lastGrant(db, "qor1b", "ip2")).toBeNull();
  });
});
