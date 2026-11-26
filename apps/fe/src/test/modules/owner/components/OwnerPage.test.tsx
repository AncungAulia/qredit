import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, test, vi } from "vitest";
import type { Business } from "@/lib/schemas";
import { TxReverted } from "@/modules/wallet/signer";
import { useDesktopViewport } from "@/test/helpers/wallet";

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

type Session = { kind: string; address?: string; evm?: string; testWallet?: unknown };
const wallet = vi.hoisted(() => ({
  session: { kind: "none" } as Session,
  hydrated: true,
  qorexState: "ready" as string,
}));
vi.mock("@/modules/wallet/WalletProvider", () => ({
  useWallet: (select: (s: unknown) => unknown) =>
    select({ session: wallet.session, hydrated: wallet.hydrated, qorexState: wallet.qorexState }),
  useWalletApi: () => ({}),
}));
vi.mock("@/modules/wallet/components/ConnectDialog", () => ({
  ConnectDialog: ({ open }: { open: boolean }) => (open ? <p>connect dialog</p> : null),
}));
vi.mock("@/modules/wallet/components/ConnectPrompt", () => ({
  ConnectPrompt: () => <button type="button">Use a test wallet</button>,
}));
const readiness = vi.hoisted(() => ({ state: "ready" as string, refetch: vi.fn() }));
vi.mock("@/modules/wallet/components/RequireReadyWallet", () => ({
  useWalletReadiness: () => readiness,
  SetupGate: () => <p>setup gate</p>,
}));

const market = vi.hoisted(() => ({ data: [] as unknown[] | undefined, isError: false }));
vi.mock("@/modules/market", async (orig) => ({
  ...(await orig<object>()),
  useMarketQuery: () => ({ ...market, refetch: vi.fn() }),
}));

const owned = vi.hoisted(() => ({ data: undefined as unknown[] | undefined, isError: false, refetch: vi.fn() }));
const rules = vi.hoisted(() => ({
  data: undefined as unknown,
  isError: false,
  refetch: vi.fn(),
}));
const actions = vi.hoisted(() => ({
  build: vi.fn(),
  sign: vi.fn(),
  simulate: vi.fn(),
  apply: vi.fn(),
}));
vi.mock("@/modules/owner/api/useOwner", () => ({
  useOwnedVaultsQuery: () => owned,
  useRulesQuery: () => rules,
  useOwnerActions: () => actions,
}));

import { OwnerPage } from "@/modules/owner/components/OwnerPage";

const OWNER = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const business = (slug: string, name: string) =>
  ({ slug, name, tagline: "t", vault: `0x${slug.padEnd(40, "0")}` }) as unknown as Business;
const fusd = (n: number) => BigInt(n) * 1_000_000n;
const TEXT = "qredit-order-v1:0x1234";
const built = (over: object = {}) => ({
  order: { kind: 2, target: "0x0000000000000000000000000000000000000000", value: fusd(40), nonce: 4n, expiry: 1_800_000_000n },
  text: TEXT,
  ...over,
});
const SIG = Uint8Array.from([1, 2, 3]);
const testWallet = { kind: "test", address: "qor1test", evm: "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC" };

beforeEach(() => {
  useDesktopViewport();
  vi.clearAllMocks();
  wallet.session = { kind: "qorex", address: "qor1owner", evm: OWNER, testWallet: null };
  wallet.hydrated = true;
  wallet.qorexState = "ready";
  readiness.state = "ready";
  market.data = [{ business: business("a", "Counterparty Check") }];
  market.isError = false;
  owned.data = [business("a", "Counterparty Check")];
  owned.isError = false;
  rules.data = { state: "Active", paused: false, repaid: fusd(29), totalOwed: fusd(100), dailyCap: fusd(50),
    spentToday: fusd(18),
    ownerPending: fusd(3),
    bondHeld: fusd(1200),
    claimAhead: false,
    spender: "0x00000000000000000000000000000000000000c1",
    operator: "0x00000000000000000000000000000000000000c2",
  };
  rules.isError = false;
  actions.build.mockResolvedValue(built());
  actions.sign.mockResolvedValue(SIG);
  actions.simulate.mockResolvedValue({ ok: true });
  actions.apply.mockResolvedValue("0xabc");
});

