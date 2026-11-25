import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, test, vi } from "vitest";
import type { Business } from "@/lib/schemas";
import type { VaultSnapshot } from "@/modules/market";
import { useDesktopViewport } from "@/test/helpers/wallet";

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

const wallet = vi.hoisted(() => ({ session: { kind: "none" } as { kind: string; evm?: string; testWallet?: null } }));
vi.mock("@/modules/wallet/WalletProvider", () => ({
  useWallet: (select: (s: unknown) => unknown) => select({ session: wallet.session, hydrated: true }),
  useWalletApi: () => ({}),
}));
vi.mock("@/modules/wallet/components/ConnectPrompt", () => ({
  ConnectPrompt: ({ label }: { label?: string }) => <button type="button">{label ?? "Connect wallet"}</button>,
}));

const ready = vi.hoisted(() => ({
  qor: 5n,
  fusdBank: 0n,
  fusd: 50n,
  pqcRegistered: true,
  kemRegistered: true,
  cardPublished: true,
}));
const status = vi.hoisted(() => ({ data: undefined as unknown, isPending: false, isError: false, refetch: vi.fn() }));
vi.mock("@/modules/wallet/api/useWalletStatus", () => ({ useWalletStatusQuery: () => status }));
vi.mock("@/modules/wallet/components/WalletSetup", () => ({ WalletSetup: () => <p>setup steps</p> }));

const balance = vi.hoisted(() => ({ data: 1_250_000_000n as bigint | undefined, isError: false }));
const lendFn = vi.hoisted(() => vi.fn());
vi.mock("@/modules/lend/api/useLend", () => ({
  useFusdBalanceQuery: () => ({ ...balance, refetch: vi.fn() }),
  useLendActions: () => ({ lend: lendFn, claim: vi.fn(), refund: vi.fn() }),
}));

import { RAISE_FULL_SENTENCE } from "@/modules/lend/api/lend.api";
import { LendSheet } from "@/modules/lend/components/LendSheet";
import { TxReverted } from "@/modules/wallet/signer";

const fusd = (n: number) => BigInt(n) * 1_000_000n;
const business = { slug: "contract-auditor", name: "Contract Auditor", vault: "0x1111111111111111111111111111111111111111" } as unknown as Business;
const vault: VaultSnapshot = {
  state: "Raising",
  raised: fusd(8400),
  target: fusd(12000),
  totalOwed: fusd(13200),
  repaid: 0n,
  installment: 0n,
  period: 0n,
  raiseDeadline: new Date("2027-01-14T00:00:00Z"),
  lenderBps: 7000,
  paused: false,
};

const open = (onOpenChange = vi.fn()) =>
  render(<LendSheet business={business} vault={vault} open onOpenChange={onOpenChange} />);

beforeEach(() => {
  useDesktopViewport();
  vi.clearAllMocks();
  wallet.session = { kind: "test", evm: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" };
  balance.data = fusd(1250);
  balance.isError = false;
  status.data = ready;
  status.isPending = false;
  status.isError = false;
});

test("a wallet that is not set up sees the setup state instead of the form, even with fUSD in the bank account", () => {
  status.data = { ...ready, fusdBank: 50_000_000n, fusd: 0n };
  balance.data = 0n;
  open();
  expect(screen.getByText("Finish setting up your wallet")).toBeInTheDocument();
  expect(screen.queryByLabelText("Amount")).not.toBeInTheDocument();
  expect(screen.queryByText("Your wallet holds no fUSD to lend.")).not.toBeInTheDocument();
});

test("the summary warns that the wallet may ask for two or three steps", () => {
  open();
  expect(screen.getByText("Your wallet may ask you to confirm two or three steps.")).toBeInTheDocument();
});

test("closing the form reports that nothing is in flight", async () => {
  const onBusyChange = vi.fn();
  const { LendForm } = await import("@/modules/lend/components/LendForm");
  const { unmount } = render(
    <LendForm business={business} vault={vault} evm="0x70997970C51812dc3A010C7d01b50e0d17dc79C8" onClose={vi.fn()} onBusyChange={onBusyChange} />,
  );
  unmount();
  expect(onBusyChange).toHaveBeenLastCalledWith(false);
});

test("enter amount: the summary follows the amount and the button names it", async () => {
  const user = userEvent.setup();
  open();
  expect(screen.getByText("Lend to Contract Auditor")).toBeInTheDocument();
  expect(screen.getByText("8,400.00 of 12,000.00 fUSD raised")).toBeInTheDocument();
  expect(screen.getByText("Your balance 1,250.00 fUSD")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /^Lend/ })).toBeDisabled();
  await user.type(screen.getByLabelText("Amount"), "500");
  expect(screen.getByRole("button", { name: "Lend 500.00 fUSD" })).toBeEnabled();
  const summary = screen.getByText("You will be repaid").parentElement!;
  expect(summary).toHaveTextContent("550.00 fUSD");
  expect(screen.getByText(/70% of every sale/)).toBeInTheDocument();
});

