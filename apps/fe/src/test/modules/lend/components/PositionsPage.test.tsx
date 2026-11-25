import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, test, vi } from "vitest";
import type { Business } from "@/lib/schemas";
import type { Position } from "@/modules/lend/api/lend.api";
import { useDesktopViewport } from "@/test/helpers/wallet";

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

const wallet = vi.hoisted(() => ({
  session: { kind: "none" } as { kind: string; evm?: string; address?: string; testWallet?: null },
  hydrated: true,
}));
vi.mock("@/modules/wallet/WalletProvider", () => ({
  useWallet: (select: (s: unknown) => unknown) => select({ session: wallet.session, hydrated: wallet.hydrated }),
  useWalletApi: () => ({}),
}));
vi.mock("@/modules/wallet/components/ConnectPrompt", () => ({
  ConnectPrompt: ({ label }: { label?: string }) => <button type="button">{label ?? "Connect wallet"}</button>,
}));

const market = vi.hoisted(() => ({ data: [] as unknown[] | undefined, isError: false }));
vi.mock("@/modules/market", async (orig) => ({
  ...(await orig<object>()),
  useMarketQuery: () => ({ ...market, refetch: vi.fn() }),
}));

const positions = vi.hoisted(() => ({
  data: undefined as unknown[] | undefined,
  isError: false,
  isRefetchError: false,
  refetch: vi.fn(),
}));
const claimFn = vi.hoisted(() => vi.fn());
const refundFn = vi.hoisted(() => vi.fn());
vi.mock("@/modules/lend/api/useLend", () => ({
  usePositionsQuery: () => positions,
  useLendActions: () => ({ lend: vi.fn(), claim: claimFn, refund: refundFn }),
}));

import { PositionsPage } from "@/modules/lend/components/PositionsPage";

const fusd = (n: number) => BigInt(Math.round(n * 100)) * 10_000n;
const business = (slug: string, name: string) =>
  ({ slug, name, tagline: `${name} tagline`, vault: `0x${slug.padEnd(40, "0")}` }) as unknown as Business;
const position = (
  slug: string,
  name: string,
  state: Position["vault"]["state"],
  deposit: number,
  claimed: number,
  claimable: number,
): Position => ({
  business: business(slug, name),
  vault: { state } as Position["vault"],
  deposit: fusd(deposit),
  claimed: fusd(claimed),
  claimable: fusd(claimable),
});

