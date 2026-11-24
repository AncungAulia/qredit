import type { Queryable } from "../client.ts";
import { lc } from "./lc.ts";

export async function getWatchState(db: Queryable, vault: string): Promise<number | null> {
  const [r] = await db.query<{ last_block: string | number }>("select last_block from qredit.watcher_state where vault = $1", [lc(vault)]);
  return r ? Number(r.last_block) : null;
}

export async function setWatchState(db: Queryable, vault: string, block: number): Promise<void> {
  await db.query(
    "insert into qredit.watcher_state (vault, last_block) values ($1, $2) on conflict (vault) do update set last_block = greatest(qredit.watcher_state.last_block, excluded.last_block)",
    [lc(vault), block],
  );
}
