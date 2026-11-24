import { beforeEach, describe, expect, test } from "bun:test";
import { type Db, memoryDb } from "../../src/db/client.ts";
import { BroadcastRefused, BroadcastUnconfirmed, TxFailedOnChain } from "../../src/chain/tx.ts";
import { createFaucet, FaucetCapReached, FaucetCooldown, ipHasher, treasurySender } from "../../src/services/faucet.ts";
import { MIGRATIONS_DIR, runMigrations } from "../../src/db/migrate.ts";

let db: Db;
beforeEach(async () => {
  db = await memoryDb();
  await runMigrations(db, MIGRATIONS_DIR);
});

describe("faucet", () => {
  test("sends once per cooldown per address and per ip", async () => {
    const sent: string[] = [];
    const faucet = createFaucet({ db, cooldownHours: 24, dailyCap: 100, hashIp: ipHasher("salt-salt-salt-salt"), send: async (a) => { sent.push(a); return `TX${sent.length}`; } });
    expect(await faucet("qor1a", "1.1.1.1")).toEqual({ tx: "TX1" });
    await expect(faucet("qor1a", "2.2.2.2")).rejects.toBeInstanceOf(FaucetCooldown);
    await expect(faucet("qor1b", "1.1.1.1")).rejects.toBeInstanceOf(FaucetCooldown);
    expect(await faucet("qor1c", "3.3.3.3")).toEqual({ tx: "TX2" });
    expect(sent).toEqual(["qor1a", "qor1c"]);
  });

  test("allows again after the cooldown", async () => {
    let now = new Date("2030-01-01T00:00:00Z");
    const faucet = createFaucet({ db, cooldownHours: 1, dailyCap: 100, hashIp: ipHasher("salt-salt-salt-salt"), send: async () => "TX", now: () => now });
    await faucet("qor1a", "1.1.1.1");
    await db.query("update qredit.faucet_grants set created_at = $1", [new Date("2030-01-01T00:00:00Z")]);
    now = new Date("2030-01-01T01:00:01Z");
    expect(await faucet("qor1a", "1.1.1.1")).toEqual({ tx: "TX" });
  });

  test("a pending reservation older than 10 minutes no longer blocks", async () => {
    let now = new Date("2030-01-01T00:00:00Z");
    const faucet = createFaucet({ db, cooldownHours: 24, dailyCap: 100, hashIp: ipHasher("salt-salt-salt-salt"), send: async () => "TX", now: () => now });
    await db.query("insert into qredit.faucet_grants (address, ip_hash, tx, created_at) values ('qor1a', 'x', 'pending', $1)", [now.toISOString()]);
    now = new Date("2030-01-01T00:05:00Z");
    await expect(faucet("qor1a", "1.1.1.1")).rejects.toBeInstanceOf(FaucetCooldown);
    now = new Date("2030-01-01T00:10:01Z");
    expect(await faucet("qor1a", "1.1.1.1")).toEqual({ tx: "TX" });
  });

  const grants = () => db.query<{ tx: string }>("select tx from qredit.faucet_grants");
  const mk = (send: (a: string) => Promise<string>, dailyCap = 100) =>
    createFaucet({ db, cooldownHours: 24, dailyCap, hashIp: ipHasher("salt-salt-salt-salt"), send });

  test("a refused broadcast releases the reservation", async () => {
    let fail = true;
    const faucet = mk(async () => { if (fail) throw new BroadcastRefused("code 5"); return "TX"; });
    await expect(faucet("qor1a", "1.1.1.1")).rejects.toBeInstanceOf(BroadcastRefused);
    expect(await grants()).toEqual([]);
    fail = false;
    expect(await faucet("qor1a", "1.1.1.1")).toEqual({ tx: "TX" });
  });

  test("a failure after the hash exists records the hash and never cancels", async () => {
    const faucet = mk(async () => { throw new BroadcastUnconfirmed("HASH1", "timed out"); });
    await expect(faucet("qor1a", "1.1.1.1")).rejects.toBeInstanceOf(BroadcastUnconfirmed);
    expect(await grants()).toEqual([{ tx: "HASH1" }]);
    await expect(faucet("qor1a", "2.2.2.2")).rejects.toBeInstanceOf(FaucetCooldown);
  });

  test("an unknown failure leaves the reservation pending", async () => {
    const faucet = mk(async () => { throw new Error("socket hang up"); });
    await expect(faucet("qor1a", "1.1.1.1")).rejects.toThrow("socket hang up");
    expect(await grants()).toEqual([{ tx: "pending" }]);
  });

  test("if cancelling fails, the original error is rethrown", async () => {
    const faucet = mk(async () => { throw new BroadcastRefused("code 5"); });
    const real = db.query.bind(db);
    db.query = (async (sql: string, params?: unknown[]) => {
      if (sql.startsWith("delete from qredit.faucet_grants")) throw new Error("db down");
      return real(sql, params as never);
    }) as Db["query"];
    const log = console.error;
    console.error = () => {};
    try {
      await expect(faucet("qor1a", "1.1.1.1")).rejects.toThrow("code 5");
    } finally {
      console.error = log;
    }
  });

  test("a bookkeeping failure after a successful send still returns the tx", async () => {
    const faucet = mk(async () => "TX");
    const real = db.query.bind(db);
    db.query = (async (sql: string, params?: unknown[]) => {
      if (sql.startsWith("update qredit.faucet_grants")) throw new Error("db down");
      return real(sql, params as never);
    }) as Db["query"];
    const log = console.error;
    console.error = () => {};
    try {
      expect(await faucet("qor1a", "1.1.1.1")).toEqual({ tx: "TX" });
    } finally {
      console.error = log;
    }
    expect(await grants()).toEqual([{ tx: "pending" }]);
  });

  test("the global daily cap stops grants across addresses", async () => {
    const faucet = mk(async () => "TX", 2);
    await faucet("qor1a", "1.1.1.1");
    await faucet("qor1b", "2.2.2.2");
    await expect(faucet("qor1c", "3.3.3.3")).rejects.toBeInstanceOf(FaucetCapReached);
  });

  describe("treasurySender", () => {
    const acc = { cosmos: "qor1treasury" } as never;
    const net = { chainId: "c", rest: "r", rpc: "p" };
    const sender = (broadcast: (...a: never[]) => Promise<{ hash: string; code: number; rawLog?: string }>, events: () => Promise<never[]>) =>
      treasurySender(net, acc, 1n, 2n, { broadcast: broadcast as never, events: events as never });
    test("CheckTx refusal is BroadcastRefused", async () => {
      await expect(sender(async () => ({ hash: "H", code: 5, rawLog: "no funds" }), async () => []) ("qor1x")).rejects.toBeInstanceOf(BroadcastRefused);
    });
    test("a pre-hash failure propagates as BroadcastRefused", async () => {
      await expect(sender(async () => { throw new BroadcastRefused("connect"); }, async () => [])("qor1x")).rejects.toBeInstanceOf(BroadcastRefused);
    });
    test("an events timeout carries the hash", async () => {
      const err = await sender(async () => ({ hash: "H1", code: 0 }), async () => { throw new Error("not found after 20 tries"); })("qor1x").catch((e) => e);
      expect(err).toBeInstanceOf(BroadcastUnconfirmed);
      expect(err.hash).toBe("H1");
    });
    test("a tx that failed on chain moved no coins", async () => {
      await expect(sender(async () => ({ hash: "H1", code: 0 }), async () => { throw new TxFailedOnChain("H1", "code 7"); })("qor1x")).rejects.toBeInstanceOf(BroadcastRefused);
    });
    test("success returns the hash", async () => {
      expect(await sender(async () => ({ hash: "H1", code: 0 }), async () => [])("qor1x")).toBe("H1");
    });
  });

  test("ip hashes are salted and stable", () => {
    const h = ipHasher("salt-salt-salt-salt");
    expect(h("1.1.1.1")).toBe(h("1.1.1.1"));
    expect(h("1.1.1.1")).not.toBe(ipHasher("other-salt-other")("1.1.1.1"));
    expect(h("1.1.1.1")).not.toContain("1.1.1.1");
  });
});
