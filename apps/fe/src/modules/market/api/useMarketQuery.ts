import { useQuery } from "@tanstack/react-query";
import {
  getBlockTimes,
  getBusiness,
  getBusinesses,
  getMarket,
  getOrders,
  isLoaded,
  pickLatestOrders,
  readVaultSnapshot,
  type LatestOrder,
  type MarketRow,
} from "@/modules/market/api/market.api";
import { marketKeys } from "@/modules/market/api/market.keys";

const REFRESH_MS = 15_000;
const LATEST_ORDERS = 4;

export const useMarketQuery = () =>
  useQuery({ queryKey: marketKeys.all, queryFn: getMarket, refetchInterval: REFRESH_MS });

/** Every business, v1 and v2: the Inbox and lending positions still read v1 vaults. */
export const useBusinessesQuery = () =>
  useQuery({ queryKey: marketKeys.businesses, queryFn: getBusinesses, refetchInterval: REFRESH_MS });

export const useBusinessQuery = (slug: string) =>
  useQuery({ queryKey: marketKeys.business(slug), queryFn: () => getBusiness(slug) });

export const useVaultQuery = (vault: `0x${string}`, version: 1 | 2 = 2) =>
  useQuery({
    queryKey: marketKeys.vault(vault),
    queryFn: () => readVaultSnapshot(vault, version),
    refetchInterval: REFRESH_MS,
  });

export const useOrdersQuery = (vault: `0x${string}`) =>
  useQuery({
    queryKey: marketKeys.orders(vault),
    queryFn: () => getOrders(vault),
    refetchInterval: REFRESH_MS,
  });

/**
 * The newest orders of the loaded market. Only the block times are cached (a block never changes);
 * the orders themselves come from the market query on every render, so a status change shows at once.
 */
export function useLatestOrdersQuery(rows: MarketRow[] | undefined) {
  const refs = rows ? pickLatestOrders(rows.filter(isLoaded), LATEST_ORDERS) : [];
  const blocks = refs.map((r) => r.order.placedBlock);
  const times = useQuery({
    queryKey: marketKeys.blockTimes(blocks),
    queryFn: () => getBlockTimes(blocks),
    enabled: blocks.length > 0,
    staleTime: Infinity,
  });
  const timeData = times.data;
  const orders: LatestOrder[] | undefined = timeData
    ? refs.map((r) => ({ ...r, placedAt: timeData[r.order.placedBlock] }))
    : undefined;
  return {
    orders,
    /** The loaded businesses have no orders at all. */
    isEmpty: rows !== undefined && refs.length === 0,
    isPending: times.isPending,
    isError: times.isError,
    refetch: () => times.refetch(),
  };
}
