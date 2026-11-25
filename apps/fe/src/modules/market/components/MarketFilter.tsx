import Link from "next/link";
import { focusRing, cn } from "@/lib/utils";
import { MARKET_FILTERS, type MarketFilterKey } from "@/modules/market/lib/marketFilter";

/** Segmented filter from the design. The value lives in the address (?state=), so a filtered view can be shared. */
export function MarketFilter({ active }: { active: MarketFilterKey }) {
  return (
    <nav
      aria-label="Filter businesses"
      className="flex w-fit max-w-full gap-1 overflow-x-auto rounded-full bg-surface-muted p-1"
    >
      {MARKET_FILTERS.map(({ key, label }) => (
        <Link
          key={key}
          href={key === "all" ? "/" : `/?state=${key}`}
          scroll={false}
          aria-current={key === active ? "true" : undefined}
          className={cn(
            "inline-flex items-center rounded-full px-4 py-2 text-sm font-medium transition-colors duration-[120ms] ease-[var(--ease-out)] pointer-coarse:min-h-11",
            focusRing,
            key === active
              ? "bg-primary text-on-primary"
              : "text-text-secondary hover:bg-surface-hover",
          )}
        >
          {label}
        </Link>
      ))}
    </nav>
  );
}
