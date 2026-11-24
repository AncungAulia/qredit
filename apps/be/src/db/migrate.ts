import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { type Db, pgDb } from "./client.ts";

export const MIGRATIONS_DIR = join(import.meta.dir, "..", "..", "migrations");

export async function runMigrations(db: Db, dir: string): Promise<string[]> {
  const files = readdirSync(dir).filter((f) => /^[0-9]{3}_[a-z0-9_]+\.sql$/.test(f)).sort();
  const ran: string[] = [];
  // One transaction per run: the advisory lock comes first, so bootstrap DDL, the applied list and the
  // pending files are all serialised across concurrent boots. A failing file rolls the whole run back.
  await db.transaction(async (tx) => {
    await tx.query("select pg_advisory_xact_lock(hashtext('qredit.migrate'))");
    await tx.exec(
      "create schema if not exists qredit; create table if not exists qredit.schema_migrations (name text primary key, applied_at timestamptz not null default now());",
    );
    const applied = new Set((await tx.query<{ name: string }>("select name from qredit.schema_migrations")).map((r) => r.name));
    for (const file of files.filter((f) => !applied.has(f))) {
      await tx.exec(readFileSync(join(dir, file), "utf8"));
      await tx.query("insert into qredit.schema_migrations (name) values ($1)", [file]);
      ran.push(file);
    }
  });
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
