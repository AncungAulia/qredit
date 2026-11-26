import { hasReport, isSettledSale } from "@/lib/orderStatus";
import type { Order } from "@/lib/schemas";

/** An open order whose deadline has passed: the buyer can take the price back. Only open orders can be reclaimed. */
export const isLate = (order: Pick<Order, "status" | "deadline">, now: Date | number = Date.now()): boolean =>
  order.status === "open" && +order.deadline < +now;

export type InboxTotals = {
  /** Delivered reports, in either vault version. The app cannot tell which were opened already, so every one counts. */
  ready: number;
  /** Orders the agent has not delivered, declined or lost yet. */
  waiting: number;
  /** What the buyer paid for reports it kept, plus what a rejection or a decline kept as supplier cost. */
  spent: bigint;
  /** What came back to the buyer: reclaims, declines and rejections (the refund when it is known, else the price). */
  refunded: bigint;
};

export function inboxTotals(orders: (Pick<Order, "status" | "price"> & { refund?: bigint | null })[]): InboxTotals {
  const totals: InboxTotals = { ready: 0, waiting: 0, spent: 0n, refunded: 0n };
  for (const o of orders) {
    if (hasReport(o.status)) totals.ready += 1;
    if (isSettledSale(o.status)) totals.spent += o.price;
    else if (o.status === "open" || o.status === "claimed") totals.waiting += 1;
    else if (o.status === "rejected" || o.status === "declined" || o.status === "reclaimed") {
      const back = o.refund ?? o.price;
      totals.refunded += back;
      totals.spent += o.price - back;
    }
    // in_review: the price is still in escrow, neither spent nor returned.
  }
  return totals;
}
