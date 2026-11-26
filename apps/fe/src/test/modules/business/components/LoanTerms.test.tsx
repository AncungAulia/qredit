import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { LoanTerms } from "@/modules/business/components/LoanTerms";
import type { VaultSnapshot } from "@/modules/market";

const v2: VaultSnapshot = {
  state: "Active", raised: 50_000_000n, repaid: 1_000_000n, target: 50_000_000n, totalOwed: 55_000_000n, installment: 1_000_000n,
  period: 86_400n, raiseDeadline: new Date("2026-12-10T00:00:00Z"), lenderBps: 3000, paused: false,
  version: 2, bondHeld: 5_000_000n, swept: 0n, uniqueBuyers: 3, maturityAt: new Date("2027-01-20T12:00:00Z"),
  maturityGrace: 259_200, defaultAfterMissed: 3,
};
const stats = { delivered: 20, rejected: 1, uniqueBuyers: 14 };

test("a v2 loan shows the bond, the maturity date, the default rule and the buyers", () => {
  render(<LoanTerms vault={v2} stats={stats} />);
  expect(screen.getByText("5.00 fUSD held, 10% of the loan")).toBeInTheDocument();
  expect(screen.getByText("20 Jan 2027, 12:00 UTC")).toBeInTheDocument();
  expect(screen.getByText("After 3 missed installments or 3 days past maturity")).toBeInTheDocument();
  expect(screen.getByText("14 different buyers, 1 report rejected")).toBeInTheDocument();
});

test("an ended loan says the bond went to lenders", () => {
  render(<LoanTerms vault={{ ...v2, state: "Defaulted", bondHeld: 0n }} />);
  expect(screen.getByText("Moved to lenders when the loan ended")).toBeInTheDocument();
});

test("a v1 loan shows no bond row", () => {
  render(<LoanTerms vault={{ ...v2, version: 1, bondHeld: 0n, uniqueBuyers: null, maturityAt: null }} />);
  expect(screen.queryByText("Owner bond")).toBeNull();
});