async function fillLowerCap(user: ReturnType<typeof userEvent.setup>, value = "40") {
  await user.click(screen.getByRole("radio", { name: /Lower the daily spending cap/ }));
  await user.type(screen.getByLabelText("New daily cap"), value);
}

test("before the wallet has been read the page shows a loading state", () => {
  wallet.hydrated = false;
  render(<OwnerPage />);
  expect(screen.getByRole("status")).toHaveAttribute("aria-busy", "true");
});

test("without a connected wallet it asks for QoreX and offers to connect it", async () => {
  wallet.session = { kind: "none" };
  render(<OwnerPage />);
  expect(screen.getByRole("heading", { name: "Connect QoreX to open the owner console" })).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Connect QoreX" }));
  expect(screen.getByText("connect dialog")).toBeInTheDocument();
});

test("a test wallet alone is not enough: QoreX holds the owner key", () => {
  wallet.session = { ...testWallet };
  render(<OwnerPage />);
  expect(screen.getByRole("heading", { name: "Connect QoreX to open the owner console" })).toBeInTheDocument();
});

test("when QoreX is not installed the page says so and links to it", () => {
  wallet.session = { kind: "none" };
  wallet.qorexState = "notInstalled";
  render(<OwnerPage />);
  expect(screen.getByText("QoreX is not installed in this browser")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Get QoreX" })).toHaveAttribute("href", expect.stringMatching(/^https:/));
});

test("a QoreX account that owns no business is told so", () => {
  owned.data = [];
  render(<OwnerPage />);
  expect(screen.getByRole("heading", { name: "This wallet does not own a business" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Back to the market" })).toHaveAttribute("href", "/");
});

test("a failed read of the vaults shows an error with a retry, never an empty owner list", async () => {
  owned.data = undefined;
  owned.isError = true;
  render(<OwnerPage />);
  await userEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(owned.refetch).toHaveBeenCalled();
});

test("the console shows the current rules read from the vault", () => {
  render(<OwnerPage />);
  expect(screen.getByRole("heading", { name: "Owner console" })).toBeInTheDocument();
  const card = screen.getByRole("region", { name: "Current rules" });
  expect(within(card).getByText("50.00 fUSD")).toBeInTheDocument();
  expect(within(card).getByText("Active")).toBeInTheDocument();
  expect(within(card).getByText("Claimable when one installment ahead")).toBeInTheDocument();
  expect(within(card).getByText("1,200.00 fUSD, back when repaid")).toBeInTheDocument();
});

test("Close is confirmed as irreversible and needs no field; Rotate asks for both keys", async () => {
  const user = userEvent.setup();
  render(<OwnerPage />);
  await user.click(screen.getByRole("radio", { name: /Close the business/ }));
  expect(screen.getByText("This cannot be undone")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Sign with QoreX" })).toBeEnabled();
  await user.click(screen.getByRole("radio", { name: /Rotate the agent keys/ }));
  expect(screen.getByRole("button", { name: "Sign with QoreX" })).toBeDisabled();
  await user.click(screen.getByLabelText("New spending key"));
  await user.paste("0x00000000000000000000000000000000000000c1");
  await user.click(screen.getByLabelText("New operator key"));
  await user.paste("0x00000000000000000000000000000000000000c2");
  expect(screen.getByRole("button", { name: "Sign with QoreX" })).toBeEnabled();
});

test("the claim card shows the owner share and the rule that releases it", () => {
  render(<OwnerPage />);
  const card = screen.getByRole("region", { name: "Your share to claim" });
  expect(within(card).getByText("3.00 fUSD")).toBeInTheDocument();
  expect(within(card).getByText(/only while the loan is one installment ahead/)).toBeInTheDocument();
  expect(within(card).queryByRole("button")).toBeNull();
});

test("the signing buttons stay off until the order is complete", async () => {
  render(<OwnerPage />);
  expect(screen.getByRole("button", { name: "Sign with QoreX" })).toBeDisabled();
  await fillLowerCap(userEvent.setup());
  expect(screen.getByRole("button", { name: "Sign with QoreX" })).toBeEnabled();
});

test("a widening kind during the loan says it is locked and cannot be signed", async () => {
  const user = userEvent.setup();
  render(<OwnerPage />);
  await user.click(screen.getByRole("radio", { name: /Raise the daily spending cap/ }));
  await user.type(screen.getByLabelText("New daily cap"), "80");
  expect(screen.getByText(/refuses this change until then/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Sign with QoreX" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Paste a CLI signature" })).toBeDisabled();
});

test("once the loan is repaid a widening kind carries no lock note and can be signed", async () => {
  rules.data = { ...(rules.data as object), state: "Repaid" };
  const user = userEvent.setup();
  render(<OwnerPage />);
  await user.click(screen.getByRole("radio", { name: /Raise the daily spending cap/ }));
  await user.type(screen.getByLabelText("New daily cap"), "80");
  expect(screen.queryByText(/refuses this change until then/)).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Sign with QoreX" })).toBeEnabled();
});

test("a change the vault would refuse anyway is stopped before signing, with a plain message", async () => {
  rules.data = { ...(rules.data as object), paused: true };
  const user = userEvent.setup();
  render(<OwnerPage />);
  await user.click(screen.getByRole("radio", { name: /Pause the agent/ }));
  expect(screen.getByText("The agent is already paused.")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Sign with QoreX" })).toBeDisabled();
});

test("a lower cap that is not lower is stopped before signing", async () => {
  const user = userEvent.setup();
  render(<OwnerPage />);
  await fillLowerCap(user, "50");
  expect(screen.getByText("Enter an amount below the current daily cap of 50.00 fUSD.")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Sign with QoreX" })).toBeDisabled();
});

test("signing builds the order, signs its text and checks it with the vault before anything is sent", async () => {
  const user = userEvent.setup();
  render(<OwnerPage />);
  await fillLowerCap(user);
  await user.click(screen.getByRole("button", { name: "Sign with QoreX" }));
  await screen.findByText("The vault accepts this order");
  expect(actions.build).toHaveBeenCalledWith(expect.stringMatching(/^0xa0+$/), expect.objectContaining({ kind: 2, value: fusd(40) }));
  expect(actions.sign).toHaveBeenCalledWith("qor1owner", TEXT);
  expect(actions.simulate).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ nonce: 4n }), SIG);
  expect(actions.apply).not.toHaveBeenCalled();
});

test("a refusal by the simulation shows the refused state and sends nothing", async () => {
  actions.simulate.mockResolvedValue({ ok: false, reason: "The vault refuses to widen its rules until the loan is repaid." });
  const user = userEvent.setup();
  render(<OwnerPage />);
  await fillLowerCap(user);
  await user.click(screen.getByRole("button", { name: "Sign with QoreX" }));
  expect(await screen.findByText("The vault refused this order")).toBeInTheDocument();
  expect(screen.getByText(/refuses to widen its rules until the loan is repaid/)).toBeInTheDocument();
  expect(screen.getByText(/Nothing was sent/)).toBeInTheDocument();
  expect(actions.apply).not.toHaveBeenCalled();
});

test("a signature that QoreX did not give ends the attempt with a sentence and no simulation", async () => {
  actions.sign.mockRejectedValue(new Error("User rejected"));
  const user = userEvent.setup();
  render(<OwnerPage />);
  await fillLowerCap(user);
  await user.click(screen.getByRole("button", { name: "Sign with QoreX" }));
  expect(await screen.findByText("The order was not signed")).toBeInTheDocument();
  expect(actions.simulate).not.toHaveBeenCalled();
  expect(actions.apply).not.toHaveBeenCalled();
});

test("an accepted order without a test wallet explains that a wallet pays the fee and offers to connect", async () => {
  readiness.state = "none";
  const user = userEvent.setup();
  render(<OwnerPage />);
  await fillLowerCap(user);
  await user.click(screen.getByRole("button", { name: "Sign with QoreX" }));
  await screen.findByText("The vault accepts this order");
  expect(screen.getByText("A test wallet is needed to apply this order")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Use a test wallet" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Apply order" })).not.toBeInTheDocument();
});

test("with a test wallet the owner confirms, the order is applied and the result is shown", async () => {
  wallet.session = { kind: "qorex", address: "qor1owner", evm: OWNER, testWallet: testWallet };
  const user = userEvent.setup();
  render(<OwnerPage />);
  await fillLowerCap(user);
  await user.click(screen.getByRole("button", { name: "Sign with QoreX" }));
  await user.click(await screen.findByRole("button", { name: "Apply order" }));
  expect(actions.apply).not.toHaveBeenCalled(); // the confirmation comes first
  const dialog = await screen.findByRole("alertdialog");
  await user.click(within(dialog).getByRole("button", { name: "Apply order" }));
  await waitFor(() => expect(actions.apply).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ nonce: 4n }), SIG));
  expect(await screen.findByText("Daily cap lowered to 40.00 fUSD")).toBeInTheDocument();
  expect(toast.success).toHaveBeenCalled();
  // The form starts over, so the order just applied is not offered again against the new rules.
  expect(screen.getByRole("radio", { name: /Lower the daily spending cap/ })).toHaveAttribute("aria-checked", "false");
  expect(screen.queryByLabelText("New daily cap")).not.toBeInTheDocument();
});

