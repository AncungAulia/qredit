import type { VaultStateName } from "@/components/shared/StateBadge";
import { isFailed, type MarketRow } from "@/modules/market/api/market.api";

export type MarketFilterKey = "all" | "raising" | "active" | "repaid";

/** The filter segments of the Market page. Active covers a loan that is being repaid, on schedule or behind it. */
export const MARKET_FILTERS: {
  key: MarketFilterKey;
  label: string;
  states: VaultStateName[] | null;
}[] = [
  { key: "all", label: "All", states: null },
  { key: "raising", label: "Raising", states: ["Raising"] },
  { key: "active", label: "Active", states: ["Active", "Trapped"] },
  { key: "repaid", label: "Repaid", states: ["Repaid"] },
];

/** An unknown or missing value in the address means All. */
export const parseMarketFilter = (value: string | null): (typeof MARKET_FILTERS)[number] =>
  MARKET_FILTERS.find((f) => f.key === value) ?? MARKET_FILTERS[0];

/** A business that could not be read has no known state, so it shows under All only. */
export const applyMarketFilter = (rows: MarketRow[], filter: (typeof MARKET_FILTERS)[number]) =>
  filter.states ? rows.filter((r) => !isFailed(r) && filter.states!.includes(r.vault.state)) : rows;
