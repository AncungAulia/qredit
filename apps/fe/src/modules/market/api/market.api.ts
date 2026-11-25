import { LOAN_VAULT_ABI } from "@qredit/qore";
import { z } from "zod";
import { vaultStateName } from "@/components/shared/StateBadge";
import { api, parseResponse } from "@/lib/apiClient";
import { publicClient } from "@/lib/chain";
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

export async function getOrders(vault: Hex): Promise<Order[]> {
  const { data } = await api.get("/v1/orders", { params: { vault } });
  return parseResponse(z.array(orderSchema), data);
}

const read = <T>(address: Hex, functionName: string) =>
  publicClient.readContract({ address, abi: LOAN_VAULT_ABI, functionName } as never) as Promise<T>;

/** Reads the loan state of one vault from the chain. An unknown state number rejects. */
export async function readVaultSnapshot(vault: Hex): Promise<VaultSnapshot> {
  const [state, raised, repaid, paused, lenderBps, loan] = await Promise.all([
    read<number>(vault, "state"),
    read<bigint>(vault, "raised"),
    read<bigint>(vault, "repaid"),
    read<boolean>(vault, "paused"),
    read<number>(vault, "lenderBps"),
    read<readonly [bigint, bigint, bigint, bigint, bigint, bigint]>(vault, "loan"),
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
  orders: Order[];
};

export function toMarketEntry(
  business: Business,
  vault: VaultSnapshot,
  orders: Order[],
): MarketEntry {
  return {
    business,
    vault,
    orders,
    ordersDelivered: orders.filter((o) => o.status === "delivered").length,
  };
}

/** Every business with its vault read from the chain and its orders. Any failed read fails the whole market. */
export async function getMarket(): Promise<MarketEntry[]> {
  const businesses = await getBusinesses();
  return Promise.all(
    businesses.map(async (b) => {
      const [vault, orders] = await Promise.all([readVaultSnapshot(b.vault), getOrders(b.vault)]);
      return toMarketEntry(b, vault, orders);
    }),
  );
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
        serviceName:
          e.business.services.find((s) => s.id === order.serviceId)?.name ??
          `Service ${order.serviceId}`,
      })),
    )
    .sort((a, b) => b.order.placedBlock - a.order.placedBlock)
    .slice(0, limit);
}

/** Adds the time each order was placed, read from the timestamp of its block. */
export function getLatestOrders(refs: LatestOrderRef[]): Promise<LatestOrder[]> {
  return Promise.all(
    refs.map(async (ref) => {
      const block = await publicClient.getBlock({ blockNumber: BigInt(ref.order.placedBlock) });
      return { ...ref, placedAt: new Date(Number(block.timestamp) * 1000) };
    }),
  );
}
