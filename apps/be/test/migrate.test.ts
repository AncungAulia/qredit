import { describe, expect, test } from "bun:test";
import { memoryDb } from "../src/db.ts";
import { MIGRATIONS_DIR, runMigrations } from "../src/migrate.ts";

describe("runMigrations", () => {
  test("creates the qredit schema once", async () => {
    const db = await memoryDb();
    expect(await runMigrations(db, MIGRATIONS_DIR)).toEqual(["001_init.sql"]);
    expect(await runMigrations(db, MIGRATIONS_DIR)).toEqual([]);
    const tables = await db.query<{ table_name: string }>(
      "select table_name from information_schema.tables where table_schema = 'qredit' order by table_name",
    );
    expect(tables.map((t) => t.table_name)).toEqual([
      "businesses", "cards", "decisions", "envelopes", "faucet_grants", "orders", "schema_migrations", "watcher_state",
    ]);
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
});
