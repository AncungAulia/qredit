import type { SupplierRole } from "../setup/businesses.ts";

export const DECLINE = { outOfScope: 1, unprofitable: 2, noFunds: 3, noRecipientKey: 4, unreadable: 5, supplierFailed: 6 } as const;
export type DeclineCode = (typeof DECLINE)[keyof typeof DECLINE];
export type Order = { vault: string; orderId: string; buyer: string; serviceId: number; price: string; requestRef: string; deadline: number };
export type VaultFunds = { opex: bigint; dailyCap: bigint; spentToday: bigint; dayIndex: bigint; nowDay: bigint; paused: boolean };
export type Prices = Record<SupplierRole, bigint>;
export type Plan =
  | { ok: true; required: SupplierRole[]; affordableChoice: SupplierRole[]; budget: bigint }
  | { ok: false; code: DeclineCode; reason: string };
