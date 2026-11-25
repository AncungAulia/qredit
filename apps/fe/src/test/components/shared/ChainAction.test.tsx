import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, test, vi } from "vitest";
import { ChainAction, ChainActionStatus } from "@/components/shared/ChainAction";
import { TxFailed, TxReverted } from "@/modules/wallet/signer";
import { useDesktopViewport } from "@/test/helpers/wallet";

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

const NEXT = { text: "Check My lending before lending again.", label: "Open My lending", href: "/lend" };
const HASH = "0x1111111111111111111111111111111111111111111111111111111111111111";

beforeEach(() => {
  useDesktopViewport();
  toast.success.mockClear();
  toast.error.mockClear();
});

test("status: waiting for the wallet and waiting for the chain", () => {
  const { rerender } = render(<ChainActionStatus phase="wallet" pendingLabel="Lending 500 fUSD" walletPrompt />);
  expect(screen.getByText("Confirm in your wallet")).toBeInTheDocument();
  rerender(<ChainActionStatus phase="chain" pendingLabel="Lending 500 fUSD" />);
  expect(screen.getByText("Lending 500 fUSD")).toBeInTheDocument();
  expect(screen.queryByText(/taking longer/i)).not.toBeInTheDocument();
});

test("status: the wallet phase shows the current step and never claims a wallet prompt", () => {
  const { rerender } = render(<ChainActionStatus phase="wallet" pendingLabel="Claiming 5 fUSD" progress="Opening the payment window" />);
  expect(screen.getByText("Opening the payment window")).toBeInTheDocument();
  rerender(<ChainActionStatus phase="wallet" pendingLabel="Claiming 5 fUSD" />);
  expect(screen.getByText("Claiming 5 fUSD")).toBeInTheDocument();
  rerender(<ChainActionStatus phase="wallet" />);
  expect(screen.queryByText("Confirm in your wallet")).not.toBeInTheDocument();
  rerender(<ChainActionStatus phase="chain" progress="Allowing the vault to take fUSD" pendingLabel="Lending 5 fUSD" />);
  expect(screen.getByText("Allowing the vault to take fUSD")).toBeInTheDocument();
});

test("useChainAction shows the reported steps, the same ones on a retry, and clears them on reset", async () => {
  const user = userEvent.setup();
  const gate: { release?: () => void } = {};
  let attempt = 0;
  const run = vi.fn(async (ctl: { sent(): void; progress(label: string): void }) => {
    attempt += 1;
    ctl.progress("Opening the payment window");
    await new Promise<void>((r) => (gate.release = r));
    ctl.progress("Lending 5 fUSD");
    ctl.sent();
    if (attempt === 1) throw new TxReverted(null, "The raise is already full.");
    return HASH;
  });
  render(
    <ChainAction
      nextStep={NEXT}
      open
      onOpenChange={vi.fn()}
      title="Lend?"
      body="Body"
      confirmLabel="Lend"
      pendingLabel="Lending"
      successTitle="Lent"
      run={run}
    />,
  );
  await user.click(screen.getByRole("button", { name: "Lend" }));
  expect(await screen.findByText("Opening the payment window")).toBeInTheDocument();
  gate.release!();
  await screen.findByText("The raise is already full.");
  await user.click(screen.getByRole("button", { name: "Try again" }));
  expect(await screen.findByText("Opening the payment window")).toBeInTheDocument();
  expect(screen.queryByText("Lending 5 fUSD")).not.toBeInTheDocument();
  expect(screen.queryByText("Confirm in your wallet")).not.toBeInTheDocument();
  gate.release!();
});

test("status: a QoreX prompt still says to confirm in the wallet", () => {
  render(<ChainActionStatus phase="wallet" progress="Opening the payment window" walletPrompt />);
  expect(screen.getByText("Confirm in your wallet")).toBeInTheDocument();
});

test("status: a slow chain says the money is safe", () => {
  render(<ChainActionStatus phase="chain" pendingLabel="Lending 500 fUSD" slow />);
  expect(screen.getByText("The chain is taking longer than usual. Your funds are safe.")).toBeInTheDocument();
});

test("status: refused shows the mapped sentence, never raw data", () => {
  render(<ChainActionStatus phase="refused" reason="This amount would raise more than the loan target." />);
  expect(screen.getByRole("alert")).toHaveTextContent("This amount would raise more than the loan target.");
});

test("status: done shows the transaction link", () => {
  render(<ChainActionStatus phase="done" hash={HASH} />);
  expect(screen.getByText("0x1111…1111")).toBeInTheDocument();
});

