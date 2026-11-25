import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, test, vi } from "vitest";
import { formatDateTime } from "@/lib/format";
import { WalletSetup } from "@/modules/wallet/components/WalletSetup";
import { claimFaucet, readWalletStatus } from "@/modules/wallet/api/wallet.api";
import { runStep } from "@/modules/wallet/setup/steps";
import type { WalletChainStatus } from "@/modules/wallet/schemas/wallet.schema";
import { Boot, PASSWORD, PHRASE, memoryStorage, renderWithWallet, useDesktopViewport } from "@/test/helpers/wallet";

vi.mock("@/modules/wallet/api/wallet.api", async (orig) => ({
  ...(await orig<typeof import("@/modules/wallet/api/wallet.api")>()),
  readWalletStatus: vi.fn(),
  claimFaucet: vi.fn(),
}));
vi.mock("@/modules/wallet/setup/steps", async (orig) => ({
  ...(await orig<typeof import("@/modules/wallet/setup/steps")>()),
  runStep: vi.fn(),
}));

const lockSpy = vi.fn();
vi.mock("@/modules/wallet/signer", async (orig) => {
  const real = await orig<typeof import("@/modules/wallet/signer")>();
  return {
    ...real,
    withAccountLock: (address: string, job: () => Promise<unknown>) => {
      lockSpy(address);
      return real.withAccountLock(address, job);
    },
  };
});

const fresh: WalletChainStatus = {
  qor: 0n,
  fusdBank: 0n,
  fusd: 0n,
  pqcRegistered: false,
  kemRegistered: false,
  cardPublished: false,
};
const funded: WalletChainStatus = { ...fresh, qor: 2_000_000n, fusdBank: 50_000_000n };

const renderSetup = () =>
  renderWithWallet(
    <Boot run={(s) => s.create(PHRASE, PASSWORD)}>
      <WalletSetup />
    </Boot>,
    { storage: memoryStorage() },
  );

beforeEach(() => {
  sessionStorage.clear();
  useDesktopViewport();
  vi.mocked(readWalletStatus).mockReset();
  vi.mocked(claimFaucet).mockReset();
  vi.mocked(runStep).mockReset();
});

test("a new wallet starts at the faucet and the later steps wait", async () => {
  vi.mocked(readWalletStatus).mockResolvedValue(fresh);
  renderSetup();
  expect(await screen.findByRole("button", { name: "Get test funds" })).toBeInTheDocument();
  expect(screen.getAllByText("Waiting")).toHaveLength(4);
  expect(screen.queryByText("Done")).not.toBeInTheDocument();
  expect(screen.queryByText("Your test wallet is ready.")).not.toBeInTheDocument();
}, 30_000);

test("a step that is done on chain is not ticked while an earlier step is open", async () => {
  vi.mocked(readWalletStatus).mockResolvedValue({ ...fresh, pqcRegistered: true, kemRegistered: true, cardPublished: true });
  renderSetup();
  await screen.findByRole("button", { name: "Get test funds" });
  expect(screen.queryByText("Done")).not.toBeInTheDocument();
  expect(screen.getAllByText("Waiting")).toHaveLength(4);
}, 30_000);

