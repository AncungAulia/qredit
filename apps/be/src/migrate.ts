import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { type Db, pgDb } from "./db.ts";

export const MIGRATIONS_DIR = join(import.meta.dir, "..", "migrations");

export async function runMigrations(db: Db, dir: string): Promise<string[]> {
  await db.exec(
    "create schema if not exists qredit; create table if not exists qredit.schema_migrations (name text primary key, applied_at timestamptz not null default now());",
  );
  const files = readdirSync(dir).filter((f) => /^[0-9]{3}_[a-z0-9_]+\.sql$/.test(f)).sort();
  const applied = new Set((await db.query<{ name: string }>("select name from qredit.schema_migrations")).map((r) => r.name));
  const ran: string[] = [];
  for (const file of files) {
    if (applied.has(file)) continue;
    const body = readFileSync(join(dir, file), "utf8");
    await db.exec(`begin;\n${body}\ninsert into qredit.schema_migrations (name) values ('${file}');\ncommit;`);
    ran.push(file);
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
