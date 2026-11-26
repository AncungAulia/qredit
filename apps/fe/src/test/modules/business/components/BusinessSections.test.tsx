import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";

const business = {
  slug: "counterparty-check",
  vault: "0x37bbb37dd96a973a22ca64bc809a8bc4d54b03d4",
  name: "Counterparty Check",
  tagline: "Is it safe to pay this address?",
  services: [{ id: 0, name: "Counterparty risk grade", priceUnits: 250000n }],
  operator: "0x2",
  spender: "0x3",
  startBlock: 1,
};
const vault = {
  state: "Active",
  raised: 12_000_000_000n,
  repaid: 3_780_000_000n,
  paused: false,
  lenderBps: 7000,
  target: 12_000_000_000n,
  totalOwed: 13_200_000_000n,
  installment: 1_000_000n,
  period: 3600n,
  raiseDeadline: new Date(0),
  uniqueBuyers: null,
};
const decision = {
  id: 1,
  vault: business.vault,
  orderId: "18",
  decision: "delivered",
  reason: "The report was sealed to the buyer.",
  suppliers: [{ role: "dataIndexer", amount: 50000n }],
  cost: 50000n,
  createdAt: new Date(),
};

vi.mock("@/modules/market", async (orig) => ({
  ...(await orig<object>()),
  useBusinessQuery: () => ({ data: business, isError: false }),
  useVaultQuery: () => ({ data: vault, isError: false, refetch: vi.fn() }),
  useOrdersQuery: () => ({ data: [], isError: false, refetch: vi.fn() }),
}));
vi.mock("@/modules/business/api/useBusinessPage", () => ({
  useRulesQuery: () => ({ data: undefined, isError: true, refetch: vi.fn() }),
  useUnverifiedQuery: () => undefined,
  useDecisionsQuery: () => ({ data: [decision], isError: false, refetch: vi.fn() }),
}));
import { BusinessPage } from "@/modules/business/components/BusinessPage";

test("a failed rules read shows an error in that section only", () => {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <BusinessPage slug="counterparty-check" />
    </QueryClientProvider>,
  );
  expect(screen.getByText("The spending rules could not be read.")).toBeInTheDocument();
  expect(screen.getByText("Delivered order 18")).toBeInTheDocument();
  expect(screen.getByText("Total owed to lenders")).toBeInTheDocument();
  expect(screen.getByText("No orders have been placed yet.")).toBeInTheDocument();
  expect(screen.getAllByText("Counterparty risk grade").length).toBeGreaterThan(0);
});
