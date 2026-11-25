import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, test, vi } from "vitest";
import { AccountButton } from "@/modules/wallet/components/AccountButton";
import { readWalletStatus } from "@/modules/wallet/api/wallet.api";
import { Boot, PASSWORD, PHRASE, fakeQorex, memoryStorage, renderWithWallet, useDesktopViewport } from "@/test/helpers/wallet";

const theme = vi.hoisted(() => ({ setTheme: vi.fn() }));
vi.mock("next-themes", () => ({ useTheme: () => ({ theme: "system", resolvedTheme: "light", setTheme: theme.setTheme }) }));
vi.mock("@/modules/wallet/api/wallet.api", async (orig) => ({
  ...(await orig<typeof import("@/modules/wallet/api/wallet.api")>()),
  readWalletStatus: vi.fn(),
  claimFaucet: vi.fn(),
}));

const ready = {
  qor: 2_000_000n,
  fusdBank: 0n,
  fusd: 50_000_000n,
  pqcRegistered: true,
  kemRegistered: true,
  cardPublished: true,
};

beforeEach(() => {
  useDesktopViewport();
  theme.setTheme.mockClear();
  vi.mocked(readWalletStatus).mockReset().mockResolvedValue(ready);
});

const withTestWallet = (storage = memoryStorage()) =>
  renderWithWallet(
    <Boot run={(s) => s.create(PHRASE, PASSWORD)}>
      <AccountButton />
    </Boot>,
    { storage, qorex: fakeQorex("notInstalled") },
  );

test("with no wallet the button offers to connect", async () => {
  renderWithWallet(<AccountButton />, { qorex: fakeQorex("notInstalled") });
  await userEvent.click(screen.getByRole("button", { name: "Connect wallet" }));
  expect(await screen.findByText("Connect a wallet")).toBeInTheDocument();
});

test("a test wallet menu shows the address, both balances, the theme switch, lock and backup but no owner console", async () => {
  const user = userEvent.setup();
  withTestWallet();
  await user.click(await screen.findByRole("button", { name: /Account menu/ }, { timeout: 20_000 }));
  const menu = await screen.findByRole("menu");
  expect(within(menu).getByText("Test wallet")).toBeInTheDocument();
  expect(await within(menu).findByLabelText("fUSD balance")).toHaveTextContent(/50\.00\s*fUSD/);
  expect(within(menu).getByLabelText("QOR balance")).toHaveTextContent(/2\.00\s*QOR/);
  expect(within(menu).getByRole("menuitem", { name: "Copy address" })).toBeInTheDocument();
  expect(within(menu).getByRole("menuitem", { name: "Back up phrase" })).toBeInTheDocument();
  expect(within(menu).getByRole("menuitem", { name: "Lock" })).toBeInTheDocument();
  expect(within(menu).queryByRole("menuitem", { name: /Owner console/ })).not.toBeInTheDocument();
  expect(within(menu).queryByRole("menuitem", { name: /Disconnect QoreX/ })).not.toBeInTheDocument();

  await user.click(within(menu).getByRole("radio", { name: "Dark" }));
  expect(theme.setTheme).toHaveBeenCalledWith("dark");
}, 30_000);

test("QoreX shows the owner console and disconnect, and no lock without a test wallet", async () => {
  const user = userEvent.setup();
  renderWithWallet(
    <Boot run={(s) => s.connectQorex()}>
      <AccountButton />
    </Boot>,
    { storage: memoryStorage(), qorex: fakeQorex("ready") },
  );
  await user.click(await screen.findByRole("button", { name: /Account menu/ }));
  const menu = await screen.findByRole("menu");
  expect(within(menu).getByText("QoreX wallet")).toBeInTheDocument();
  expect(within(menu).getByRole("menuitem", { name: /Owner console/ })).toHaveAttribute("href", "/owner");
  expect(within(menu).getByRole("menuitem", { name: "Disconnect QoreX" })).toBeInTheDocument();
  expect(within(menu).queryByRole("menuitem", { name: "Lock" })).not.toBeInTheDocument();
  // No test wallet is unlocked, so no balance is claimed.
  expect(within(menu).queryByLabelText("fUSD balance")).not.toBeInTheDocument();
});

test("lock leaves a locked button that opens the unlock form", async () => {
  const user = userEvent.setup();
  withTestWallet();
  await user.click(await screen.findByRole("button", { name: /Account menu/ }, { timeout: 20_000 }));
  await user.click(await screen.findByRole("menuitem", { name: "Lock" }));
  const locked = await screen.findByRole("button", { name: /Unlock wallet/ });
  await user.click(locked);
  expect(await screen.findByLabelText("Password")).toBeInTheDocument();
}, 30_000);

test("backing up the phrase asks first, then the password, then shows the phrase", async () => {
  const user = userEvent.setup();
  withTestWallet();
  await user.click(await screen.findByRole("button", { name: /Account menu/ }, { timeout: 20_000 }));
  await user.click(await screen.findByRole("menuitem", { name: "Back up phrase" }));
  const confirm = await screen.findByRole("alertdialog");
  expect(within(confirm).getByText(/anyone who sees it/i)).toBeInTheDocument();
  await user.click(within(confirm).getByRole("button", { name: "Continue" }));

  const field = await screen.findByLabelText("Password");
  await user.type(field, "wrong password");
  await user.click(screen.getByRole("button", { name: "Show recovery phrase" }));
  expect(await screen.findByText("The password is not correct.", undefined, { timeout: 20_000 })).toBeInTheDocument();
  expect(screen.queryByTestId("phrase")).not.toBeInTheDocument();

  await user.clear(field);
  await user.type(field, PASSWORD);
  await user.click(screen.getByRole("button", { name: "Show recovery phrase" }));
  await waitFor(() => expect(screen.getByTestId("phrase")).toHaveTextContent(PHRASE), { timeout: 20_000 });
}, 60_000);
