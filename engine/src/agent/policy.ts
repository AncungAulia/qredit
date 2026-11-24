import type { SupplierPlan } from "../services/types.ts";
import type { SupplierRole } from "../setup/businesses.ts";
import { DECLINE, type Plan, type Prices, type VaultFunds } from "./types.ts";

const DEFAULT_MIN_MARGIN_BPS = 2000;

/** Daily cap left today; spentToday only counts when it was recorded on the current day. */
export function spendableToday(f: VaultFunds): bigint {
  const left = f.dailyCap - (f.dayIndex === f.nowDay ? f.spentToday : 0n);
  return left > 0n ? left : 0n;
}

const noFunds = (reason: string): Plan => ({ ok: false, code: DECLINE.noFunds, reason });

/**
 * Decides whether an order can be served within the vault limits (mirrors LoanVault.paySupplier).
 * `budget` is what remains for the choice role after the required roles:
 * min(price margin limit, opex, spendable today) - required cost.
 */
export function planOrder(o: {
  price: bigint;
  supplierPlan: SupplierPlan;
  prices: Prices;
  caps: Partial<Record<string, bigint>>;
  funds: VaultFunds;
  minMarginBps?: number;
}): Plan {
  const { price, supplierPlan, prices, caps, funds } = o;
  if (funds.paused) return noFunds("vault is paused by its owner");

  const usable = (role: SupplierRole): boolean => {
    const cap = caps[role] ?? 0n;
    return cap > 0n && prices[role] <= cap;
  };
  for (const role of supplierPlan.required) {
    if (!usable(role)) return noFunds(`supplier ${role} is not usable in this vault`);
  }
  const choice = supplierPlan.choice.filter(usable);
  if (supplierPlan.choice.length > 0 && choice.length === 0) return noFunds("no usable compute supplier");

  const requiredCost = supplierPlan.required.reduce((sum, r) => sum + prices[r], 0n);
  // Array.prototype.sort is stable: ties keep the plan's order
  const sorted = [...choice].sort((a, b) => (prices[a] < prices[b] ? -1 : prices[a] > prices[b] ? 1 : 0));
  const minCost = requiredCost + (sorted.length > 0 ? prices[sorted[0]!] : 0n);

  const marginLimit = (price * BigInt(10000 - (o.minMarginBps ?? DEFAULT_MIN_MARGIN_BPS))) / 10000n;
  if (minCost > marginLimit) return { ok: false, code: DECLINE.unprofitable, reason: "the price does not cover the cost with the required margin" };

  const spendable = spendableToday(funds);
  if (minCost > funds.opex) return noFunds("operating funds are too low for this order");
  if (minCost > spendable) return noFunds("daily spending cap is too low for this order");

  const limit = [marginLimit, funds.opex, spendable].reduce((m, v) => (v < m ? v : m));
  const budget = limit - requiredCost;
  return { ok: true, required: supplierPlan.required, affordableChoice: sorted.filter((r) => prices[r] <= budget), budget };
}
