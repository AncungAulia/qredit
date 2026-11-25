import { render, screen, within } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import type { Business, Order } from "@/lib/schemas";
import { useDesktopViewport } from "@/test/helpers/wallet";

const wallet = vi.hoisted(() => ({
  session: { kind: "none" } as Record<string, unknown>,
  hydrated: true,
}));
vi.mock("@/modules/wallet/WalletProvider", () => ({
  useWallet: (select: (s: unknown) => unknown) => select({ session: wallet.session, hydrated: wallet.hydrated }),
  useWalletApi: () => ({}),
}));
vi.mock("@/modules/wallet/components/ConnectPrompt", () => ({
  ConnectPrompt: () => <button type="button">Connect prompt</button>,
}));
vi.mock("@/modules/wallet/components/RequireReadyWallet", () => ({
  useWalletReadiness: () => ({ state: "ready", refetch: vi.fn() }),
  SetupGate: () => <p>setup gate</p>,
}));

const market = vi.hoisted(() => ({ data: [] as unknown[] | undefined, isError: false }));
vi.mock("@/modules/market", async (orig) => ({
  ...(await orig<object>()),
  useMarketQuery: () => ({ ...market, refetch: vi.fn() }),
}));

const orders = vi.hoisted(() => ({
  data: undefined as unknown[] | undefined,
  isError: false,
  isRefetchError: false,
  refetch: vi.fn(),
}));
const times = vi.hoisted(() => ({ data: undefined as Record<number, Date> | undefined }));
const reclaimFn = vi.hoisted(() => vi.fn());
vi.mock("@/modules/inbox/api/useInbox", () => ({
  useMyOrdersQuery: () => orders,
  useOrderTimesQuery: () => times,
  useInboxActions: () => ({ reclaim: reclaimFn }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { InboxPage } from "@/modules/inbox/components/InboxPage";

const ME = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const business = { slug: "counterparty-check", name: "Counterparty Check", vault: "0x37bbb37dd96a973a22ca64bc809a8bc4d54b03d4", services: [{ id: 1, name: "Counterparty risk grade", priceUnits: 250_000n }] } as unknown as Business;
const FUTURE = new Date(Date.now() + 3_600_000);
const PAST = new Date(Date.now() - 3_600_000);

const order = (orderId: string, status: Order["status"], price: number, deadline: Date, block: number) =>
  ({ ...({} as Order), vault: business.vault, orderId, buyer: ME.toLowerCase(), serviceId: 1, price: BigInt(price), status, deadline, placedBlock: block, business }) as Order & { business: Business };

beforeEach(() => {
  useDesktopViewport();
  vi.clearAllMocks();
  wallet.session = { kind: "test", evm: ME, address: "qor1x" };
  wallet.hydrated = true;
  market.data = [{ business }];
  market.isError = false;
  orders.data = undefined;
  orders.isError = false;
  orders.isRefetchError = false;
  times.data = undefined;
});

test("without a wallet the inbox asks for one and offers the connect button", () => {
  wallet.session = { kind: "none" };
  render(<InboxPage />);
  expect(screen.getByRole("heading", { name: "Connect a wallet to see your reports" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Connect prompt" })).toBeInTheDocument();
});

test("QoreX alone cannot open reports, and the page says so", () => {
  wallet.session = { kind: "qorex", evm: ME, address: "qor1x", testWallet: null };
  render(<InboxPage />);
  expect(screen.getByRole("heading", { name: "Use a test wallet to see your reports" })).toBeInTheDocument();
  expect(screen.getByText(/QoreX cannot open sealed reports/)).toBeInTheDocument();
});

test("a locked wallet is asked to unlock", () => {
  wallet.session = { kind: "locked", address: "qor1x" };
  render(<InboxPage />);
  expect(screen.getByRole("heading", { name: "Unlock your wallet to see your reports" })).toBeInTheDocument();
});

test("before the wallet storage is read the page shows a skeleton, not the connect state", () => {
  wallet.hydrated = false;
  render(<InboxPage />);
  expect(screen.getByRole("status")).toHaveAttribute("aria-busy", "true");
  expect(screen.queryByText("Connect a wallet to see your reports")).not.toBeInTheDocument();
});

test("while the orders load the figures and rows are skeletons", () => {
  render(<InboxPage />);
  expect(screen.getByRole("status")).toHaveAttribute("aria-busy", "true");
});

test("a failed load shows the error with a retry", () => {
  orders.isError = true;
  render(<InboxPage />);
  expect(screen.getByRole("alert")).toHaveTextContent("Your orders could not be loaded.");
  screen.getByRole("button", { name: "Try again" }).click();
  expect(orders.refetch).toHaveBeenCalled();
});

test("a buyer with no orders sees the empty state and a link to the market", () => {
  orders.data = [];
  render(<InboxPage />);
  expect(screen.getByRole("heading", { name: "No reports yet" })).toBeInTheDocument();
  expect(screen.getByText("Reports you purchase will appear here, sealed to your key.")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Browse the market" })).toHaveAttribute("href", "/");
});

test("each order shows its status, price and the action it allows, and the figures add up", () => {
  orders.data = [
    order("21", "delivered", 250_000, FUTURE, 300),
    order("19", "open", 1_000_000, FUTURE, 290),
    order("17", "declined", 250_000, FUTURE, 280),
    order("15", "open", 1_000_000, PAST, 270),
    order("14", "reclaimed", 500_000, PAST, 260),
  ];
  times.data = { 300: new Date(Date.now() - 120_000) };
  render(<InboxPage />);

  const rows = screen.getAllByRole("listitem");
  expect(rows).toHaveLength(5);
  const [r21, r19, r17, r15, r14] = rows.map((r) => within(r));

  expect(r21.getByText("Delivered")).toBeInTheDocument();
  expect(r21.getByRole("link", { name: "Open report" })).toHaveAttribute("href", `/inbox/${business.vault}/21`);
  expect(r21.getByText(/Order 21, 2 minutes ago/)).toBeInTheDocument();
  expect(r21.getByText("0.25 fUSD")).toBeInTheDocument();

  expect(r19.getByText("Pending")).toBeInTheDocument();
  expect(r19.queryByRole("button")).not.toBeInTheDocument();
  expect(r19.getByText(/Order 19$/)).toBeInTheDocument();

  expect(r17.getByText("Declined")).toBeInTheDocument();

  expect(r15.getByText("Late, reclaim available")).toBeInTheDocument();
  expect(r15.getByRole("button", { name: "Reclaim" })).toBeInTheDocument();

  expect(r14.getByText("Reclaimed")).toBeInTheDocument();
  expect(r14.queryByRole("button")).not.toBeInTheDocument();

  const kpi = (label: string) => screen.getByText(label).parentElement as HTMLElement;
  expect(kpi("Ready to open")).toHaveTextContent("1");
  expect(kpi("Waiting for delivery")).toHaveTextContent("2");
  expect(kpi("Spent in total")).toHaveTextContent("0.25");
  expect(kpi("Refunded to you")).toHaveTextContent("0.75");
});

test("a late order is reclaimed only after a confirmation, from the test wallet", async () => {
  orders.data = [order("15", "open", 1_000_000, PAST, 270)];
  reclaimFn.mockResolvedValue(`0x${"ab".repeat(32)}`);
  render(<InboxPage />);
  screen.getByRole("button", { name: "Reclaim" }).click();
  const dialog = await screen.findByRole("alertdialog");
  expect(within(dialog).getByText(/did not deliver order 15 before its deadline/)).toBeInTheDocument();
  expect(reclaimFn).not.toHaveBeenCalled();
  within(dialog).getByRole("button", { name: /Reclaim 1.00 fUSD/ }).click();
  await vi.waitFor(() => expect(reclaimFn).toHaveBeenCalledWith(business.vault, "15"));
});

test("QoreX with a test wallet nested under it reads the inbox of the test wallet", () => {
  wallet.session = { kind: "qorex", evm: "0x0000000000000000000000000000000000000001", address: "qor1q", testWallet: { kind: "test", evm: ME, address: "qor1x" } };
  orders.data = [];
  render(<InboxPage />);
  expect(screen.getByRole("heading", { name: "No reports yet" })).toBeInTheDocument();
});
