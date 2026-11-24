import { afterAll, beforeAll } from "bun:test";
import { type Db, memoryDb } from "../../src/db/client.ts";
import { MIGRATIONS_DIR, runMigrations } from "../../src/db/migrate.ts";

const DATA_TABLES = ["businesses", "orders", "envelopes", "cards", "decisions", "watcher_state", "faucet_grants"];

/**
 * One migrated in-process Postgres per test file. Call at the top of the file, then call the returned
 * function in beforeEach to get the shared db with every table emptied (ids restart).
 */
export function useTestDb(): () => Promise<Db> {
  let db: Db;
  beforeAll(async () => {
    db = await memoryDb();
    await runMigrations(db, MIGRATIONS_DIR);
  });
  afterAll(async () => {
    await db.close();
  });
  return async () => {
    await db.exec(`truncate ${DATA_TABLES.map((t) => `qredit.${t}`).join(", ")} restart identity cascade`);
    return db;
  };
}
