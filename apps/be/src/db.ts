import postgres from "postgres";

export interface Db {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
  exec(text: string): Promise<void>;
  close(): Promise<void>;
}

/** Supabase Postgres through the session pooler; prepared statements off for pooling. */
export function pgDb(url: string): Db {
  const sql = postgres(url, { max: 5, prepare: false, idle_timeout: 30, connect_timeout: 15 });
  return {
    query: async <T>(text: string, params: unknown[] = []) =>
      (await sql.unsafe(text, params as never[])) as unknown as T[],
    exec: async (text: string) => {
      await sql.unsafe(text);
    },
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
    close: () => pg.close(),
  };
}
