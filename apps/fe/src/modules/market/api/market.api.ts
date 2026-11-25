import { z } from "zod";
import { api, parseResponse } from "@/lib/apiClient";
import { publicClient, readVault } from "@/lib/chain";
import { serviceName } from "@/lib/serviceName";
import { vaultStateName } from "@/lib/vaultState";
import { businessSchema, orderSchema, type Business, type Order } from "@/lib/schemas";
import type { VaultSnapshot } from "@/modules/market/schemas/vault.schema";

type Hex = `0x${string}`;

export async function getBusinesses(): Promise<Business[]> {
  const { data } = await api.get("/v1/businesses");
  return parseResponse(z.array(businessSchema), data);
}

export async function getBusiness(slug: string): Promise<Business> {
  const { data } = await api.get(`/v1/businesses/${encodeURIComponent(slug)}`);
  return parseResponse(businessSchema, data);
}

/** The most orders the backend returns for one vault (newest first). A list this long may be missing older orders. */
export const ORDERS_LIMIT = 100;

/** Orders delivered in a list. `capped` is true when the list is as long as the backend allows, so older orders may be missing. */
export function countDelivered(orders: Order[]): { count: number; capped: boolean } {
  return {
    count: orders.filter((o) => o.status === "delivered").length,
    capped: orders.length >= ORDERS_LIMIT,
  };
}

export async function getOrders(vault: Hex): Promise<Order[]> {
  const { data } = await api.get("/v1/orders", { params: { vault } });
  return parseResponse(z.array(orderSchema), data);
}

/** Reads the loan state of one vault from the chain. An unknown state number rejects. */
export async function readVaultSnapshot(vault: Hex): Promise<VaultSnapshot> {
  const [state, raised, repaid, paused, lenderBps, loan] = await Promise.all([
    readVault(vault, "state"),
    readVault(vault, "raised"),
    readVault(vault, "repaid"),
    readVault(vault, "paused"),
    readVault(vault, "lenderBps"),
    readVault(vault, "loan"),
  ]);
  // loan() returns target, totalOwed, raiseDeadline, period, grace, installment.
  const [target, totalOwed, raiseDeadline, period, , installment] = loan;
  return {
    state: vaultStateName(Number(state)),
    raised,
    repaid,
    paused,
    lenderBps: Number(lenderBps),
    target,
    totalOwed,
    installment,
    period,
    raiseDeadline: new Date(Number(raiseDeadline) * 1000),
  };
}

export type MarketEntry = {
  business: Business;
  vault: VaultSnapshot;
  ordersDelivered: number;
  /** True when the order list hit the backend limit, so the delivered count is a lower bound. */
  deliveredCapped: boolean;
  orders: Order[];
};

/** A business whose vault or orders could not be read. It stays in the list so the others still show. */
export type FailedEntry = { business: Business; failed: true };
export type MarketRow = MarketEntry | FailedEntry;

export const isFailed = (row: MarketRow): row is FailedEntry => "failed" in row;
export const isLoaded = (row: MarketRow): row is MarketEntry => !isFailed(row);

export function toMarketEntry(
  business: Business,
  vault: VaultSnapshot,
  orders: Order[],
): MarketEntry {
  const delivered = countDelivered(orders);
  return {
    business,
    vault,
    orders,
    ordersDelivered: delivered.count,
    deliveredCapped: delivered.capped,
  };
}

/**
 * Every business with its vault read from the chain and its orders. One business that cannot be read
 * becomes a failed row; when none can be read, the load itself fails.
 */
export async function getMarket(): Promise<MarketRow[]> {
  const businesses = await getBusinesses();
  let firstError: unknown;
  const rows = await Promise.all(
    businesses.map(async (b): Promise<MarketRow> => {
      const [vault, orders] = await Promise.allSettled([
        readVaultSnapshot(b.vault),
        getOrders(b.vault),
      ]);
      if (vault.status === "fulfilled" && orders.status === "fulfilled") {
        return toMarketEntry(b, vault.value, orders.value);
      }
      firstError ??=
        vault.status === "rejected" ? vault.reason : (orders as PromiseRejectedResult).reason;
      return { business: b, failed: true };
    }),
  );
  if (rows.length > 0 && rows.every(isFailed)) throw firstError;
  return rows;
}

export type LatestOrderRef = { order: Order; business: Business; serviceName: string };
export type LatestOrder = LatestOrderRef & { placedAt: Date };

/** The newest orders across all businesses. Orders carry a block number, so newest means highest block. */
export function pickLatestOrders(entries: MarketEntry[], limit: number): LatestOrderRef[] {
  return entries
    .flatMap((e) =>
      e.orders.map((order) => ({
        order,
        business: e.business,
        serviceName: serviceName(e.business, order.serviceId),
      })),
    )
    .sort((a, b) => b.order.placedBlock - a.order.placedBlock)
    .slice(0, limit);
}

/** The time of each block, read from its timestamp. A block never changes, so this can be cached for good. */
export async function getBlockTimes(blocks: number[]): Promise<Record<number, Date>> {
  const times = await Promise.all(
    blocks.map(async (n) => {
      const block = await publicClient.getBlock({ blockNumber: BigInt(n) });
      return [n, new Date(Number(block.timestamp) * 1000)] as const;
    }),
  );
  return Object.fromEntries(times);
}
