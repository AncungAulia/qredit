import type { Queryable } from "../../db.ts";
import { lc } from "./lc.ts";

/** A reservation still 'pending' after this long is a crashed send and no longer counts toward the cooldown. */
export const PENDING_GRANT_TTL_MS = 10 * 60_000;

export async function lastGrant(db: Queryable, address: string, ipHash: string, pendingSince = new Date(0)): Promise<Date | null> {
  const [r] = await db.query<{ at: Date | null }>(
    "select max(created_at) as at from qredit.faucet_grants where (address = $1 or ip_hash = $2) and (tx <> 'pending' or created_at > $3)",
    [lc(address), ipHash, pendingSince.toISOString()],
  );
  return r?.at ? new Date(r.at) : null;
}

/** Reserve a faucet slot atomically. Call inside db.transaction. */
export async function reserveGrant(
  q: Queryable,
  address: string,
  ipHash: string,
  cooldownHours: number,
  now: Date,
  dailyCap = Number.POSITIVE_INFINITY,
): Promise<{ ok: true; id: number } | { ok: false; reason: "cooldown"; retryAt: Date } | { ok: false; reason: "cap" }> {
  await q.query("select pg_advisory_xact_lock(hashtext('qredit.faucet'))");
  const last = await lastGrant(q, address, ipHash, new Date(now.getTime() - PENDING_GRANT_TTL_MS));
  if (last) {
    const retryAt = new Date(last.getTime() + cooldownHours * 3_600_000);
    if (retryAt > now) return { ok: false, reason: "cooldown", retryAt };
  }
  // Rows are deleted when cancelled, so every row in the last 24 h is a grant (or a send that may have gone out).
  const [n] = await q.query<{ n: string | number }>(
    "select count(*) as n from qredit.faucet_grants where created_at > $1",
    [new Date(now.getTime() - 24 * 3_600_000).toISOString()],
  );
  if (Number(n?.n ?? 0) >= dailyCap) return { ok: false, reason: "cap" };
  const [r] = await q.query<{ id: string | number }>(
    "insert into qredit.faucet_grants (address, ip_hash, tx, created_at) values ($1, $2, 'pending', $3) returning id",
    [lc(address), ipHash, now.toISOString()],
  );
  return { ok: true, id: Number(r.id) };
}

export async function completeGrant(q: Queryable, id: number, tx: string): Promise<void> {
  await q.query("update qredit.faucet_grants set tx = $2 where id = $1", [id, tx]);
}

export async function cancelGrant(q: Queryable, id: number): Promise<void> {
  await q.query("delete from qredit.faucet_grants where id = $1", [id]);
}
