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
  accept,
  reject,
  readRejectRefund,
  DeliveryNotFound,
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
export const useDeliveryQuery = (vault: Hex, orderId: string, fromBlock: number, deadline: Date, enabled: boolean, version: 1 | 2) =>
  useQuery({
    queryKey: inboxKeys.delivery(vault, orderId),
    queryFn: () => readDelivery(vault, orderId, fromBlock, deadline, version),
    enabled,
    staleTime: Infinity,
    // A mismatch is final and a missing record is an answer, not a failure; only a failed read is tried again.
    retry: (count, error) => !(error instanceof ReportDoesNotMatch || error instanceof DeliveryNotFound) && count < 2,
  });

/** The refund a rejection would give now (price less the supplier cost), read while the review is open. */
export const useRejectRefundQuery = (vault: Hex, orderId: string, price: bigint, enabled: boolean) =>
  useQuery({ queryKey: inboxKeys.refund(vault, orderId), queryFn: () => readRejectRefund(vault, orderId, price), enabled, staleTime: 0 });

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
      accept: async (vault: Hex, orderId: string) => {
        const hash = await accept(session, vault, orderId);
        void client.invalidateQueries({ queryKey: inboxKeys.all });
        void client.invalidateQueries({ queryKey: marketKeys.all });
        return hash;
      },
      reject: async (vault: Hex, orderId: string) => {
        const hash = await reject(session, vault, orderId);
        void client.invalidateQueries({ queryKey: inboxKeys.all });
        void client.invalidateQueries({ queryKey: marketKeys.all });
        void client.invalidateQueries({ queryKey: walletKeys.all });
        return hash;
      },
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
