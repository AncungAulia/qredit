import type { MarketEntry } from "@/modules/market/api/market.api";

export type MarketTotals = { lent: bigint; repaid: bigint; delivered: number; raising: number };

const LENT_STATES: ReadonlySet<string> = new Set(["Active", "Trapped", "Repaid"]);

/** The figures of the KPI row, summed over the vaults. Only Active, Trapped and Repaid vaults have lent money: a Raising vault holds deposits and a Refunded one returned them. */
export function marketTotals(entries: MarketEntry[]): MarketTotals {
  return entries.reduce<MarketTotals>(
    (t, { vault, ordersDelivered }) => ({
      lent: LENT_STATES.has(vault.state) ? t.lent + vault.raised : t.lent,
      repaid: t.repaid + vault.repaid,
      delivered: t.delivered + ordersDelivered,
      raising: t.raising + (vault.state === "Raising" ? 1 : 0),
    }),
    { lent: 0n, repaid: 0n, delivered: 0, raising: 0 },
  );
}
