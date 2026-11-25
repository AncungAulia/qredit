import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, test, vi } from "vitest";
import { hexToQor } from "@qredit/qore";
import type { Business } from "@/lib/schemas";

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

const wallet = vi.hoisted(() => ({
  session: { kind: "none" } as { kind: string; address?: string; evm?: string; testWallet?: null },
}));
vi.mock("@/modules/wallet/WalletProvider", () => ({
  useWallet: (select: (s: unknown) => unknown) => select({ session: wallet.session, hydrated: true }),
  useWalletApi: () => ({}),
}));
vi.mock("@/modules/wallet/components/ConnectPrompt", () => ({
  ConnectPrompt: () => <button type="button">Connect wallet</button>,
}));
const status = vi.hoisted(() => ({ data: undefined as unknown, isPending: false, isError: false, refetch: vi.fn() }));
vi.mock("@/modules/wallet/api/useWalletStatus", () => ({ useWalletStatusQuery: () => status, walletKeys: { all: ["wallet"] } }));
vi.mock("@/modules/wallet/components/WalletSetup", () => ({ WalletSetup: () => <p>setup steps</p> }));

const quote = vi.hoisted(() => ({ data: { price: 250_000n, ttlSeconds: 3600 } as unknown, isError: false, refetch: vi.fn() }));
const place = vi.hoisted(() => vi.fn());
vi.mock("@/modules/orders/api/useOrders", () => ({
  useQuotesQuery: (b: Business) => b.services.map(() => quote),
  useOrderActions: () => ({ place }),
}));
const vault = vi.hoisted(() => ({ data: { state: "Active" } as { state: string } | undefined }));
vi.mock("@/modules/market", () => ({ useVaultQuery: () => vault }));

import { OrderForm } from "@/modules/orders/components/OrderForm";
import { NOT_SEALABLE_SENTENCE } from "@/modules/orders/api/orders.api";
import { TxFailed } from "@/modules/wallet/signer";

const HEX = "0x37bb4c1e9a2f03d4aa11bb22cc33dd44ee55ff66";
const OWN = hexToQor("0x70997970c51812dc3a010c7d01b50e0d17dc79c8");
const business = (slug: string) =>
  ({
    slug,
    name: "Counterparty Check",
    tagline: "A grade from A to F for one address.",
    vault: "0x1111111111111111111111111111111111111111",
    spender: "0x2222222222222222222222222222222222222222",
    services: [{ id: 0, name: "Counterparty risk grade", priceUnits: 250_000n }],
  }) as unknown as Business;

const ready = { qor: 5n, fusdBank: 0n, fusd: 50n, pqcRegistered: true, kemRegistered: true, cardPublished: true };

beforeEach(() => {
  vi.clearAllMocks();
  wallet.session = { kind: "test", address: OWN, evm: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" };
  status.data = ready;
  quote.data = { price: 250_000n, ttlSeconds: 3600 };
  quote.isError = false;
  vault.data = { state: "Active" };
});

test("the price comes from the vault and the refund time is shown", () => {
  render(<OrderForm business={business("counterparty-check")} />);
  expect(screen.getByRole("button", { name: "Seal and buy for 0.25 fUSD" })).toBeInTheDocument();
  expect(screen.getByText("after 1 hour")).toBeInTheDocument();
  expect(screen.getByText("Refunded if it is not delivered in 1 hour")).toBeInTheDocument();
});

test("the counterparty check starts with the address of the buyer", async () => {
  render(<OrderForm business={business("counterparty-check")} />);
  await waitFor(() => expect(screen.getByLabelText("Address to check")).toHaveValue(OWN));
});

test("the other services do not pre-fill", () => {
  render(<OrderForm business={business("due-diligence")} />);
  expect(screen.getByLabelText("Token or contract address")).toHaveValue("");
});

test("an invalid address shows its error under the field and keeps the button off", async () => {
  const user = userEvent.setup();
  render(<OrderForm business={business("counterparty-check")} />);
  const field = screen.getByLabelText("Address to check");
  await user.clear(field);
  await user.type(field, "0x37bb4c1e9a2f03d4");
  await user.tab();
  expect(await screen.findByText(/not a valid address/i)).toBeInTheDocument();
  expect(field).toHaveAttribute("aria-invalid", "true");
  expect(screen.getByRole("button", { name: /Seal and buy/ })).toBeDisabled();
});

test("a valid order is placed with the typed address and ends in the placed state with both links", async () => {
  const user = userEvent.setup();
  place.mockImplementation(async (_b: unknown, _id: number, _input: string, onProgress: (p: string) => void) => {
    onProgress("sealing");
    onProgress("placed");
    return { orderId: "7", buyTx: "0xbuy" };
  });
  render(<OrderForm business={business("counterparty-check")} />);
  const field = screen.getByLabelText("Address to check");
  await user.clear(field);
  await user.type(field, HEX);
  await user.tab();
  await user.click(await screen.findByRole("button", { name: "Seal and buy for 0.25 fUSD" }));
  expect(place).toHaveBeenCalledWith(expect.objectContaining({ slug: "counterparty-check" }), 0, HEX, expect.any(Function));
  expect(await screen.findByText("Order placed")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Open the report" })).toHaveAttribute(
    "href",
    "/inbox/0x1111111111111111111111111111111111111111/7",
  );
  expect(screen.getByRole("link", { name: "Go to the inbox" })).toHaveAttribute("href", "/inbox");
});

test("the steps show while the order is sent", async () => {
  const user = userEvent.setup();
  place.mockImplementation(
    (_b: unknown, _id: number, _input: string, onProgress: (p: string) => void) =>
      new Promise(() => {
        onProgress("posting");
      }),
  );
  render(<OrderForm business={business("counterparty-check")} />);
  await user.click(await screen.findByRole("button", { name: /Seal and buy/ }));
  expect(await screen.findByText("Storing the sealed request")).toHaveTextContent("Storing");
  expect(screen.getByText("Sealing your request to the agent's key")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /Seal and buy/ })).not.toBeInTheDocument();
});

test("a business that cannot receive sealed requests shows its sentence and offers another try", async () => {
  const user = userEvent.setup();
  place.mockRejectedValue(new TxFailed(null, NOT_SEALABLE_SENTENCE));
  render(<OrderForm business={business("counterparty-check")} />);
  await user.click(await screen.findByRole("button", { name: /Seal and buy/ }));
  expect(await screen.findByText(NOT_SEALABLE_SENTENCE)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
});

test("a wallet whose setup is not finished shows the setup steps in place of the button", () => {
  status.data = { ...ready, kemRegistered: false };
  render(<OrderForm business={business("counterparty-check")} />);
  expect(screen.getByText("setup steps")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /Seal and buy/ })).not.toBeInTheDocument();
});

test("without a wallet the buyer is asked to connect, and the address is not pre-filled", () => {
  wallet.session = { kind: "none" };
  render(<OrderForm business={business("counterparty-check")} />);
  expect(screen.getByText("Connect a wallet to buy a report")).toBeInTheDocument();
  expect(screen.getByLabelText("Address to check")).toHaveValue("");
});

test("a business that is still raising is not selling", () => {
  vault.data = { state: "Raising" };
  render(<OrderForm business={business("counterparty-check")} />);
  expect(screen.getByText("This business is not selling yet")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /Seal and buy/ })).toBeDisabled();
});

test("a price that cannot be read keeps the button off and offers a retry", () => {
  quote.data = undefined;
  quote.isError = true;
  render(<OrderForm business={business("counterparty-check")} />);
  expect(screen.getByText("The price could not be read")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Seal and buy" })).toBeDisabled();
});
