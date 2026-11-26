import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, test, vi } from "vitest";
import { ApiError } from "@/lib/apiClient";
import type { Business, Order } from "@/lib/schemas";
import { useDesktopViewport } from "@/test/helpers/wallet";

const wallet = vi.hoisted(() => ({ session: { kind: "none" } as Record<string, unknown>, hydrated: true }));
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
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const ctx = vi.hoisted(() => ({ data: undefined as unknown, isError: false, error: null as unknown, refetch: vi.fn() }));
const delivery = vi.hoisted(() => ({ data: undefined as unknown, isError: false, error: null as unknown, refetch: vi.fn() }));
const deliveryArgs = vi.hoisted(() => vi.fn());
const openFn = vi.hoisted(() => vi.fn());
const reclaimFn = vi.hoisted(() => vi.fn());
vi.mock("@/modules/inbox/api/useInbox", () => ({
  useReportContextQuery: () => ctx,
  useDeliveryQuery: (...args: unknown[]) => {
    deliveryArgs(...args);
    return delivery;
  },
  useOpenReport: () => openFn,
  useInboxActions: () => ({ reclaim: reclaimFn }),
}));

import { ReportUnreadable } from "@qredit/qore";
import { DeliveryNotFound, ReportDoesNotMatch } from "@/modules/inbox/api/inbox.api";
import { ReportPage } from "@/modules/inbox/components/ReportPage";

const ME = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const VAULT = "0x37bbb37dd96a973a22ca64bc809a8bc4d54b03d4";
const HASH = `0x9f3c${"00".repeat(28)}41ab` as `0x${string}`;
const TX = `0x${"ab".repeat(32)}` as `0x${string}`;
const business = { slug: "counterparty-check", name: "Counterparty Check", vault: VAULT, services: [{ id: 1, name: "Counterparty risk grade", priceUnits: 250_000n }] } as unknown as Business;
const FUTURE = new Date(Date.now() + 3_600_000);
const PAST = new Date(Date.now() - 3_600_000);

const orderOf = (status: Order["status"], deadline = FUTURE) =>
  ({ vault: VAULT, orderId: "5", buyer: ME.toLowerCase(), serviceId: 1, price: 250_000n, status, deadline, placedBlock: 100, envelopeHash: HASH }) as unknown as Order;
const DELIVERY = { envelopeHash: HASH, deliveredTx: TX, blockNumber: 10_671_204, deliveredAt: new Date("2026-11-25T14:32:00Z"), text: "sealed" };
const REPORT = {
  v: 1,
  business: "counterparty-check",
  vault: VAULT,
  orderId: "5",
  serviceId: 1,
  subject: "0x70997970c51812dc3a010c7d01b50e0d17dc79c8",
  verdict: { label: "A", rule: "otherwise" },
  facts: { txSent: 1284, mldsaRegistered: true, possessionProven: true, listed: false, list: "demo-flags", listEntry: null },
  findings: ["ML-DSA-87 key registered: yes."],
  summary: "A short summary of the account.",
  notes: ["Activity is steady."],
  notice: "The flag list is synthetic demo data, not a real screening list.",
  generatedBy: "facts-only",
  suppliers: [],
  createdAt: "2026-11-25T14:30:00.000Z",
};

const stateOf = (status: Order["status"], deadline?: Date) => {
  ctx.data = { business, order: orderOf(status, deadline) };
};

beforeEach(() => {
  useDesktopViewport();
  vi.clearAllMocks();
  wallet.session = { kind: "test", evm: ME, address: "qor1x", sealKeys: {} };
  wallet.hydrated = true;
  ctx.data = undefined;
  ctx.isError = false;
  ctx.error = null;
  delivery.data = undefined;
  delivery.isError = false;
  delivery.error = null;
  openFn.mockReset();
});

test("while the order loads the page shows a skeleton", () => {
  render(<ReportPage vault={VAULT} orderId="5" />);
  expect(screen.getByRole("status")).toHaveAttribute("aria-busy", "true");
});

test("an order that is not in the list is a not found page", () => {
  ctx.isError = true;
  ctx.error = new ApiError("notFound", 404);
  render(<ReportPage vault={VAULT} orderId="5" />);
  expect(screen.getByRole("heading", { name: "This order does not exist." })).toBeInTheDocument();
});

test("a failed load shows the error with a retry", async () => {
  ctx.isError = true;
  ctx.error = new ApiError("server", 500);
  render(<ReportPage vault={VAULT} orderId="5" />);
  await userEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(ctx.refetch).toHaveBeenCalled();
});

