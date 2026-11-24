import type { Queryable } from "../client.ts";
import { lc } from "./lc.ts";

export interface Order {
  vault: string;
  orderId: string;
  buyer: string;
  serviceId: number;
  price: string;
  requestRef: string;
  deadline: number;
  status: "open" | "claimed" | "delivered" | "declined" | "reclaimed";
  placedTx: string;
  placedBlock: number;
  envelopeHash: string | null;
}


type Base = { vault: string; orderId: string; block: number; logIndex: number; tx: string };
export type VaultEvent =
  | (Base & { kind: "OrderPlaced"; buyer: string; serviceId: number; price: string; requestRef: string; deadline: number })
  | (Base & { kind: "Delivered"; envelopeHash: string })
  | (Base & { kind: "Declined" | "Reclaimed" });

/** Apply one vault event idempotently. Returns true when a row was inserted or updated, false when the event was a duplicate or did not fit the order's state. */
export async function applyVaultEvent(db: Queryable, e: VaultEvent): Promise<boolean> {
  if (e.kind === "OrderPlaced") {
    const rows = await db.query(
      `insert into qredit.orders (vault, order_id, buyer, service_id, price, request_ref, deadline, status, placed_tx, placed_block)
       values ($1, $2, $3, $4, $5, $6, $7, 'open', $8, $9) on conflict (vault, order_id) do nothing returning 1`,
      [lc(e.vault), e.orderId, lc(e.buyer), e.serviceId, e.price, lc(e.requestRef), e.deadline, lc(e.tx), e.block],
    );
    return rows.length > 0;
  }
  const status = e.kind === "Delivered" ? "delivered" : e.kind === "Declined" ? "declined" : "reclaimed";
  const hash = e.kind === "Delivered" ? lc(e.envelopeHash) : null;
  // Only an open or claimed order can be closed; a late or replayed event never rewrites a closed one.
  const rows = await db.query(
    `update qredit.orders set status = $3, envelope_hash = coalesce($4, envelope_hash), closed_tx = $5, updated_at = now()
     where vault = $1 and order_id = $2 and status in ('open', 'claimed') returning 1`,
    [lc(e.vault), e.orderId, status, hash, lc(e.tx)],
  );
  return rows.length > 0;
}

type OrderRow = { vault: string; order_id: string; buyer: string; service_id: number; price: string; request_ref: string; deadline: string | number; status: Order["status"]; placed_tx: string; placed_block: string | number; envelope_hash: string | null };
const toOrder = (r: OrderRow): Order => ({
  vault: r.vault, orderId: r.order_id, buyer: r.buyer, serviceId: Number(r.service_id), price: r.price,
  requestRef: r.request_ref, deadline: Number(r.deadline), status: r.status, placedTx: r.placed_tx,
  placedBlock: Number(r.placed_block), envelopeHash: r.envelope_hash,
});

/**
 * Atomically claim the oldest open order (or one whose claim is older than staleAfterSeconds) among the given vaults.
 * A takeover of a stale claim can only repeat off-chain work: the vault refuses a second delivery (OrderNotOpen).
 */
export async function claimNextOrder(db: Queryable, vaults: string[], staleAfterSeconds = 900): Promise<Order | null> {
  if (!Number.isInteger(staleAfterSeconds) || staleAfterSeconds <= 0) throw new Error("staleAfterSeconds must be a positive integer");
  if (vaults.length === 0) return null;
  const [r] = await db.query<OrderRow>(
    `update qredit.orders set status = 'claimed', claimed_at = now(), updated_at = now()
     where (vault, order_id) = (
       select vault, order_id from qredit.orders
       where vault = any(string_to_array($1, ','))
         and (status = 'open' or (status = 'claimed' and claimed_at < now() - make_interval(secs => $2)))
       order by placed_block, order_id::numeric
       limit 1
       for update skip locked)
     returning *`,
    // Joined text: addresses contain no commas, and this behaves the same in postgres.js and PGlite.
    [vaults.map(lc).join(","), staleAfterSeconds],
  );
  return r ? toOrder(r) : null;
}

export async function listOrders(db: Queryable, vault: string, status?: Order["status"]): Promise<Order[]> {
  const rows = status
    ? await db.query<OrderRow>("select * from qredit.orders where vault = $1 and status = $2 order by placed_block desc limit 100", [lc(vault), status])
    : await db.query<OrderRow>("select * from qredit.orders where vault = $1 order by placed_block desc limit 100", [lc(vault)]);
  return rows.map(toOrder);
}
