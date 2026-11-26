import { describe, expect, test } from "bun:test";
import { memoryDb } from "../../src/db/client.ts";
import { MIGRATIONS_DIR, runMigrations } from "../../src/db/migrate.ts";

describe("runMigrations", () => {
  test("creates the qredit schema once", async () => {
    const db = await memoryDb();
    expect((await runMigrations(db, MIGRATIONS_DIR))[0]).toBe("001_init.sql");
    expect(await runMigrations(db, MIGRATIONS_DIR)).toEqual([]);
    const tables = await db.query<{ table_name: string }>(
      "select table_name from information_schema.tables where table_schema = 'qredit' order by table_name",
    );
    expect(tables.map((t) => t.table_name)).toEqual([
      "businesses", "cards", "decisions", "envelopes", "faucet_grants", "orders", "schema_migrations", "watcher_state",
    ]);
    await db.close();
  });

  test("concurrent runs apply each file once and both resolve", async () => {
    const db = await memoryDb();
    const [a, b] = await Promise.all([runMigrations(db, MIGRATIONS_DIR), runMigrations(db, MIGRATIONS_DIR)]);
    expect([...a, ...b].filter((f) => f === "001_init.sql").length).toBe(1);
    const rows = await db.query("select name from qredit.schema_migrations where name = '001_init.sql'");
    expect(rows.length).toBe(1);
    await db.close();
  });

  test("order and decision checks reject malformed values", async () => {
    const db = await memoryDb();
    await runMigrations(db, MIGRATIONS_DIR);
    const ins = (vault: string, orderId: string, price: string) =>
      db.query(
        "insert into qredit.orders (vault, order_id, buyer, service_id, price, request_ref, deadline, status, placed_tx, placed_block) values ($1, $2, $3, 0, $4, $5, 1, 'open', '0x', 1)",
        [vault, orderId, `0x${"b".repeat(40)}`, price, `0x${"1".repeat(64)}`],
      );
    await ins(`0x${"a".repeat(40)}`, "1", "5");
    await expect(ins(`0x${"A".repeat(40)}`, "2", "5")).rejects.toThrow();
    await expect(ins(`0x${"a".repeat(40)}`, "x", "5")).rejects.toThrow();
    await expect(ins(`0x${"a".repeat(40)}`, "3", "-1")).rejects.toThrow();
    await expect(
      db.query("insert into qredit.decisions (vault, decision, reason, cost) values ('v', 'accepted', 'r', 'abc')"),
    ).rejects.toThrow();
    await db.close();
  });

  test("every table has row level security enabled", async () => {
    const db = await memoryDb();
    await runMigrations(db, MIGRATIONS_DIR);
    const rows = await db.query<{ relname: string; relrowsecurity: boolean }>(
      "select c.relname, c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'qredit' and c.relkind = 'r'",
    );
    expect(rows.length).toBe(8);
    expect(rows.every((r) => r.relrowsecurity)).toBe(true);
    await db.close();
  });

  test("003 accepts the v2 statuses and versions and refuses others", async () => {
    const db = await memoryDb();
    await runMigrations(db, MIGRATIONS_DIR);
    const order = (id: string, status: string) =>
      db.query(
        "insert into qredit.orders (vault, order_id, buyer, service_id, price, request_ref, deadline, status, placed_tx, placed_block) values ($1, $2, $3, 0, '5', $4, 1, $5, '0x', 1)",
        [`0x${"a".repeat(40)}`, id, `0x${"b".repeat(40)}`, `0x${"1".repeat(64)}`, status],
      );
    for (const [i, s] of ["in_review", "settled", "rejected", "delivered"].entries()) await order(String(i + 1), s);
    await expect(order("9", "bogus")).rejects.toThrow();
    const business = (vault: string, version: number) =>
      db.query(
        "insert into qredit.businesses (slug, vault, name, tagline, services, operator, spender, start_block, version) values ('sl', $1, 'n', 't', '[]', $1, $1, 1, $2)",
        [vault, version],
      );
    await business(`0x${"1".repeat(40)}`, 1);
    await business(`0x${"2".repeat(40)}`, 2);
    await expect(business(`0x${"3".repeat(40)}`, 3)).rejects.toThrow();
    await expect(business(`0x${"4".repeat(40)}`, 2)).rejects.toThrow(); // one v2 vault per slug
    await db.close();
  });
});
