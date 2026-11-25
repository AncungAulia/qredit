import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, expect, test, vi } from "vitest";

const getMarket = vi.fn();
const getLatestOrders = vi.fn();
vi.mock("@/modules/market/api/market.api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/modules/market/api/market.api")>()),
  getMarket: () => getMarket(),
  getLatestOrders: (...a: unknown[]) => getLatestOrders(...a),
}));
let search = "";
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(search),
  usePathname: () => "/",
}));
import { MarketPage } from "@/modules/market/components/MarketPage";

const wrap = (ui: ReactNode) =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      {ui}
    </QueryClientProvider>,
  );

const entry = (slug: string, name: string, state: string, raised: bigint, repaid: bigint) => ({
  business: {
    slug,
    vault: "0x1",
    name,
    tagline: `${name} tagline`,
    services: [{ id: 0, name: "Grade", priceUnits: 250000n }],
    operator: "0x2",
    spender: "0x3",
    startBlock: 1,
  },
  vault: {
    state,
    raised,
    repaid,
    target: 50_000_000n,
    totalOwed: 55_000_000n,
    installment: 1n,
    period: 1n,
    raiseDeadline: new Date(0),
    paused: false,
    lenderBps: 7000,
  },
  ordersDelivered: 2,
  orders: [],
});

beforeEach(() => {
  vi.clearAllMocks();
  search = "";
  getLatestOrders.mockResolvedValue([]);
});

test("shows an error state with retry when the load fails", async () => {
  getMarket.mockRejectedValue(new Error("down"));
  wrap(<MarketPage />);
  expect(await screen.findByRole("button", { name: "Try again" })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Market" })).toBeInTheDocument();
});

test("shows the empty state for no businesses", async () => {
  getMarket.mockResolvedValue([]);
  wrap(<MarketPage />);
  expect(await screen.findByText("No businesses are listed yet.")).toBeInTheDocument();
});

test("shows a card per business that links to its page", async () => {
  getMarket.mockResolvedValue([
    entry("counterparty-check", "Counterparty Check", "Active", 50_000_000n, 11_000_000n),
  ]);
  wrap(<MarketPage />);
  const link = await screen.findByRole("link", { name: /Counterparty Check/ });
  expect(link).toHaveAttribute("href", "/agents/counterparty-check");
  expect(screen.getByText("70% of sales")).toBeInTheDocument();
  expect(screen.getByText("2 delivered")).toBeInTheDocument();
});

test("an unreadable vault shows the error state, not a guessed state", async () => {
  getMarket.mockRejectedValue(new Error("Unknown vault state 9"));
  wrap(<MarketPage />);
  expect(await screen.findByRole("alert")).toBeInTheDocument();
});

test("the filter in the address narrows the list", async () => {
  getMarket.mockResolvedValue([
    entry("a", "Alpha", "Active", 50_000_000n, 1n),
    entry("b", "Beta", "Raising", 1n, 0n),
  ]);
  search = "state=raising";
  wrap(<MarketPage />);
  expect(await screen.findByRole("link", { name: /Beta/ })).toBeInTheDocument();
  expect(screen.queryByRole("link", { name: /Alpha/ })).not.toBeInTheDocument();
});

test("a filter that matches nothing says so", async () => {
  getMarket.mockResolvedValue([entry("a", "Alpha", "Active", 50_000_000n, 1n)]);
  search = "state=repaid";
  wrap(<MarketPage />);
  expect(await screen.findByText("No business matches Repaid.")).toBeInTheDocument();
});
