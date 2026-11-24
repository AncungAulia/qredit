import { beforeEach, describe, expect, test } from "bun:test";
import { type Db, memoryDb } from "../src/db.ts";
import { MIGRATIONS_DIR, runMigrations } from "../src/migrate.ts";
import { cancelGrant, completeGrant, getWatchState, reserveGrant, setWatchState } from "../src/db/store/index.ts";

let db: Db;
beforeEach(async () => {
  db = await memoryDb();
  await runMigrations(db, MIGRATIONS_DIR);
});
const NOW = new Date("2030-01-01T00:00:00Z");

describe("transaction", () => {
  test("commits on success and rolls back on error", async () => {
    await db.transaction((q) => setWatchState(q, "0xa", 5));
    await expect(db.transaction(async (q) => { await setWatchState(q, "0xa", 9); throw new Error("boom"); })).rejects.toThrow("boom");
    expect(await getWatchState(db, "0xa")).toBe(5);
  });
});

describe("faucet reservation", () => {
  test("only one reservation per address or ip inside the cooldown", async () => {
    const a = await db.transaction((q) => reserveGrant(q, "qor1a", "ip1", 24, NOW));
    expect(a.ok).toBe(true);
    const b = await db.transaction((q) => reserveGrant(q, "qor1a", "ip2", 24, NOW));
    const c = await db.transaction((q) => reserveGrant(q, "qor1b", "ip1", 24, NOW));
    expect(b.ok || c.ok).toBe(false);
    if (!b.ok && b.reason === "cooldown") expect(b.retryAt.getTime()).toBeGreaterThan(NOW.getTime());
  });

  test("a global rolling 24 h cap counts every grant, frees on cancel and ages out", async () => {
    const a = await db.transaction((q) => reserveGrant(q, "qor1a", "ip1", 24, NOW, 2));
    await db.transaction((q) => reserveGrant(q, "qor1b", "ip2", 24, NOW, 2));
    expect(await db.transaction((q) => reserveGrant(q, "qor1c", "ip3", 24, NOW, 2))).toEqual({ ok: false, reason: "cap" });
    if (!a.ok) throw new Error("expected ok");
    await cancelGrant(db, a.id);
    expect((await db.transaction((q) => reserveGrant(q, "qor1c", "ip3", 24, NOW, 2))).ok).toBe(true);
    const later = new Date(NOW.getTime() + 24 * 3_600_000 + 1000);
    expect((await db.transaction((q) => reserveGrant(q, "qor1d", "ip4", 24, later, 2))).ok).toBe(true);
  });

  test("concurrent reservations for the same address grant exactly one", async () => {
    const results = await Promise.all(
      [1, 2, 3].map(() => db.transaction((q) => reserveGrant(q, "qor1a", "ip1", 24, NOW))),
    );
    expect(results.filter((r) => r.ok).length).toBe(1);
  });

  test("a cancelled reservation frees the slot; a completed one records the tx", async () => {
    const a = await db.transaction((q) => reserveGrant(q, "qor1a", "ip1", 24, NOW));
    if (!a.ok) throw new Error("expected ok");
    await cancelGrant(db, a.id);
    const b = await db.transaction((q) => reserveGrant(q, "qor1a", "ip1", 24, NOW));
    if (!b.ok) throw new Error("expected ok after cancel");
    await completeGrant(db, b.id, "0xtx");
    const [row] = await db.query<{ tx: string }>("select tx from qredit.faucet_grants where id = $1", [b.id]);
    expect(row.tx).toBe("0xtx");
  });
});
