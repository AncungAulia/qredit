import type { Queryable } from "../client.ts";
import { lc } from "./lc.ts";

export async function putCard(db: Queryable, address: string, card: unknown): Promise<void> {
  await db.query(
    "insert into qredit.cards (address, card) values ($1, $2::jsonb) on conflict (address) do update set card = excluded.card, updated_at = now()",
    [lc(address), JSON.stringify(card)],
  );
}

export async function getCard(db: Queryable, address: string): Promise<unknown | null> {
  const [r] = await db.query<{ card: unknown }>("select card from qredit.cards where address = $1", [lc(address)]);
  return r?.card ?? null;
}
