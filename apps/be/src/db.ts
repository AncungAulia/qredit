import postgres from "postgres";

export type Queryable = {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
};

/** A Queryable that can also run multi-statement SQL text (no parameters), e.g. migration files. */
export type Tx = Queryable & { exec(text: string): Promise<void> };

export interface Db extends Tx {
  /** Run fn in one transaction: commit when it resolves, roll back when it throws. */
  transaction<T>(fn: (q: Tx) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

/** Supabase Postgres through the session pooler; prepared statements off for pooling. */
export function pgDb(url: string): Db {
  // onnotice: Postgres NOTICEs (e.g. "already exists, skipping") are not errors; keep logs clean.
  const sql = postgres(url, { max: 5, prepare: false, ssl: "require", idle_timeout: 30, connect_timeout: 15, onnotice: () => {} });
  const queryable = (s: postgres.Sql | postgres.TransactionSql): Tx => ({
    // Return a plain array, without postgres.js result metadata.
    query: async <T>(text: string, params: unknown[] = []) => Array.from(await s.unsafe(text, params as never[])) as T[],
    exec: async (text: string) => {
      await s.unsafe(text);
    },
  });
  return {
    ...queryable(sql),
    transaction: <T>(fn: (q: Tx) => Promise<T>) => sql.begin((t) => fn(queryable(t))) as Promise<T>,
    close: () => sql.end(),
  };
}

/** In-process Postgres (PGlite) for tests. */
export async function memoryDb(): Promise<Db> {
  const { PGlite } = await import("@electric-sql/pglite");
  const pg = new PGlite();
  const queryable = (c: { query(text: string, params?: unknown[]): Promise<{ rows: unknown[] }>; exec(text: string): Promise<unknown> }): Tx => ({
    query: async <T>(text: string, params: unknown[] = []) => (await c.query(text, params)).rows as T[],
    exec: async (text: string) => {
      await c.exec(text);
    },
  });
  return {
    ...queryable(pg),
    transaction: <T>(fn: (q: Tx) => Promise<T>) => pg.transaction((t) => fn(queryable(t))),
    close: () => pg.close(),
  };
}
