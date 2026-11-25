import { useQuery } from "@tanstack/react-query";
import {
  getBusiness,
  getLatestOrders,
  getMarket,
  getOrders,
  pickLatestOrders,
  readVaultSnapshot,
  type MarketEntry,
} from "@/modules/market/api/market.api";
import { marketKeys } from "@/modules/market/api/market.keys";

const REFRESH_MS = 15_000;
const LATEST_ORDERS = 4;

export const useMarketQuery = () =>
  useQuery({ queryKey: marketKeys.all, queryFn: getMarket, refetchInterval: REFRESH_MS });

export const useBusinessQuery = (slug: string) =>
  useQuery({ queryKey: marketKeys.business(slug), queryFn: () => getBusiness(slug) });

export const useVaultQuery = (vault: `0x${string}`) =>
  useQuery({
    queryKey: marketKeys.vault(vault),
    queryFn: () => readVaultSnapshot(vault),
    refetchInterval: REFRESH_MS,
  });

export const useOrdersQuery = (vault: `0x${string}`) =>
  useQuery({
    queryKey: marketKeys.orders(vault),
    queryFn: () => getOrders(vault),
    refetchInterval: REFRESH_MS,
  });

/** The newest orders of the loaded market, each with the time of its block. Keyed by transaction so it refetches only when the newest orders change. */
export function useLatestOrdersQuery(entries: MarketEntry[] | undefined) {
  const refs = entries ? pickLatestOrders(entries, LATEST_ORDERS) : [];
  return useQuery({
    queryKey: marketKeys.latestOrders(refs.map((r) => r.order.placedTx)),
    queryFn: () => getLatestOrders(refs),
    enabled: refs.length > 0,
  });
}
