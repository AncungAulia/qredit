import type { Order } from "@/lib/schemas";

type Status = Order["status"];

/** A report was delivered: v1 "delivered", or v2 "in_review", "settled" and "rejected". */
export const hasReport = (s: Status): boolean => s === "delivered" || s === "in_review" || s === "settled" || s === "rejected";

/** The buyer kept the report and the sale was split: v1 "delivered" or v2 "settled". */
export const isSettledSale = (s: Status): boolean => s === "delivered" || s === "settled";
