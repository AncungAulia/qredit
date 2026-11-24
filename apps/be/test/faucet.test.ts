import { beforeEach, describe, expect, test } from "bun:test";
import { type Db, memoryDb } from "../src/db.ts";
import { createFaucet, FaucetCooldown, ipHasher } from "../src/faucet.ts";
import { MIGRATIONS_DIR, runMigrations } from "../src/migrate.ts";

let db: Db;
beforeEach(async () => {
  db = await memoryDb();
  await runMigrations(db, MIGRATIONS_DIR);
});

describe("faucet", () => {
  test("sends once per cooldown per address and per ip", async () => {
    const sent: string[] = [];
    const faucet = createFaucet({ db, cooldownHours: 24, hashIp: ipHasher("salt-salt-salt-salt"), send: async (a) => { sent.push(a); return `TX${sent.length}`; } });
    expect(await faucet("qor1a", "1.1.1.1")).toEqual({ tx: "TX1" });
    await expect(faucet("qor1a", "2.2.2.2")).rejects.toBeInstanceOf(FaucetCooldown);
    await expect(faucet("qor1b", "1.1.1.1")).rejects.toBeInstanceOf(FaucetCooldown);
    expect(await faucet("qor1c", "3.3.3.3")).toEqual({ tx: "TX2" });
    expect(sent).toEqual(["qor1a", "qor1c"]);
  });

  test("allows again after the cooldown", async () => {
    let now = new Date("2030-01-01T00:00:00Z");
    const faucet = createFaucet({ db, cooldownHours: 1, hashIp: ipHasher("salt-salt-salt-salt"), send: async () => "TX", now: () => now });
    await faucet("qor1a", "1.1.1.1");
    await db.query("update qredit.faucet_grants set created_at = $1", [new Date("2030-01-01T00:00:00Z")]);
    now = new Date("2030-01-01T01:00:01Z");
    expect(await faucet("qor1a", "1.1.1.1")).toEqual({ tx: "TX" });
  });

  test("a pending reservation older than 10 minutes no longer blocks", async () => {
    let now = new Date("2030-01-01T00:00:00Z");
    const faucet = createFaucet({ db, cooldownHours: 24, hashIp: ipHasher("salt-salt-salt-salt"), send: async () => "TX", now: () => now });
    await db.query("insert into qredit.faucet_grants (address, ip_hash, tx, created_at) values ('qor1a', 'x', 'pending', $1)", [now.toISOString()]);
    now = new Date("2030-01-01T00:05:00Z");
    await expect(faucet("qor1a", "1.1.1.1")).rejects.toBeInstanceOf(FaucetCooldown);
    now = new Date("2030-01-01T00:10:01Z");
    expect(await faucet("qor1a", "1.1.1.1")).toEqual({ tx: "TX" });
  });

  test("a failed send releases the reservation", async () => {
    let fail = true;
    const faucet = createFaucet({ db, cooldownHours: 24, hashIp: ipHasher("salt-salt-salt-salt"), send: async () => { if (fail) throw new Error("rpc down"); return "TX"; } });
    await expect(faucet("qor1a", "1.1.1.1")).rejects.toThrow("rpc down");
    fail = false;
    expect(await faucet("qor1a", "1.1.1.1")).toEqual({ tx: "TX" });
  });

  test("ip hashes are salted and stable", () => {
    const h = ipHasher("salt-salt-salt-salt");
    expect(h("1.1.1.1")).toBe(h("1.1.1.1"));
    expect(h("1.1.1.1")).not.toBe(ipHasher("other-salt-other")("1.1.1.1"));
    expect(h("1.1.1.1")).not.toContain("1.1.1.1");
  });
});
