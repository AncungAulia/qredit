import { useCallback, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Business } from "@/lib/schemas";
import { inboxKeys } from "@/modules/inbox/api/inbox.keys";
import {
  getBlockTimes,
  openDelivery,
  readDelivery,
  readMyOrders,
  readReportContext,
  reclaim,
  ReportDoesNotMatch,
  type Delivery,
} from "@/modules/inbox/api/inbox.api";
import { marketKeys } from "@/modules/market";
import { walletKeys } from "@/modules/wallet/api/useWalletStatus";
import { useWallet } from "@/modules/wallet/WalletProvider";

type Hex = `0x${string}`;
const REFRESH_MS = 15_000;

/** The orders of one buyer in every listed business; waits for the address and the business list. */
export const useMyOrdersQuery = (evm: Hex | null, businesses: Business[] | undefined) =>
  useQuery({
    queryKey: inboxKeys.orders(evm ?? "", (businesses ?? []).map((b) => b.vault)),
    queryFn: () => readMyOrders(evm as Hex, businesses as Business[]),
    enabled: evm !== null && businesses !== undefined,
    refetchInterval: REFRESH_MS,
  });

/** The time of each block of the orders. A block never changes, so this is cached for good. */
export const useOrderTimesQuery = (blocks: number[]) =>
  useQuery({
    queryKey: inboxKeys.times(blocks),
    queryFn: () => getBlockTimes(blocks),
    enabled: blocks.length > 0,
    staleTime: Infinity,
  });

/** One order and its business for the report page. */
export const useReportContextQuery = (vault: Hex, orderId: string) =>
  useQuery({
    queryKey: inboxKeys.context(vault, orderId),
    queryFn: () => readReportContext(vault, orderId),
    refetchInterval: REFRESH_MS,
  });

/**
 * The delivery of an order: the Delivered log, the stored envelope and the hash check. A delivery never changes,
 * and a mismatch is final, so neither is read again on its own.
 */
export const useDeliveryQuery = (vault: Hex, orderId: string, fromBlock: number, enabled: boolean) =>
  useQuery({
    queryKey: inboxKeys.delivery(vault, orderId),
    queryFn: () => readDelivery(vault, orderId, fromBlock),
    enabled,
    staleTime: Infinity,
    retry: (count, error) => !(error instanceof ReportDoesNotMatch) && count < 2,
  });

/** Opens a checked delivery with the keys of the current session. The keys never leave the session. */
export function useOpenReport() {
  const session = useWallet((s) => s.session);
  return useCallback(
    (vault: Hex, orderId: string, delivery: Delivery) => openDelivery(session, vault, orderId, delivery),
    [session],
  );
}

/** Reclaim for the current wallet. After a confirmed transaction the inbox and market figures are read again. */
export function useInboxActions() {
  const session = useWallet((s) => s.session);
  const client = useQueryClient();
  return useMemo(
    () => ({
      reclaim: async (vault: Hex, orderId: string) => {
        const hash = await reclaim(session, vault, orderId);
        void client.invalidateQueries({ queryKey: inboxKeys.all });
        void client.invalidateQueries({ queryKey: marketKeys.all });
        void client.invalidateQueries({ queryKey: walletKeys.all });
        return hash;
      },
    }),
    [session, client],
  );
}
