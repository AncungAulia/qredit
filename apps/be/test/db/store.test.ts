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
    await store.applyVaultEvent(db, { kind: "Delivered", vault: V, orderId: "1", block: 101, logIndex: 0, tx: "0xd", envelopeHash: `0x${"ab".repeat(32)}`, reviewEnds: null });
    const [o] = await store.listOrders(db, V);
    expect(o.status).toBe("delivered");
    expect(o.envelopeHash).toBe(`0x${"ab".repeat(32)}`);
  });

  test("a closed order is not reopened and an unknown order returns false", async () => {
    await store.applyVaultEvent(db, placed("1", 100));
    const hash = `0x${"ab".repeat(32)}`;
    expect(await store.applyVaultEvent(db, { kind: "Delivered", vault: V, orderId: "1", block: 101, logIndex: 0, tx: "0xd", envelopeHash: hash, reviewEnds: null })).toBe(true);
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

const V2 = "0x00000000000000000000000000000000000000a2";
const biz = (vault: string, version?: 1 | 2) => ({
  slug: "counterparty", vault, name: "Counterparty Check", tagline: "t", services: [{ id: 0 }], operator: V, spender: V, startBlock: 10,
  ...(version ? { version } : {}),
});
const delivered = (orderId: string, reviewEnds: number | null) => ({
  kind: "Delivered" as const, vault: V, orderId, block: 20, logIndex: 0, tx: "0xd", envelopeHash: `0x${"2".repeat(64)}`, reviewEnds,
});

describe("vault v2 businesses", () => {
  test("a slug keeps its v1 vault and gains a v2 vault; the page reads the newest", async () => {
    await store.upsertBusiness(db, biz(V));
    await store.upsertBusiness(db, biz(V2, 2));
    const all = await store.listBusinesses(db);
    expect(all.map((b) => [b.vault, b.version])).toEqual([[V, 1], [V2, 2]]);
    expect((await store.getBusiness(db, "counterparty"))?.vault).toBe(V2);
    await expect(store.upsertBusiness(db, biz("0x00000000000000000000000000000000000000a3", 2))).rejects.toThrow();
  });

  test("LoanEnded marks the business once; AgentRotated moves the agent keys", async () => {
    await store.upsertBusiness(db, biz(V2, 2));
    expect(await store.applyVaultEvent(db, { kind: "LoanEnded", vault: V2, block: 30, logIndex: 0, tx: "0xe", ended: "defaulted" })).toBe(true);
    expect(await store.applyVaultEvent(db, { kind: "LoanEnded", vault: V2, block: 31, logIndex: 0, tx: "0xf", ended: "closed" })).toBe(false);
    expect((await store.getBusiness(db, "counterparty"))?.ended).toBe("defaulted");
    const S = "0x00000000000000000000000000000000000000c1";
    const O = "0x00000000000000000000000000000000000000c2";
    expect(await store.applyVaultEvent(db, { kind: "AgentRotated", vault: V2, block: 32, logIndex: 0, tx: "0x1", spender: S, operator: O })).toBe(true);
    const b = await store.getBusiness(db, "counterparty");
    expect([b?.spender, b?.operator]).toEqual([S, O]);
  });
});

describe("vault v2 orders", () => {
  test("a v2 delivery opens the review; the review ends in a settlement", async () => {
    await store.applyVaultEvent(db, placed("1", 10));
    expect(await store.applyVaultEvent(db, delivered("1", 1_900_000_000))).toBe(true);
    let [o] = await store.listOrders(db, V);
    expect([o!.status, o!.reviewEnds]).toEqual(["in_review", 1_900_000_000]);
    expect(await store.claimNextOrder(db, [V])).toBeNull();
    expect(await store.applyVaultEvent(db, { kind: "Settled", vault: V, orderId: "1", block: 21, logIndex: 0, tx: "0xs" })).toBe(true);
    expect(await store.applyVaultEvent(db, { kind: "Settled", vault: V, orderId: "1", block: 22, logIndex: 0, tx: "0xs" })).toBe(false);
    [o] = await store.listOrders(db, V);
    expect(o!.status).toBe("settled");
  });

  test("a rejection records the refund and cannot be settled", async () => {
    await store.applyVaultEvent(db, placed("1", 10));
    await store.applyVaultEvent(db, delivered("1", 1_900_000_000));
    expect(await store.applyVaultEvent(db, { kind: "Rejected", vault: V, orderId: "1", block: 21, logIndex: 0, tx: "0xr", refund: "150000" })).toBe(true);
    expect(await store.applyVaultEvent(db, { kind: "Settled", vault: V, orderId: "1", block: 22, logIndex: 0, tx: "0xs" })).toBe(false);
    const [o] = await store.listOrders(db, V);
    expect([o!.status, o!.refund]).toEqual(["rejected", "150000"]);
  });

  test("a v1 delivery stays final", async () => {
    await store.applyVaultEvent(db, placed("1", 10));
    await store.applyVaultEvent(db, delivered("1", null));
    expect(await store.applyVaultEvent(db, { kind: "Settled", vault: V, orderId: "1", block: 21, logIndex: 0, tx: "0xs" })).toBe(false);
    const [o] = await store.listOrders(db, V);
    expect([o!.status, o!.reviewEnds]).toEqual(["delivered", null]);
  });

  test("orderStats counts deliveries, rejections and unique buyers per vault", async () => {
    await store.applyVaultEvent(db, placed("1", 10));
    await store.applyVaultEvent(db, placed("2", 11));
    await store.applyVaultEvent(db, { ...placed("3", 12), buyer: "0x00000000000000000000000000000000000000cc" });
    await store.applyVaultEvent(db, delivered("1", 1_900_000_000));
    await store.applyVaultEvent(db, delivered("2", 1_900_000_000));
    await store.applyVaultEvent(db, { kind: "Rejected", vault: V, orderId: "2", block: 21, logIndex: 0, tx: "0xr", refund: "0" });
    expect((await store.orderStats(db)).get(V)).toEqual({ delivered: 2, rejected: 1, uniqueBuyers: 2 });
    expect((await store.orderStats(db, V2)).get(V)).toBeUndefined();
  });
});
