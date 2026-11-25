import type { MarketEntry } from "@/modules/market/api/market.api";
import { BusinessCard } from "./BusinessCard";

/** Two columns from tablet up, one on a phone; every card in a row has the same height. */
export function BusinessGrid({ entries }: { entries: MarketEntry[] }) {
  return (
    <div className="grid auto-rows-fr grid-cols-1 gap-4 md:grid-cols-2 xl:gap-6">
      {entries.map((e) => (
        <BusinessCard key={e.business.slug} entry={e} />
      ))}
    </div>
  );
}
