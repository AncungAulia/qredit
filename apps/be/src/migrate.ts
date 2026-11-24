import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { type Db, pgDb } from "./db.ts";

export const MIGRATIONS_DIR = join(import.meta.dir, "..", "migrations");

export async function runMigrations(db: Db, dir: string): Promise<string[]> {
  await db.exec(
    "create schema if not exists qredit; create table if not exists qredit.schema_migrations (name text primary key, applied_at timestamptz not null default now());",
  );
  const files = readdirSync(dir).filter((f) => /^[0-9]{3}_[a-z0-9_]+\.sql$/.test(f)).sort();
  const ran: string[] = [];
  for (const file of files) {
    const body = readFileSync(join(dir, file), "utf8");
    // One transaction per file. The advisory lock serialises concurrent boots; the applied
    // list is re-read under the lock so only the first instance runs the file.
    await db.transaction(async (tx) => {
      await tx.query("select pg_advisory_xact_lock(hashtext('qredit.migrate'))");
      const done = await tx.query("select 1 from qredit.schema_migrations where name = $1", [file]);
      if (done.length > 0) return;
      await tx.exec(body);
      await tx.query("insert into qredit.schema_migrations (name) values ($1)", [file]);
      ran.push(file);
    });
  }
  return ran;
}

if (import.meta.main) {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const db = pgDb(url);
  try {
    console.log("applied:", await runMigrations(db, MIGRATIONS_DIR));
  } finally {
    await db.close();
  }
}
