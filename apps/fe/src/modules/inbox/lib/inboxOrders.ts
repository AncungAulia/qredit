import type { Order } from "@/lib/schemas";

/** An open order whose deadline has passed: the buyer can take the price back. Only open orders can be reclaimed. */
export const isLate = (order: Pick<Order, "status" | "deadline">, now: Date | number = Date.now()): boolean =>
  order.status === "open" && +order.deadline < +now;

export type InboxTotals = {
  /** Delivered reports. The app cannot tell which were opened already, so every delivered report counts. */
  ready: number;
  /** Orders the agent has not delivered, declined or lost yet. */
  waiting: number;
  /** The price of delivered orders. */
  spent: bigint;
  /** The price of orders that came back to the buyer: declined or reclaimed. */
  refunded: bigint;
};

export function inboxTotals(orders: Pick<Order, "status" | "price">[]): InboxTotals {
  const totals: InboxTotals = { ready: 0, waiting: 0, spent: 0n, refunded: 0n };
  for (const o of orders) {
    if (o.status === "delivered") {
      totals.ready += 1;
      totals.spent += o.price;
    } else if (o.status === "open" || o.status === "claimed") {
      totals.waiting += 1;
    } else {
      totals.refunded += o.price;
    }
  }
  return totals;
}
