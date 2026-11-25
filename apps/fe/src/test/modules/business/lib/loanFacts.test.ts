import { expect, test } from "vitest";
import {
  everyPeriod,
  lenderReturnBps,
  opexBps,
  roleLabel,
  splitText,
} from "@/modules/business/lib/loanFacts";

test("lender return is the extra owed over the target", () => {
  expect(lenderReturnBps(12_000_000_000n, 13_200_000_000n)).toBe(1000);
  expect(lenderReturnBps(0n, 5n)).toBe(0);
  expect(lenderReturnBps(10n, 10n)).toBe(0);
});

test("operating costs are what the lender and owner shares leave", () => {
  expect(opexBps(7000, 2000)).toBe(1000);
  expect(splitText(7000, 2000)).toBe("70% to lenders, 20% to the owner, 10% for operating costs");
});

test("a period reads as a sentence", () => {
  expect(everyPeriod(3600)).toBe("Every hour");
  expect(everyPeriod(172800)).toBe("Every 2 days");
});

test("a supplier role reads as words", () => {
  expect(roleLabel("dataIndexer")).toBe("data indexer");
});