test("use maximum fills the smaller of the balance and the room", async () => {
  const user = userEvent.setup();
  open();
  await user.click(screen.getByRole("button", { name: "Use maximum" }));
  expect(screen.getByLabelText("Amount")).toHaveValue("1,250");
});

test("use maximum stops at the room left when the balance is larger", async () => {
  const user = userEvent.setup();
  balance.data = fusd(9000);
  open();
  await user.click(screen.getByRole("button", { name: "Use maximum" }));
  expect(screen.getByLabelText("Amount")).toHaveValue("3,600");
});

test("amount too high: the message gives the limit and the button stays disabled", async () => {
  const user = userEvent.setup();
  balance.data = fusd(9000);
  open();
  await user.type(screen.getByLabelText("Amount"), "5000");
  await user.tab();
  expect(await screen.findByText("This exceeds the 3,600.00 fUSD still available. Enter 3,600.00 fUSD or less.")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /^Lend/ })).toBeDisabled();
});

test("a wallet with no fUSD is told so", async () => {
  const user = userEvent.setup();
  balance.data = 0n;
  open();
  await user.type(screen.getByLabelText("Amount"), "1");
  await user.tab();
  expect(await screen.findByText("Your wallet holds no fUSD to lend.")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /^Lend/ })).toBeDisabled();
});

test("confirming lends the parsed amount, toasts and closes", async () => {
  const user = userEvent.setup();
  lendFn.mockResolvedValue({ depositTx: "0x" + "b".repeat(64) });
  const onOpenChange = vi.fn();
  open(onOpenChange);
  await user.type(screen.getByLabelText("Amount"), "500");
  await user.click(screen.getByRole("button", { name: "Lend 500.00 fUSD" }));
  await waitFor(() => expect(lendFn).toHaveBeenCalledWith(business.vault, fusd(500), expect.any(Function)));
  await waitFor(() => expect(toast.success).toHaveBeenCalled());
  expect(onOpenChange).toHaveBeenCalledWith(false);
});

test("raise is full: the refusal says nothing moved and offers the market", async () => {
  const user = userEvent.setup();
  lendFn.mockRejectedValue(new TxReverted(null, RAISE_FULL_SENTENCE));
  open();
  await user.type(screen.getByLabelText("Amount"), "500");
  await user.click(screen.getByRole("button", { name: "Lend 500.00 fUSD" }));
  expect(await screen.findByText("The raise is already full")).toBeInTheDocument();
  expect(screen.getByText(RAISE_FULL_SENTENCE)).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Back to the market" })).toHaveAttribute("href", "/");
});

test("another refusal shows its reason and a way to try again", async () => {
  const user = userEvent.setup();
  lendFn.mockRejectedValue(new TxReverted(null, "The fUSD balance is too low for this transaction."));
  open();
  await user.type(screen.getByLabelText("Amount"), "500");
  await user.click(screen.getByRole("button", { name: "Lend 500.00 fUSD" }));
  expect(await screen.findByText("The fUSD balance is too low for this transaction.")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
});

test("not connected: no amount field, a connect button instead", () => {
  wallet.session = { kind: "none" };
  open();
  expect(screen.queryByLabelText("Amount")).not.toBeInTheDocument();
  expect(screen.getByText("Connect a wallet to lend")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Connect wallet" })).toBeInTheDocument();
});

test("QoreX without a test wallet cannot send, and says why", () => {
  wallet.session = { kind: "qorex", evm: "0x0000000000000000000000000000000000000001", testWallet: null };
  open();
  expect(screen.queryByLabelText("Amount")).not.toBeInTheDocument();
  expect(screen.getByText("A test wallet is needed to lend")).toBeInTheDocument();
});
