import postgres from "postgres";

export type Queryable = {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
};

export interface Db extends Queryable {
  exec(text: string): Promise<void>;
  /** Run fn in one transaction: commit when it resolves, roll back when it throws. */
  transaction<T>(fn: (q: Queryable) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

/** Supabase Postgres through the session pooler; prepared statements off for pooling. */
export function pgDb(url: string): Db {
  // onnotice: Postgres NOTICEs (e.g. "already exists, skipping") are not errors; keep logs clean.
  const sql = postgres(url, { max: 5, prepare: false, idle_timeout: 30, connect_timeout: 15, onnotice: () => {} });
  const queryable = (s: postgres.Sql | postgres.TransactionSql): Queryable => ({
    // Return a plain array, without postgres.js result metadata.
    query: async <T>(text: string, params: unknown[] = []) => Array.from(await s.unsafe(text, params as never[])) as T[],
  });
  return {
    ...queryable(sql),
    exec: async (text: string) => {
      await sql.unsafe(text);
    },
    transaction: <T>(fn: (q: Queryable) => Promise<T>) => sql.begin((t) => fn(queryable(t))) as Promise<T>,
    close: () => sql.end(),
  };
}

/** In-process Postgres (PGlite) for tests. */
export async function memoryDb(): Promise<Db> {
  const { PGlite } = await import("@electric-sql/pglite");
  const pg = new PGlite();
  return {
    query: async <T>(text: string, params: unknown[] = []) => (await pg.query(text, params)).rows as T[],
    exec: async (text: string) => {
      await pg.exec(text);
    },
    transaction: <T>(fn: (q: Queryable) => Promise<T>) =>
      pg.transaction((t) => fn({ query: async <R>(text: string, params: unknown[] = []) => (await t.query(text, params)).rows as R[] })),
    close: () => pg.close(),
  };
}
