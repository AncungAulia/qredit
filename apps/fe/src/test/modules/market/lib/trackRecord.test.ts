import { expect, test } from "vitest";
import { buyersText, rejectionBps, rejectionText } from "@/modules/market/lib/trackRecord";

test("rejection rate is rejected over delivered reports", () => {
  expect(rejectionBps({ delivered: 8, rejected: 1, uniqueBuyers: 3 })).toBe(1250);
  expect(rejectionBps({ delivered: 0, rejected: 0, uniqueBuyers: 0 })).toBeNull();
  expect(rejectionBps(undefined)).toBeNull();
  expect(rejectionText({ delivered: 8, rejected: 1, uniqueBuyers: 3 })).toBe("12.5% of 8 delivered reports rejected");
  expect(rejectionText({ delivered: 0, rejected: 0, uniqueBuyers: 0 })).toBe("No reports delivered yet");
  expect(rejectionText(undefined)).toBe("Not known yet");
});

test("unique buyers read as a count, or say the vault does not count them", () => {
  expect(buyersText(1)).toBe("1 buyer");
  expect(buyersText(3)).toBe("3 buyers");
  expect(buyersText(null)).toBe("Not counted by this vault");
});

test("the Buyers term joins buyers and rejected reports", async () => {
  const { buyersTerm } = await import("@/modules/market/lib/trackRecord");
  expect(buyersTerm({ delivered: 8, rejected: 1, uniqueBuyers: 14 })).toBe("14 different buyers, 1 report rejected");
  expect(buyersTerm({ delivered: 8, rejected: 0, uniqueBuyers: 1 })).toBe("1 buyer, no report rejected");
  expect(buyersTerm({ delivered: 8, rejected: 2, uniqueBuyers: 3 })).toBe("3 different buyers, 2 reports rejected");
  expect(buyersTerm(undefined)).toBe("Not known yet");
});