test("the CLI path shows the text to sign and refuses a signature that cannot be read", async () => {
  const user = userEvent.setup();
  render(<OwnerPage />);
  await fillLowerCap(user);
  await user.click(screen.getByRole("button", { name: "Paste a CLI signature" }));
  expect(await screen.findByText(TEXT)).toBeInTheDocument();
  expect(actions.sign).not.toHaveBeenCalled();
  await user.type(screen.getByLabelText("Signature"), "not a signature!");
  await user.click(screen.getByRole("button", { name: "Check signature" }));
  expect(await screen.findByText(/could not be read as a signature/)).toBeInTheDocument();
  expect(actions.simulate).not.toHaveBeenCalled();
});

test("the CLI path accepts a hex signature and checks it with the vault", async () => {
  const user = userEvent.setup();
  render(<OwnerPage />);
  await fillLowerCap(user);
  await user.click(screen.getByRole("button", { name: "Paste a CLI signature" }));
  await user.type(await screen.findByLabelText("Signature"), "0x010203");
  await user.click(screen.getByRole("button", { name: "Check signature" }));
  await screen.findByText("The vault accepts this order");
  expect(actions.simulate).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ nonce: 4n }), SIG);
});

test("hex without 0x asks for the prefix instead of being read as base64", async () => {
  const user = userEvent.setup();
  render(<OwnerPage />);
  await fillLowerCap(user);
  await user.click(screen.getByRole("button", { name: "Paste a CLI signature" }));
  await user.type(await screen.findByLabelText("Signature"), "0a0b0c0d");
  await user.click(screen.getByRole("button", { name: "Check signature" }));
  expect(await screen.findByText("Add 0x before a hex signature.")).toBeInTheDocument();
  expect(actions.simulate).not.toHaveBeenCalled();
});

test("a send that the chain refuses returns to the form with the reason and offers no retry of the stale order", async () => {
  wallet.session = { kind: "qorex", address: "qor1owner", evm: OWNER, testWallet: testWallet };
  actions.apply.mockRejectedValue(new TxReverted(null, "The nonce is stale. Go back and sign a new order."));
  const user = userEvent.setup();
  render(<OwnerPage />);
  await fillLowerCap(user);
  await user.click(screen.getByRole("button", { name: "Sign with QoreX" }));
  await user.click(await screen.findByRole("button", { name: "Apply order" }));
  const dialog = await screen.findByRole("alertdialog");
  await user.click(within(dialog).getByRole("button", { name: "Apply order" }));
  expect(await within(dialog).findByText(/The nonce is stale/)).toBeInTheDocument();
  expect(within(dialog).queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
  await user.click(within(dialog).getByRole("button", { name: "Close" }));
  expect(await screen.findByText("The vault refused this order")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Back to the form" })).toBeInTheDocument();
});
