import { isFailed, type MarketRow } from "@/modules/market/api/market.api";
import { BusinessCard, FailedBusinessCard } from "./BusinessCard";

/** Two columns from tablet up, one on a phone; every card in a row has the same height. */
export function BusinessGrid({ rows, onRetry }: { rows: MarketRow[]; onRetry: () => void }) {
  return (
    <div className="grid auto-rows-fr grid-cols-1 gap-4 md:grid-cols-2 xl:gap-6">
      {rows.map((r) =>
        isFailed(r) ? (
          <FailedBusinessCard key={r.business.slug} entry={r} onRetry={onRetry} />
        ) : (
          <BusinessCard key={r.business.slug} entry={r} />
        ),
      )}
    </div>
  );
}
