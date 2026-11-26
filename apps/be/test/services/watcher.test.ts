import { beforeEach, describe, expect, test } from "bun:test";
import { type Db } from "../../src/db/client.ts";
import { useTestDb } from "../helpers/db.ts";
import { getWatchState, listOrders, type VaultEvent } from "../../src/db/store/index.ts";
import { type LogSource, syncVault, toVaultEvent } from "../../src/services/watcher.ts";

const V = "0x00000000000000000000000000000000000000aa";
const testDb = useTestDb();
let db: Db;
beforeEach(async () => {
  db = await testDb();
});

function fakeSource(head: number, events: VaultEvent[]) {
  const calls: [number, number][] = [];
  const src: LogSource = {
    latestBlock: async () => head,
    events: async (_v, from, to) => {
      calls.push([from, to]);
      return events.filter((e) => e.block >= from && e.block <= to);
    },
  };
  return { src, calls };
}

const placed = (id: string, block: number, logIndex = 0): VaultEvent => ({
  kind: "OrderPlaced", vault: V, orderId: id, block, logIndex, tx: `0x${id}`,
  buyer: "0x00000000000000000000000000000000000000bb", serviceId: 1, price: "5000000", requestRef: `0x${"1".repeat(64)}`, deadline: 9,
});

describe("syncVault", () => {
  test("scans from the start block in ranges and remembers where it stopped", async () => {
    const { src, calls } = fakeSource(4500, [placed("1", 1500), { kind: "Delivered", vault: V, orderId: "1", block: 3100, logIndex: 0, tx: "0xd", envelopeHash: `0x${"2".repeat(64)}`, reviewEnds: null }]);
    expect(await syncVault(db, src, V, 1000, 1, 2000)).toBe(4500);
    expect(calls).toEqual([[1000, 2999], [3000, 4500]]);
    expect(await getWatchState(db, V)).toBe(4500);
    expect((await listOrders(db, V))[0].status).toBe("delivered");
  });

  test("resumes after the saved block and applies events in log order", async () => {
    const first = fakeSource(1200, [placed("1", 1100)]);
    await syncVault(db, first.src, V, 1000, 1);
    const second = fakeSource(1300, [placed("1", 1100), { kind: "Declined", vault: V, orderId: "1", block: 1250, logIndex: 1, tx: "0xe" }, placed("2", 1250, 0)]);
    await syncVault(db, second.src, V, 1000, 1);
    expect(second.calls).toEqual([[1201, 1300]]);
    const orders = await listOrders(db, V);
    expect(orders.find((o) => o.orderId === "1")?.status).toBe("declined");
    expect(orders.find((o) => o.orderId === "2")?.status).toBe("open");
  });

  test("does nothing when already at head", async () => {
    const { src, calls } = fakeSource(1000, []);
    await syncVault(db, src, V, 1001, 1);
    expect(calls).toEqual([]);
  });
});

describe("syncVault head regression", () => {
  test("a saved block ahead of the head is left alone", async () => {
    await db.query("insert into qredit.watcher_state (vault, last_block) values ($1, 500)", [V]);
    const { src, calls } = fakeSource(100, []);
    expect(await syncVault(db, src, V, 1, 1)).toBe(500);
    expect(calls).toEqual([]);
    expect(await getWatchState(db, V)).toBe(500);
  });
});

const raw = (eventName: string, args: Record<string, unknown>) => ({ eventName, args, blockNumber: 7n, logIndex: 2, transactionHash: "0xABC" });

describe("toVaultEvent", () => {
  test("a v2 delivery carries its review end; a v1 delivery does not", () => {
    const args = { orderId: 3n, envelopeHash: `0x${"AB".repeat(32)}`, reviewEnds: 1_900_000_000n };
    expect(toVaultEvent(V, 2, raw("Delivered", args))).toEqual({
      kind: "Delivered", vault: V, orderId: "3", block: 7, logIndex: 2, tx: "0xabc", envelopeHash: `0x${"ab".repeat(32)}`, reviewEnds: 1_900_000_000,
    });
    expect(toVaultEvent(V, 1, raw("Delivered", { ...args, reviewEnds: undefined }))).toMatchObject({ kind: "Delivered", reviewEnds: null });
  });
  test("settlement, rejection, ending and rotation", () => {
    expect(toVaultEvent(V, 2, raw("Settled", { orderId: 3n }))).toMatchObject({ kind: "Settled", orderId: "3" });
    expect(toVaultEvent(V, 2, raw("Rejected", { orderId: 3n, refund: 150_000n, cost: 50_000n }))).toMatchObject({ kind: "Rejected", refund: "150000" });
    expect(toVaultEvent(V, 2, raw("LoanEnded", { kind: 1 }))).toMatchObject({ kind: "LoanEnded", ended: "defaulted" });
    expect(toVaultEvent(V, 2, raw("LoanEnded", { kind: 2 }))).toMatchObject({ kind: "LoanEnded", ended: "closed" });
    expect(toVaultEvent(V, 2, raw("LoanEnded", { kind: 0 }))).toBeNull();
    expect(toVaultEvent(V, 2, raw("AgentRotated", { spender: "0xAA", operator: "0xBB" }))).toMatchObject({ kind: "AgentRotated", spender: "0xaa", operator: "0xbb" });
    expect(toVaultEvent(V, 2, raw("Unknown", {}))).toBeNull();
  });
});

describe("syncVault per version", () => {
  test("asks the source for the vault's own version", async () => {
    const seen: number[] = [];
    const src: LogSource = { latestBlock: async () => 10, events: async (_v, _f, _t, version) => { seen.push(version); return []; } };
    await syncVault(db, src, V, 5, 2);
    expect(seen).toEqual([2]);
  });
});
