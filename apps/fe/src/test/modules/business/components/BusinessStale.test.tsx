import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";

const refetch = vi.fn();
let failing: string[] = [];
const q = (key: string, data: unknown) => ({
  data,
  isError: failing.includes(key),
  isRefetchError: failing.includes(key),
  refetch,
});
const business = {
  slug: "a",
  vault: "0x1",
  name: "Alpha",
  tagline: "t",
  services: [{ id: 0, name: "Grade", priceUnits: 250000n }],
  operator: "0x2",
  spender: "0x3",
  startBlock: 1,
};
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
};
const decision = {
  id: 1,
  vault: "0x1",
  orderId: "1",
  decision: "delivered",
  reason: "sealed",
  suppliers: [],
  cost: 0n,
  createdAt: new Date(),
};
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
};
vi.mock("@/modules/market", async (orig) => ({
  ...(await orig<object>()),
  useBusinessQuery: () => q("business", business),
  useVaultQuery: () => q("vault", vault),
  useOrdersQuery: () => q("orders", [order]),
}));
vi.mock("@/modules/business/api/useBusinessPage", () => ({
  useRulesQuery: () => q("rules", { dailyCap: 1n, suppliers: [] }),
  useDecisionsQuery: () => q("decisions", [decision]),
}));
vi.mock("@/modules/proof", () => ({ ProvenCard: () => null }));
vi.mock("@/modules/business/components/VaultRules", () => ({ VaultRules: () => <p>rules body</p> }));
import { BusinessPage } from "@/modules/business/components/BusinessPage";

const renderPage = () =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <BusinessPage slug="a" />
    </QueryClientProvider>,
  );

test("no notice while every refresh works", () => {
  failing = [];
  renderPage();
  expect(screen.queryByText(/could not be refreshed/)).not.toBeInTheDocument();
});

test.each(["vault", "rules", "orders", "decisions"])("a failed %s refresh keeps the data and shows a notice with retry", (key) => {
  failing = [key];
  renderPage();
  expect(screen.getAllByText(/could not be refreshed/)).toHaveLength(1);
  expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
});
