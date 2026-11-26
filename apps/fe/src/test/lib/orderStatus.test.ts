import { expect, test } from "vitest";
import { hasReport, isSettledSale } from "@/lib/orderStatus";

test("a report exists once an order was delivered, in either vault version", () => {
  expect(["delivered", "in_review", "settled", "rejected"].every((s) => hasReport(s as never))).toBe(true);
  expect(["open", "claimed", "declined", "reclaimed"].some((s) => hasReport(s as never))).toBe(false);
});

test("only a kept report is a settled sale", () => {
  expect(isSettledSale("delivered")).toBe(true);
  expect(isSettledSale("settled")).toBe(true);
  expect(isSettledSale("in_review")).toBe(false);
  expect(isSettledSale("rejected")).toBe(false);
});