beforeEach(() => {
  useDesktopViewport();
  vi.clearAllMocks();
  wallet.session = { kind: "test", evm: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" };
  wallet.hydrated = true;
  market.data = [{ business: business("a", "Counterparty Check") }];
  market.isError = false;
  positions.data = undefined;
  positions.isError = false;
  positions.isRefetchError = false;
});

test("before the browser storage is read the page shows its loading state, not a wrong one", () => {
  wallet.hydrated = false;
  render(<PositionsPage />);
  expect(screen.getByRole("heading", { name: "My lending" })).toBeInTheDocument();
  expect(screen.getByRole("status")).toHaveAttribute("aria-busy", "true");
  expect(screen.queryByText("Connect a wallet to see your loans")).not.toBeInTheDocument();
});

test("not connected: the designed state with a connect button", () => {
  wallet.session = { kind: "none" };
  render(<PositionsPage />);
  expect(screen.getByText("Connect a wallet to see your loans")).toBeInTheDocument();
  expect(screen.getByText("Qredit reads your positions from the chain. Nothing moves until you confirm a transaction.")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Connect wallet" })).toBeInTheDocument();
});

test("a locked wallet is not connected either", () => {
  wallet.session = { kind: "locked", address: "qor1x" };
  render(<PositionsPage />);
  expect(screen.getByText("Connect a wallet to see your loans")).toBeInTheDocument();
});

test("loading: skeletons while the positions are read", () => {
  render(<PositionsPage />);
  expect(screen.getByRole("status")).toHaveAttribute("aria-busy", "true");
});

test("a failed read shows the error with a retry", async () => {
  positions.isError = true;
  render(<PositionsPage />);
  await userEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(screen.getByText("Your loans could not be loaded.")).toBeInTheDocument();
  expect(positions.refetch).toHaveBeenCalled();
});

test("empty: nothing lent yet points to the market", () => {
  positions.data = [];
  render(<PositionsPage />);
  expect(screen.getByText("You have not lent yet")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Browse the market" })).toHaveAttribute("href", "/");
});

test("list: figures sum over the positions and actions follow the state", () => {
  positions.data = [
    position("a", "Counterparty Check", "Active", 500, 151.2, 18.4),
    position("b", "Due Diligence", "Active", 300, 22.1, 4.1),
    position("c", "Sanctions Screen", "Repaid", 500, 550, 0),
    position("d", "Contract Auditor", "Raising", 200, 0, 0),
    position("e", "Failed Raise", "Refunded", 100, 0, 0),
  ];
  render(<PositionsPage />);
  // The tiles come before the rows, so the first match of a label is the tile.
  const kpi = (label: string) => screen.getAllByText(label)[0].parentElement!;
  expect(kpi("Claimable now")).toHaveTextContent("22.50");
  expect(kpi("Lent in total")).toHaveTextContent("1,600.00");
  expect(kpi("Repaid to you")).toHaveTextContent("723.30");
  expect(kpi("Active loans")).toHaveTextContent("3");
  expect(screen.getAllByRole("button", { name: /^Claim / })).toHaveLength(2);
  expect(screen.getByRole("button", { name: "Claim 18.40 fUSD" })).toBeInTheDocument();
  expect(screen.getAllByRole("button", { name: /^Refund/ })).toHaveLength(1);
  const raising = screen.getByText("Contract Auditor").closest("li")!;
  expect(within(raising).queryByRole("button")).not.toBeInTheDocument();
  expect(within(raising).getByText("Raising")).toBeInTheDocument();
});

test("claim asks first, then claims that vault, toasts and refreshes", async () => {
  const user = userEvent.setup();
  claimFn.mockResolvedValue("0x" + "c".repeat(64));
  positions.data = [position("a", "Counterparty Check", "Active", 500, 151.2, 18.4)];
  render(<PositionsPage />);
  await user.click(screen.getByRole("button", { name: "Claim 18.40 fUSD" }));
  expect(claimFn).not.toHaveBeenCalled();
  expect(screen.getByRole("alertdialog")).toHaveTextContent("Claim 18.40 fUSD");
  await user.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Claim 18.40 fUSD" }));
  await waitFor(() => expect(claimFn).toHaveBeenCalledWith(positions.data![0] && (positions.data![0] as Position).business.vault));
  await waitFor(() => expect(toast.success).toHaveBeenCalled());
});

test("refund asks first and refunds the whole deposit of a failed raise", async () => {
  const user = userEvent.setup();
  refundFn.mockResolvedValue("0x" + "d".repeat(64));
  positions.data = [position("e", "Failed Raise", "Refunded", 100, 0, 0)];
  render(<PositionsPage />);
  await user.click(screen.getByRole("button", { name: "Refund 100.00 fUSD" }));
  await user.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Refund 100.00 fUSD" }));
  await waitFor(() => expect(refundFn).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(toast.success).toHaveBeenCalled());
});

test("QoreX alone can read positions but cannot send, so the actions explain that", () => {
  wallet.session = { kind: "qorex", evm: "0x0000000000000000000000000000000000000001", testWallet: null };
  positions.data = [position("a", "Counterparty Check", "Active", 500, 151.2, 18.4)];
  render(<PositionsPage />);
  expect(screen.getByText("Counterparty Check")).toBeInTheDocument();
  expect(screen.getByText(/Claiming and refunds are sent from a test wallet/)).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /^Claim / })).not.toBeInTheDocument();
});
