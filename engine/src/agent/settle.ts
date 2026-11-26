import type { CloseResult } from "./chain.ts";

/** An order waiting for its buyer's review, as the backend lists it. */
export type ReviewOrder = { orderId: string; reviewEnds: number | null };

export type SettleDeps = {
  inReview(vault: string): Promise<ReviewOrder[]>;
  settle(vault: string, orderId: bigint): Promise<CloseResult>;
  /** Unix seconds. */
  now(): number;
  log(line: string): void;
};

const detail = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * Settles every order of these vaults whose review has ended (the buyer neither accepted nor rejected), so the sale is
 * split and lenders are repaid. One failure never stops the others. Returns how many this run settled.
 */
export async function settleDue(vaults: string[], deps: SettleDeps): Promise<number> {
  let settled = 0;
  for (const vault of vaults) {
    let orders: ReviewOrder[];
    try {
      orders = await deps.inReview(vault);
    } catch (e) {
      deps.log(`settle: listing ${vault} failed: ${detail(e)}`);
      continue;
    }
    for (const o of orders) {
      if (o.reviewEnds === null || deps.now() <= o.reviewEnds) continue;
      try {
        const r = await deps.settle(vault, BigInt(o.orderId));
        if (r.tx) {
          settled++;
          deps.log(`order ${o.orderId}: settled tx ${r.tx}`);
        }
      } catch (e) {
        deps.log(`order ${o.orderId}: settle failed: ${detail(e)}`);
      }
    }
  }
  return settled;
}

/** Wraps `fn` so it runs at most once per `ms`; calls in between return at once. */
export function everyMs(fn: () => Promise<void>, ms: number, now: () => number = Date.now): () => Promise<void> {
  let last = Number.NEGATIVE_INFINITY;
  return async () => {
    if (now() - last < ms) return;
    last = now();
    await fn();
  };
}
