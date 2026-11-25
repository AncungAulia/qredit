import { expect, test } from "vitest";
import { marketTotals } from "@/modules/market/lib/marketTotals";

const entry = (state: string, raised: bigint, repaid: bigint, delivered: number) =>
  ({ vault: { state, raised, repaid }, ordersDelivered: delivered }) as never;

test("adds up lent, repaid, reports and businesses still raising", () => {
  const t = marketTotals([
    entry("Active", 50_000_000n, 11_000_000n, 18),
    entry("Raising", 8_000_000n, 0n, 0),
    entry("Repaid", 5_000_000n, 5_500_000n, 64),
  ]);
  expect(t).toEqual({ lent: 63_000_000n, repaid: 16_500_000n, delivered: 82, raising: 1 });
});

test("a refunded raise is not counted as lent", () => {
  expect(marketTotals([entry("Refunded", 9_000_000n, 0n, 0)]).lent).toBe(0n);
});
