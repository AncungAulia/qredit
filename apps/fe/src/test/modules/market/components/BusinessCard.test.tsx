import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { BusinessCard } from "@/modules/market/components/BusinessCard";

const entry = (unverified: boolean | null, state = "Active") =>
  ({
    business: {
      slug: "counterparty-check", vault: "0x1", name: "Counterparty Check", tagline: "t", services: [{ id: 0, name: "Grade", priceUnits: 250_000n }],
      operator: "0x2", spender: "0x3", startBlock: 1, version: 2, ended: null, stats: { delivered: 8, rejected: 1, uniqueBuyers: 3 },
    },
    vault: {
      state, raised: 50_000_000n, repaid: 0n, target: 50_000_000n, totalOwed: 55_000_000n, installment: 1_000_000n, period: 86_400n,
      raiseDeadline: new Date(0), lenderBps: 3000, paused: false, version: 2, bondHeld: 5_000_000n, swept: 0n, uniqueBuyers: 3, maturityAt: null,
    },
    orders: [], ordersDelivered: 8, deliveredCapped: false, unverified,
  }) as never;

test("the card shows the bond, the buyers and the rejection rate", () => {
  render(<BusinessCard entry={entry(false)} />);
  expect(screen.getByText("5.00 fUSD")).toBeInTheDocument();
  expect(screen.getByText("3 buyers")).toBeInTheDocument();
  expect(screen.getByText("12.5%")).toBeInTheDocument();
  expect(screen.queryByText("Unverified suppliers")).toBeNull();
});

test("a business paying a supplier outside the Qredit list is labelled", () => {
  render(<BusinessCard entry={entry(true)} />);
  expect(screen.getByText("Unverified suppliers")).toBeInTheDocument();
});

test("an ended business card shows its red badge and View", () => {
  render(<BusinessCard entry={entry(false, "Defaulted")} />);
  expect(screen.getByText("Defaulted")).toBeInTheDocument();
  expect(screen.getByText("View")).toBeInTheDocument();
});
