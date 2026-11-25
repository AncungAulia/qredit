import { render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { ActivityTable } from "@/modules/business/components/ActivityTable";
import { BusinessKpis } from "@/modules/business/components/BusinessKpis";
import { DecisionLog } from "@/modules/business/components/DecisionLog";
import { supplierName } from "@/modules/business/lib/supplierNames";
import { SUPPLIERS } from "@qredit/qore";

const business = {
  slug: "a",
  vault: "0x1",
  name: "A",
  tagline: "t",
  services: [{ id: 0, name: "Grade", priceUnits: 250000n }],
  operator: "0x2",
  spender: "0x3",
  startBlock: 1,
} as never;
const order = {
  vault: "0x1",
  orderId: "1",
  buyer: "0x9999999999999999999999999999999999999999",
  serviceId: 0,
  price: 250000n,
  requestRef: "0x0",
  deadline: new Date(0),
  status: "delivered",
  placedTx: "0xabc",
  placedBlock: 5,
  envelopeHash: null,
} as never;
const decision = {
  id: 1,
  vault: "0x1",
  orderId: "1",
  decision: "delivered",
  reason: "sealed",
  suppliers: [],
  cost: 0n,
  createdAt: new Date(),
} as never;
const vault = {
  state: "Active",
  raised: 1n,
  repaid: 1n,
  paused: false,
  lenderBps: 7000,
  target: 1n,
  totalOwed: 2n,
  installment: 1n,
  period: 3600n,
  raiseDeadline: new Date(0),
} as never;

test("orders that were loaded stay on screen when a refresh fails", () => {
  render(<ActivityTable business={business} orders={[order]} isError onRetry={vi.fn()} />);
  expect(screen.getByText("Grade")).toBeInTheDocument();
  expect(screen.queryByText("The orders could not be loaded.")).not.toBeInTheDocument();
});

test("the order error shows only when there is nothing to show", () => {
  render(<ActivityTable business={business} orders={undefined} isError onRetry={vi.fn()} />);
  expect(screen.getByText("The orders could not be loaded.")).toBeInTheDocument();
});

test("decisions that were loaded stay on screen when a refresh fails", () => {
  render(<DecisionLog decisions={[decision]} isError onRetry={vi.fn()} raising={false} />);
  expect(screen.getByText("Delivered order 1")).toBeInTheDocument();
  expect(screen.queryByText("The decision log could not be loaded.")).not.toBeInTheDocument();
});

test("the delivered count says it covers the newest orders when the list hit the limit", () => {
  const { rerender } = render(<BusinessKpis vault={vault} delivered={42} ordersCapped />);
  expect(screen.getByText("in the latest 100 orders")).toBeInTheDocument();
  rerender(<BusinessKpis vault={vault} delivered={42} ordersCapped={false} />);
  expect(screen.queryByText(/latest 100 orders/)).not.toBeInTheDocument();
});

test("a testnet supplier address has a name, any other has none", () => {
  expect(supplierName(SUPPLIERS.dataIndexer.toUpperCase().replace("0X", "0x"))).toBe(
    "Data indexer",
  );
  expect(supplierName("0x0000000000000000000000000000000000000001")).toBeUndefined();
});
