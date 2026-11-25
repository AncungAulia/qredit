import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, expect, test, vi } from "vitest";

const getMarket = vi.fn();
const getBlockTimes = vi.fn();
vi.mock("@/modules/market/api/market.api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/modules/market/api/market.api")>()),
  getMarket: () => getMarket(),
  getBlockTimes: (...a: unknown[]) => getBlockTimes(...a),
}));
let search = "";
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(search),
  usePathname: () => "/",
}));
import { MarketPage } from "@/modules/market/components/MarketPage";

let client: QueryClient;
const wrap = (ui: ReactNode) => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
};

const order = (tx: string, block: number, status: string) => ({
  vault: "0x1",
  orderId: tx,
  buyer: "0x9",
  serviceId: 0,
  price: 250000n,
  requestRef: "0x0",
  deadline: new Date(0),
  status,
  placedTx: tx,
  placedBlock: block,
  envelopeHash: null,
});

const entry = (
  slug: string,
  name: string,
  state: string,
  raised: bigint,
  repaid: bigint,
  orders: ReturnType<typeof order>[] = [],
) => ({
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
  ordersDelivered: orders.filter((o) => o.status === "delivered").length,
  deliveredCapped: orders.length >= 100,
  orders,
});

const failed = (slug: string, name: string) => ({
  business: { ...entry(slug, name, "Active", 0n, 0n).business },
  failed: true as const,
});

beforeEach(() => {
  vi.resetAllMocks();
  search = "";
  getBlockTimes.mockImplementation((blocks: number[]) =>
    Promise.resolve(Object.fromEntries(blocks.map((b) => [b, new Date(Date.now() - 120_000)]))),
  );
});

