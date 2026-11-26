import { expect, test } from "vitest";
import { inboxTotals, isLate } from "@/modules/inbox/lib/inboxOrders";

const NOW = Date.parse("2026-11-26T12:00:00Z");
const past = new Date(NOW - 1000);
const future = new Date(NOW + 1000);

test("only an open order past its deadline is late", () => {
  expect(isLate({ status: "open", deadline: past }, NOW)).toBe(true);
  expect(isLate({ status: "open", deadline: future }, NOW)).toBe(false);
  expect(isLate({ status: "claimed", deadline: past }, NOW)).toBe(false);
  expect(isLate({ status: "delivered", deadline: past }, NOW)).toBe(false);
});

test("totals separate delivered, waiting and returned money", () => {
  const totals = inboxTotals([
    { status: "delivered", price: 250_000n },
    { status: "open", price: 1_000_000n },
    { status: "claimed", price: 500_000n },
    { status: "declined", price: 250_000n },
    { status: "reclaimed", price: 500_000n },
  ]);
  expect(totals).toEqual({ ready: 1, waiting: 2, spent: 250_000n, refunded: 750_000n });
});

test("v2 totals: a report in review is ready but not yet spent; a rejection returns its refund", () => {
  const totals = inboxTotals([
    { status: "in_review", price: 250_000n },
    { status: "settled", price: 250_000n },
    { status: "rejected", price: 250_000n, refund: 200_000n },
    { status: "declined", price: 250_000n, refund: 250_000n },
  ]);
  expect(totals).toEqual({ ready: 3, waiting: 0, spent: 300_000n, refunded: 450_000n });
});
