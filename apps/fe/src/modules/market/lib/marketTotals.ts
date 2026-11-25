import type { MarketEntry } from "@/modules/market/api/market.api";

export type MarketTotals = { lent: bigint; repaid: bigint; delivered: number; raising: number };

/** The figures of the KPI row, summed over the vaults. A refunded raise was returned, so it is not counted as lent. */
export function marketTotals(entries: MarketEntry[]): MarketTotals {
  return entries.reduce<MarketTotals>(
    (t, { vault, ordersDelivered }) => ({
      lent: vault.state === "Refunded" ? t.lent : t.lent + vault.raised,
      repaid: t.repaid + vault.repaid,
      delivered: t.delivered + ordersDelivered,
      raising: t.raising + (vault.state === "Raising" ? 1 : 0),
    }),
    { lent: 0n, repaid: 0n, delivered: 0, raising: 0 },
  );
}