test("an order the agent has not delivered says it is waiting", () => {
  stateOf("open");
  render(<ReportPage vault={VAULT} orderId="5" />);
  expect(screen.getByRole("heading", { name: "Waiting for the agent" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /Reclaim/ })).not.toBeInTheDocument();
});

test("a late open order offers the reclaim", () => {
  stateOf("open", PAST);
  render(<ReportPage vault={VAULT} orderId="5" />);
  expect(screen.getByRole("heading", { name: "This order is late" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /Reclaim 0.25 fUSD/ })).toBeInTheDocument();
});

test("a declined order says the payment came back", () => {
  stateOf("declined");
  render(<ReportPage vault={VAULT} orderId="5" />);
  expect(screen.getByRole("heading", { name: "The agent declined this order" })).toBeInTheDocument();
});

test("a delivered order is checked against the chain first", () => {
  stateOf("delivered");
  render(<ReportPage vault={VAULT} orderId="5" />);
  expect(screen.getByText("Checking the delivery")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Open report" })).not.toBeInTheDocument();
});

test("sealed: the delivery and the hash are verified and the report waits for the person", () => {
  stateOf("delivered");
  delivery.data = DELIVERY;
  render(<ReportPage vault={VAULT} orderId="5" />);
  expect(screen.getByRole("heading", { name: "Counterparty risk grade" })).toBeInTheDocument();
  expect(screen.getByText(/Order 5 from Counterparty Check, delivered on 25 Nov 2026, 14:32 UTC/)).toBeInTheDocument();
  expect(screen.getByText("Delivered on chain")).toBeInTheDocument();
  expect(screen.getByText("Block 10,671,204")).toBeInTheDocument();
  expect(screen.getByText("Envelope matches the delivery")).toBeInTheDocument();
  expect(screen.getByText("Not opened yet")).toBeInTheDocument();
  expect(screen.getByText("Your report is sealed")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Open report" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /Inbox/ })).toHaveAttribute("href", "/inbox");
});

test("opening: the report is opened in the browser with the session keys and shown through its service layout", async () => {
  stateOf("delivered");
  delivery.data = DELIVERY;
  openFn.mockReturnValue({ report: REPORT, envelopeHash: HASH, deliveredTx: TX });
  render(<ReportPage vault={VAULT} orderId="5" />);
  await userEvent.click(screen.getByRole("button", { name: "Open report" }));
  await screen.findByText("Opened with your key");
  expect(openFn).toHaveBeenCalledWith(VAULT, "5", DELIVERY);
  expect(screen.getByText("A short summary of the account.")).toBeInTheDocument();
  expect(screen.getByText("Risk grade")).toBeInTheDocument();
  expect(screen.getAllByText("A").length).toBeGreaterThan(0);
  expect(screen.getByText("ML-DSA-87 key registered: yes.")).toBeInTheDocument();
  expect(screen.getByText("Activity is steady.")).toBeInTheDocument();
  expect(screen.getByText("The flag list is synthetic demo data, not a real screening list.")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Download report" })).toBeEnabled();
  expect(screen.queryByText(/\{/)).not.toBeInTheDocument();
});

test("a report of a shape this app cannot read is said so, never dumped", async () => {
  stateOf("delivered");
  delivery.data = DELIVERY;
  openFn.mockReturnValue({ report: { odd: true }, envelopeHash: HASH, deliveredTx: TX });
  render(<ReportPage vault={VAULT} orderId="5" />);
  await userEvent.click(screen.getByRole("button", { name: "Open report" }));
  expect(await screen.findByText("This report has a format this page cannot show.")).toBeInTheDocument();
  expect(screen.queryByText(/odd/)).not.toBeInTheDocument();
});

test("a report sealed to another wallet is said so honestly, with the way back", async () => {
  stateOf("delivered");
  delivery.data = DELIVERY;
  openFn.mockImplementation(() => {
    throw new ReportUnreadable("no");
  });
  render(<ReportPage vault={VAULT} orderId="5" />);
  await userEvent.click(screen.getByRole("button", { name: "Open report" }));
  expect(await screen.findByRole("heading", { name: "This report cannot be opened with this wallet" })).toBeInTheDocument();
  expect(screen.getByText("Cannot be opened with this wallet")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Back to the inbox" })).toHaveAttribute("href", "/inbox");
  expect(screen.getByText("Envelope matches the delivery")).toBeInTheDocument();
});

test("an unexpected failure while opening is a plain sentence", async () => {
  stateOf("delivered");
  delivery.data = DELIVERY;
  openFn.mockImplementation(() => {
    throw new Error("boom");
  });
  render(<ReportPage vault={VAULT} orderId="5" />);
  await userEvent.click(screen.getByRole("button", { name: "Open report" }));
  expect(await screen.findByText("The report could not be opened. Please try again.")).toBeInTheDocument();
  expect(screen.queryByText(/boom/)).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Open report" })).toBeInTheDocument();
});

test("without a test wallet the open button is replaced by the step the wallet needs", () => {
  wallet.session = { kind: "qorex", evm: ME, address: "qor1x", testWallet: null };
  stateOf("delivered");
  delivery.data = DELIVERY;
  render(<ReportPage vault={VAULT} orderId="5" />);
  expect(screen.queryByRole("button", { name: "Open report" })).not.toBeInTheDocument();
  expect(screen.getByText(/QoreX cannot open sealed reports/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Connect prompt" })).toBeInTheDocument();
});

test("does not match: the page refuses to open the envelope and says what the buyer can do", () => {
  stateOf("delivered");
  delivery.isError = true;
  delivery.error = new ReportDoesNotMatch(HASH, `0x${"cd".repeat(32)}`);
  render(<ReportPage vault={VAULT} orderId="5" />);
  expect(screen.getByRole("heading", { name: "This report was not opened" })).toBeInTheDocument();
  expect(screen.getByText("Envelope does not match")).toBeInTheDocument();
  expect(screen.getByText("Expected 0x9f3c…41ab")).toBeInTheDocument();
  expect(screen.getByText("Not opened")).toBeInTheDocument();
  expect(screen.getByText(/so its contents cannot be trusted/)).toBeInTheDocument();
  expect(screen.queryByText(/reclaim/i)).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Open report" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Download report" })).toBeDisabled();
  expect(screen.getByRole("link", { name: "Back to the inbox" })).toBeInTheDocument();
});

test("a delivery that cannot be read is a load error with a retry, not a mismatch", async () => {
  stateOf("delivered");
  delivery.isError = true;
  delivery.error = new Error("rpc down");
  render(<ReportPage vault={VAULT} orderId="5" />);
  expect(screen.getByRole("alert")).toHaveTextContent("The delivery could not be checked.");
  await userEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(delivery.refetch).toHaveBeenCalled();
});

test("the delivery lookup starts at the block the order was placed in and ends by its deadline", () => {
  stateOf("delivered");
  render(<ReportPage vault={VAULT} orderId="5" />);
  expect(deliveryArgs).toHaveBeenLastCalledWith(VAULT, "5", 100, FUTURE, true);
});

test("a delivery lookup is not started for an order that is not delivered", () => {
  stateOf("open");
  render(<ReportPage vault={VAULT} orderId="5" />);
  expect(deliveryArgs).toHaveBeenLastCalledWith(VAULT, "5", 100, FUTURE, false);
});

test("no delivery record yet has its own sentence, not a service failure", async () => {
  stateOf("delivered");
  delivery.isError = true;
  delivery.error = new DeliveryNotFound();
  render(<ReportPage vault={VAULT} orderId="5" />);
  expect(screen.getByRole("alert")).toHaveTextContent("No delivery record was found on chain yet.");
  expect(screen.getByRole("alert")).not.toHaveTextContent("did not respond");
  await userEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(delivery.refetch).toHaveBeenCalled();
});

test("an opened report is dropped when the test wallet locks, and not shown to the next one", async () => {
  stateOf("delivered");
  delivery.data = DELIVERY;
  openFn.mockReturnValue({ report: REPORT, envelopeHash: HASH, deliveredTx: TX });
  const { rerender } = render(<ReportPage vault={VAULT} orderId="5" />);
  await userEvent.click(screen.getByRole("button", { name: "Open report" }));
  await screen.findByText("A short summary of the account.");

  wallet.session = { kind: "locked", address: "qor1x" };
  rerender(<ReportPage vault={VAULT} orderId="5" />);
  expect(screen.queryByText("A short summary of the account.")).not.toBeInTheDocument();
  expect(screen.getByText("Your report is sealed")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Download report" })).toBeDisabled();

  wallet.session = { kind: "test", evm: ME, address: "qor1x", sealKeys: {} };
  rerender(<ReportPage vault={VAULT} orderId="5" />);
  expect(screen.queryByText("A short summary of the account.")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Open report" })).toBeInTheDocument();
});

test("the checks stay inside the page and never show a key", async () => {
  stateOf("delivered");
  delivery.data = DELIVERY;
  const { container } = render(<ReportPage vault={VAULT} orderId="5" />);
  await waitFor(() => expect(within(container).getByText("Your report is sealed")).toBeInTheDocument());
  expect(container.textContent).not.toMatch(/sealKeys|secret|mnemonic/i);
});
