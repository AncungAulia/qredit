import { KpiTile } from "@/components/shared/KpiTile";
import { formatCount, formatFusd } from "@/lib/format";
import type { MarketEntry } from "@/modules/market/api/market.api";
import { marketTotals } from "@/modules/market/lib/marketTotals";

// Phone: the first and last tile span the row. Tablet: two by two. Desktop: one row of four.
export const KPI_GRID = "grid grid-cols-2 gap-3 md:gap-3 xl:grid-cols-4 xl:gap-4";

/** The four figures of the Market frame, summed over the vaults and orders that were read. */
export function MarketKpis({ entries }: { entries: MarketEntry[] }) {
  const t = marketTotals(entries);
  return (
    <div className={KPI_GRID}>
      <KpiTile
        variant="feature"
        label="Total lent"
        value={formatFusd(t.lent, { unit: false })}
        unit="fUSD"
        className="col-span-2 md:col-span-1"
      />
      <KpiTile
        variant="soft"
        label="Repaid to lenders"
        value={formatFusd(t.repaid, { unit: false })}
        unit="fUSD"
      />
      <KpiTile variant="soft" label="Reports delivered" value={formatCount(t.delivered)} />
      <KpiTile
        variant="soft"
        label="Raising now"
        value={String(t.raising)}
        unit={t.raising === 1 ? "business" : "businesses"}
        className="col-span-2 md:col-span-1"
      />
    </div>
  );
}