test("the faucet limit shows when to ask again and the QoreX way to fund", async () => {
  const user = userEvent.setup();
  const retryAt = new Date("2026-11-27T10:00:00Z");
  vi.mocked(readWalletStatus).mockResolvedValue(fresh);
  vi.mocked(claimFaucet).mockResolvedValue({ retryAt });
  renderSetup();
  await user.click(await screen.findByRole("button", { name: "Get test funds" }));
  expect(await screen.findByText(`You can ask for test funds again at ${formatDateTime(retryAt)}.`)).toBeInTheDocument();
  expect(screen.getByText("Fund it from QoreX: send a little QOR and fUSD to this address.")).toBeInTheDocument();
  expect(screen.getByTitle(/^qor1/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Copy address" })).toBeInTheDocument();
}, 30_000);

test("a wallet with fUSD and no QOR says it needs QOR for fees", async () => {
  vi.mocked(readWalletStatus).mockResolvedValue({ ...fresh, fusd: 50_000_000n });
  renderSetup();
  expect(await screen.findByText("This wallet needs a little QOR to pay network fees.")).toBeInTheDocument();
}, 30_000);

test("one primary button runs the next step", async () => {
  const user = userEvent.setup();
  vi.mocked(readWalletStatus).mockResolvedValue(funded);
  vi.mocked(runStep).mockResolvedValue("ABCD");
  renderSetup();
  expect(screen.queryByRole("button", { name: "Prepare fUSD" })).not.toBeInTheDocument();
  await user.click(await screen.findByRole("button", { name: "Register key" }));
  await waitFor(() => expect(runStep).toHaveBeenCalledWith("registerKey", expect.objectContaining({ status: funded })));
  // The status is read again after a step.
  await waitFor(() => expect(vi.mocked(readWalletStatus).mock.calls.length).toBeGreaterThan(1));
}, 30_000);

test("a chain step runs inside the account lock of the wallet, the faucet does not", async () => {
  const user = userEvent.setup();
  lockSpy.mockClear();
  vi.mocked(readWalletStatus).mockResolvedValue(funded);
  vi.mocked(runStep).mockResolvedValue("ABCD");
  renderSetup();
  await user.click(await screen.findByRole("button", { name: "Register key" }));
  await waitFor(() => expect(runStep).toHaveBeenCalled());
  expect(lockSpy).toHaveBeenCalledTimes(1);
  expect(lockSpy).toHaveBeenCalledWith(expect.stringMatching(/^0x[0-9a-fA-F]{40}$/));
}, 30_000);

test("a failed step shows a plain sentence and the button stays", async () => {
  const user = userEvent.setup();
  vi.mocked(readWalletStatus).mockResolvedValue(funded);
  vi.mocked(runStep).mockRejectedValue(new Error("rpc exploded 0xdead"));
  renderSetup();
  await user.click(await screen.findByRole("button", { name: "Register key" }));
  const alert = await screen.findByRole("alert");
  expect(alert).toHaveTextContent("This step could not be completed. Please try again.");
  expect(alert).not.toHaveTextContent("0xdead");
  expect(screen.getByRole("button", { name: "Register key" })).toBeInTheDocument();
}, 30_000);

test("a finished wallet is ready", async () => {
  vi.mocked(readWalletStatus).mockResolvedValue({
    qor: 1_000_000n,
    fusdBank: 0n,
    fusd: 50_000_000n,
    pqcRegistered: true,
    kemRegistered: true,
    cardPublished: true,
  });
  renderSetup();
  expect(await screen.findByText("Your test wallet is ready.")).toBeInTheDocument();
  expect(within(screen.getByRole("list")).getAllByText("Done")).toHaveLength(5);
}, 30_000);

test("a status that cannot be read shows an error with retry, never a default", async () => {
  vi.mocked(readWalletStatus).mockRejectedValue(new Error("down"));
  renderSetup();
  expect(await screen.findByRole("button", { name: "Retry" })).toBeInTheDocument();
  expect(screen.queryByText("Waiting")).not.toBeInTheDocument();
}, 30_000);

test("after a successful claim the button waits until the funds arrive", async () => {
  const user = userEvent.setup();
  vi.mocked(readWalletStatus).mockResolvedValue(fresh);
  vi.mocked(claimFaucet).mockResolvedValue({ tx: "ABCD" });
  renderSetup();
  await user.click(await screen.findByRole("button", { name: "Get test funds" }));
  expect(await screen.findByText(/The faucet sent your test funds/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Get test funds" })).toBeDisabled();
}, 30_000);

test("the faucet limit message survives a reload of the page", async () => {
  const user = userEvent.setup();
  const retryAt = new Date(Date.now() + 3_600_000);
  vi.mocked(readWalletStatus).mockResolvedValue(fresh);
  vi.mocked(claimFaucet).mockResolvedValue({ retryAt });
  const first = renderSetup();
  await user.click(await screen.findByRole("button", { name: "Get test funds" }));
  await screen.findByText(`You can ask for test funds again at ${formatDateTime(retryAt)}.`);
  first.unmount();
  renderSetup();
  expect(await screen.findByText(`You can ask for test funds again at ${formatDateTime(retryAt)}.`)).toBeInTheDocument();
  expect(claimFaucet).toHaveBeenCalledTimes(1);
  // Asking again is pointless until the time shown has passed.
  expect(screen.getByRole("button", { name: "Get test funds" })).toBeDisabled();
}, 40_000);