test("confirm, wallet, chain, done: the dialog closes and a toast carries the transaction", async () => {
  const user = userEvent.setup();
  let sent!: () => void;
  let finish!: (hash: string) => void;
  const run = vi.fn(
    (ctl: { sent(): void }) =>
      new Promise<string>((resolve) => {
        sent = ctl.sent;
        finish = resolve;
      }),
  );
  const onOpenChange = vi.fn();
  const onDone = vi.fn();
  render(
    <ChainAction
      nextStep={NEXT}
      open
      onOpenChange={onOpenChange}
      title="Lend 500 fUSD to Counterparty Check?"
      body="Your fUSD is locked until the loan is repaid."
      confirmLabel="Lend 500 fUSD"
      pendingLabel="Lending 500 fUSD"
      successTitle="Lent 500 fUSD"
      run={run}
      onDone={onDone}
    />,
  );
  expect(screen.getByText("Lend 500 fUSD to Counterparty Check?")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Lend 500 fUSD" }));
  expect(await screen.findByText("Lending 500 fUSD")).toBeInTheDocument();
  expect(screen.queryByText("Confirm in your wallet")).not.toBeInTheDocument();
  // The dialog never closes while the chain is still deciding.
  await user.keyboard("{Escape}");
  expect(onOpenChange).not.toHaveBeenCalledWith(false);
  sent();
  expect(await screen.findByText("Lending 500 fUSD")).toBeInTheDocument();
  finish(HASH);
  await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  expect(onDone).toHaveBeenCalledWith(HASH);
  expect(toast.success).toHaveBeenCalledWith("Lent 500 fUSD", expect.anything());
});

test("a refused transaction stays in the dialog with the reason", async () => {
  const user = userEvent.setup();
  const onOpenChange = vi.fn();
  render(
    <ChainAction
      nextStep={NEXT}
      open
      onOpenChange={onOpenChange}
      title="Lend 500 fUSD?"
      body="Body"
      confirmLabel="Lend"
      pendingLabel="Lending"
      successTitle="Lent"
      run={() => Promise.reject(new TxReverted(null, "The raise is already full."))}
    />,
  );
  await user.click(screen.getByRole("button", { name: "Lend" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("The raise is already full.");
  expect(onOpenChange).not.toHaveBeenCalledWith(false);
  expect(toast.success).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "Close" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
});

test("try again after a refusal runs the action again", async () => {
  const user = userEvent.setup();
  const run = vi
    .fn()
    .mockRejectedValueOnce(new TxReverted(null, "The raise is already full."))
    .mockResolvedValueOnce(HASH);
  render(
    <ChainAction nextStep={NEXT} open onOpenChange={vi.fn()} title="T" body="B" confirmLabel="Lend" pendingLabel="Lending" successTitle="Lent" run={run} />,
  );
  await user.click(screen.getByRole("button", { name: "Lend" }));
  await user.click(await screen.findByRole("button", { name: "Try again" }));
  await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Lent", expect.anything()));
  expect(run).toHaveBeenCalledTimes(2);
});

test("an unknown failure shows a plain sentence, not the error text", async () => {
  const user = userEvent.setup();
  render(
    <ChainAction
      nextStep={NEXT}
      open
      onOpenChange={vi.fn()}
      title="T"
      body="B"
      confirmLabel="Go"
      pendingLabel="Going"
      successTitle="Went"
      run={() => Promise.reject(new Error("0xdeadbeef raw revert data"))}
    />,
  );
  await user.click(screen.getByRole("button", { name: "Go" }));
  const alert = await screen.findByRole("alert");
  expect(alert).not.toHaveTextContent("0xdeadbeef");
  expect(alert).toHaveTextContent("The transaction could not be completed.");
});

const renderRun = (error: unknown, nextStep = NEXT) =>
  render(
    <ChainAction
      open
      onOpenChange={vi.fn()}
      title="T"
      body="B"
      confirmLabel="Go"
      pendingLabel="Going"
      successTitle="Went"
      nextStep={nextStep}
      run={() => Promise.reject(error)}
    />,
  );

test("a send that could not be confirmed offers no retry, only the transaction and the next step", async () => {
  const user = userEvent.setup();
  renderRun(new TxFailed(HASH as `0x${string}`, "The transaction was sent but was not confirmed in time."));
  await user.click(screen.getByRole("button", { name: "Go" }));
  const alert = await screen.findByRole("alert");
  expect(alert).toHaveTextContent("not confirmed in time");
  expect(alert).toHaveTextContent("0x1111…1111");
  expect(alert).toHaveTextContent(NEXT.text);
  expect(screen.getByRole("link", { name: NEXT.label })).toHaveAttribute("href", "/lend");
  expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Close" })).toBeInTheDocument();
});

test("a reverted transaction moved no funds, so it can be tried again", async () => {
  const user = userEvent.setup();
  renderRun(new TxReverted(HASH as `0x${string}`, "The raise is already full."));
  await user.click(screen.getByRole("button", { name: "Go" }));
  await screen.findByRole("alert");
  expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  expect(screen.queryByRole("link", { name: NEXT.label })).not.toBeInTheDocument();
});

test("a failure before any send (no hash) can be tried again", async () => {
  const user = userEvent.setup();
  renderRun(new TxFailed(null, "The transaction could not be sent."));
  await user.click(screen.getByRole("button", { name: "Go" }));
  await screen.findByRole("alert");
  expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
});