test("shows an error state with retry when the first load fails", async () => {
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

test("the description states no count of businesses", async () => {
  getMarket.mockResolvedValue([]);
  wrap(<MarketPage />);
  expect(screen.getByText(/^AI agent businesses on QoreChain\./)).toBeInTheDocument();
});

test("shows a card per business that links to its page", async () => {
  getMarket.mockResolvedValue([
    entry("counterparty-check", "Counterparty Check", "Active", 50_000_000n, 11_000_000n),
  ]);
  wrap(<MarketPage />);
  const link = await screen.findByRole("link", { name: /Counterparty Check/ });
  expect(link).toHaveAttribute("href", "/agents/counterparty-check");
  expect(screen.getByText("70% of sales")).toBeInTheDocument();
  expect(screen.getByText("None yet")).toBeInTheDocument();
});

test("an unreadable vault in a lone business shows the error state, not a guessed state", async () => {
  getMarket.mockRejectedValue(new Error("Unknown vault state 9"));
  wrap(<MarketPage />);
  expect(await screen.findByRole("alert")).toBeInTheDocument();
});

test("one failed business shows its own error while the others render", async () => {
  getMarket.mockResolvedValue([
    entry("a", "Alpha", "Active", 50_000_000n, 1n),
    failed("b", "Beta"),
  ]);
  wrap(<MarketPage />);
  expect(await screen.findByRole("link", { name: /Alpha/ })).toBeInTheDocument();
  expect(screen.getByText("This business could not be loaded.")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Try again to load Beta" })).toBeInTheDocument();
  expect(screen.queryByRole("link", { name: /Beta/ })).not.toBeInTheDocument();
  expect(screen.getByText(/leave out 1 business that could not be loaded/)).toBeInTheDocument();
});

test("a failed refresh keeps the data that was already shown", async () => {
  getMarket.mockResolvedValueOnce([entry("a", "Alpha", "Active", 50_000_000n, 1n)]);
  wrap(<MarketPage />);
  expect(await screen.findByRole("link", { name: /Alpha/ })).toBeInTheDocument();
  getMarket.mockRejectedValue(new Error("down"));
  await client.invalidateQueries({ queryKey: ["market"] });
  await waitFor(() => expect(getMarket).toHaveBeenCalledTimes(2));
  expect(screen.getByRole("link", { name: /Alpha/ })).toBeInTheDocument();
  expect(screen.queryByText("The market could not be loaded.")).not.toBeInTheDocument();
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

test("Active includes a loan that is behind schedule", async () => {
  getMarket.mockResolvedValue([
    entry("a", "Alpha", "Trapped", 50_000_000n, 1n),
    entry("b", "Beta", "Raising", 1n, 0n),
  ]);
  search = "state=active";
  wrap(<MarketPage />);
  expect(await screen.findByRole("link", { name: /Alpha/ })).toBeInTheDocument();
  expect(screen.queryByRole("link", { name: /Beta/ })).not.toBeInTheDocument();
});

test("a filter that matches nothing says so", async () => {
  getMarket.mockResolvedValue([entry("a", "Alpha", "Active", 50_000_000n, 1n)]);
  search = "state=repaid";
  wrap(<MarketPage />);
  expect(await screen.findByText("No business matches Repaid.")).toBeInTheDocument();
});

test("latest orders list each order once with its time, price and transaction", async () => {
  getMarket.mockResolvedValue([
    entry("a", "Alpha", "Active", 50_000_000n, 1n, [
      order("0xaaaa00000000000000000000000000000000000000000000000000000000bbbb", 10, "delivered"),
    ]),
  ]);
  wrap(<MarketPage />);
  const section = (await screen.findByRole("region", { name: "Latest orders" })) as HTMLElement;
  expect(await within(section).findByText("Grade")).toBeInTheDocument();
  expect(within(section).getByText("2 minutes ago")).toBeInTheDocument();
  expect(within(section).getByText("0.25 fUSD")).toBeInTheDocument();
  expect(within(section).getByText("Delivered")).toBeInTheDocument();
  expect(within(section).getAllByText("Grade")).toHaveLength(1);
});

test("an order that changes status shows the new status, not the cached one", async () => {
  const tx = "0xaaaa00000000000000000000000000000000000000000000000000000000bbbb";
  getMarket.mockResolvedValueOnce([
    entry("a", "Alpha", "Active", 50_000_000n, 1n, [order(tx, 10, "open")]),
  ]);
  wrap(<MarketPage />);
  expect(await screen.findByText("Pending")).toBeInTheDocument();
  getMarket.mockResolvedValue([
    entry("a", "Alpha", "Active", 50_000_000n, 1n, [order(tx, 10, "delivered")]),
  ]);
  await client.invalidateQueries({ queryKey: ["market"] });
  expect(await screen.findByText("Delivered")).toBeInTheDocument();
  expect(screen.queryByText("Pending")).not.toBeInTheDocument();
});

test("latest orders show their own empty state when there are no orders", async () => {
  getMarket.mockResolvedValue([entry("a", "Alpha", "Active", 50_000_000n, 1n)]);
  wrap(<MarketPage />);
  expect(await screen.findByText("No orders have been placed yet.")).toBeInTheDocument();
});

test("latest orders show their own error with retry when the block times fail", async () => {
  getMarket.mockResolvedValue([
    entry("a", "Alpha", "Active", 50_000_000n, 1n, [order("0xabc", 10, "delivered")]),
  ]);
  getBlockTimes.mockRejectedValue(new Error("rpc down"));
  wrap(<MarketPage />);
  expect(await screen.findByText("The latest orders could not be loaded.")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /Alpha/ })).toBeInTheDocument();
});

test("a business with a full order list says at least, and the KPI names the limit", async () => {
  const full = Array.from({ length: 100 }, (_, i) => order(`0x${i}`, i, "delivered"));
  getMarket.mockResolvedValue([entry("a", "Alpha", "Active", 50_000_000n, 1n, full)]);
  wrap(<MarketPage />);
  expect(await screen.findByText("At least 100 delivered")).toBeInTheDocument();
  expect(screen.getByText("in the latest 100 orders per business")).toBeInTheDocument();
});

test("a short order list states the plain count", async () => {
  getMarket.mockResolvedValue([entry("a", "Alpha", "Active", 50_000_000n, 1n, [order("0x1", 1, "delivered")])]);
  wrap(<MarketPage />);
  expect(await screen.findByText("1 delivered")).toBeInTheDocument();
  expect(screen.queryByText(/latest 100 orders/)).not.toBeInTheDocument();
});

test("the loading state is one status region", () => {
  getMarket.mockReturnValue(new Promise(() => {}));
  wrap(<MarketPage />);
  expect(screen.getAllByRole("status")).toHaveLength(1);
});
