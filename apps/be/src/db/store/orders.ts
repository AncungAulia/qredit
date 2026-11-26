import type { Queryable } from "../client.ts";
import { type Ended, setBusinessAgents, setBusinessEnded } from "./businesses.ts";
import { lc } from "./lc.ts";

/** `delivered` is the final state of a v1 order; v2 orders go `in_review` and end `settled` or `rejected`. */
export const ORDER_STATUSES = ["open", "claimed", "delivered", "in_review", "settled", "rejected", "declined", "reclaimed"] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export interface Order {
  vault: string;
  orderId: string;
  buyer: string;
  serviceId: number;
  price: string;
  requestRef: string;
  deadline: number;
  status: OrderStatus;
  placedTx: string;
  placedBlock: number;
  envelopeHash: string | null;
  /** Unix seconds; set by a v2 delivery. */
  reviewEnds: number | null;
  /** fUSD units returned to the buyer by a rejection. */
  refund: string | null;
}

type Base = { vault: string; block: number; logIndex: number; tx: string };
type OrderBase = Base & { orderId: string };
export type VaultEvent =
  | (OrderBase & { kind: "OrderPlaced"; buyer: string; serviceId: number; price: string; requestRef: string; deadline: number })
  | (OrderBase & { kind: "Delivered"; envelopeHash: string; reviewEnds: number | null })
  | (OrderBase & { kind: "Settled" })
  | (OrderBase & { kind: "Rejected"; refund: string })
  | (OrderBase & { kind: "Declined" | "Reclaimed" })
  | (Base & { kind: "LoanEnded"; ended: Ended })
  | (Base & { kind: "AgentRotated"; spender: string; operator: string });

const changed = (rows: unknown[]) => rows.length > 0;

/**
 * Applies one vault event idempotently. Returns true when a row changed, false when the event was a duplicate or did
 * not fit the current state (a late or replayed event never rewrites a later one).
 */
export async function applyVaultEvent(db: Queryable, e: VaultEvent): Promise<boolean> {
  switch (e.kind) {
    case "OrderPlaced":
      return changed(await db.query(
        `insert into qredit.orders (vault, order_id, buyer, service_id, price, request_ref, deadline, status, placed_tx, placed_block)
         values ($1, $2, $3, $4, $5, $6, $7, 'open', $8, $9) on conflict (vault, order_id) do nothing returning 1`,
        [lc(e.vault), e.orderId, lc(e.buyer), e.serviceId, e.price, lc(e.requestRef), e.deadline, lc(e.tx), e.block],
      ));
    case "Delivered":
      // A v1 delivery is final; a v2 delivery opens the buyer's review.
      return changed(await db.query(
        `update qredit.orders set status = $3, envelope_hash = $4, review_ends = $5, closed_tx = $6, updated_at = now()
         where vault = $1 and order_id = $2 and status in ('open', 'claimed') returning 1`,
        [lc(e.vault), e.orderId, e.reviewEnds === null ? "delivered" : "in_review", lc(e.envelopeHash), e.reviewEnds, lc(e.tx)],
      ));
    case "Settled":
      return changed(await db.query(
        `update qredit.orders set status = 'settled', updated_at = now()
         where vault = $1 and order_id = $2 and status = 'in_review' returning 1`,
        [lc(e.vault), e.orderId],
      ));
    case "Rejected":
      return changed(await db.query(
        `update qredit.orders set status = 'rejected', refund = $3, updated_at = now()
         where vault = $1 and order_id = $2 and status = 'in_review' returning 1`,
        [lc(e.vault), e.orderId, e.refund],
      ));
    case "Declined":
    case "Reclaimed":
      return changed(await db.query(
        `update qredit.orders set status = $3, closed_tx = $4, updated_at = now()
         where vault = $1 and order_id = $2 and status in ('open', 'claimed') returning 1`,
        [lc(e.vault), e.orderId, e.kind === "Declined" ? "declined" : "reclaimed", lc(e.tx)],
      ));
    case "LoanEnded":
      return setBusinessEnded(db, e.vault, e.ended);
    case "AgentRotated":
      return setBusinessAgents(db, e.vault, e.spender, e.operator);
  }
}

type OrderRow = {
  vault: string; order_id: string; buyer: string; service_id: number; price: string; request_ref: string; deadline: string | number;
  status: OrderStatus; placed_tx: string; placed_block: string | number; envelope_hash: string | null;
  review_ends: string | number | null; refund: string | null;
};
const toOrder = (r: OrderRow): Order => ({
  vault: r.vault, orderId: r.order_id, buyer: r.buyer, serviceId: Number(r.service_id), price: r.price,
  requestRef: r.request_ref, deadline: Number(r.deadline), status: r.status, placedTx: r.placed_tx,
  placedBlock: Number(r.placed_block), envelopeHash: r.envelope_hash,
  reviewEnds: r.review_ends === null ? null : Number(r.review_ends), refund: r.refund,
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

export async function listOrders(db: Queryable, vault: string, status?: OrderStatus): Promise<Order[]> {
  const rows = status
    ? await db.query<OrderRow>("select * from qredit.orders where vault = $1 and status = $2 order by placed_block desc limit 100", [lc(vault), status])
    : await db.query<OrderRow>("select * from qredit.orders where vault = $1 order by placed_block desc limit 100", [lc(vault)]);
  return rows.map(toOrder);
}

export type BusinessStats = { delivered: number; rejected: number; uniqueBuyers: number };

/** Per vault: orders delivered (any delivered state), orders rejected, and distinct buyers. One query; `vault` narrows it. */
export async function orderStats(db: Queryable, vault?: string): Promise<Map<string, BusinessStats>> {
  const rows = await db.query<{ vault: string; delivered: number; rejected: number; unique_buyers: number }>(
    `select vault,
        count(*) filter (where status in ('delivered', 'in_review', 'settled', 'rejected'))::int as delivered,
        count(*) filter (where status = 'rejected')::int as rejected,
        count(distinct buyer)::int as unique_buyers
     from qredit.orders where ($1::text is null or vault = $1) group by vault`,
    [vault ? lc(vault) : null],
  );
  return new Map(rows.map((r) => [r.vault, { delivered: Number(r.delivered), rejected: Number(r.rejected), uniqueBuyers: Number(r.unique_buyers) }]));
}
