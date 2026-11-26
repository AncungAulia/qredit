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
  const menu = await screen.findByRole("dialog", { name: "Account menu" });
  expect(within(menu).getByText("Test wallet")).toBeInTheDocument();
  const fusd = await within(menu).findByRole("group", { name: "Balance" });
  expect(fusd).toHaveTextContent("Balance50.00fUSD");
  expect(within(menu).getByRole("group", { name: "Network fees" })).toHaveTextContent("Network fees2.00QOR");
  expect(within(menu).getByRole("button", { name: "Copy address" })).toBeInTheDocument();
  expect(within(menu).getByRole("button", { name: "Back up phrase" })).toBeInTheDocument();
  expect(within(menu).getByRole("button", { name: "Lock" })).toBeInTheDocument();
  expect(within(menu).getByRole("button", { name: "Disconnect" })).toBeInTheDocument();
  expect(within(menu).queryByRole("link", { name: /Owner console/ })).not.toBeInTheDocument();
  expect(within(menu).queryByRole("button", { name: /Disconnect QoreX/ })).not.toBeInTheDocument();

  await user.click(within(within(menu).getByRole("group", { name: "Appearance" })).getByRole("button", { name: "Dark" }));
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
  const menu = await screen.findByRole("dialog", { name: "Account menu" });
  expect(within(menu).getByText("QoreX wallet")).toBeInTheDocument();
  expect(within(menu).getByRole("link", { name: /Owner console/ })).toHaveAttribute("href", "/owner");
  expect(within(menu).getByRole("button", { name: "Disconnect QoreX" })).toBeInTheDocument();
  expect(within(menu).queryByRole("button", { name: "Lock" })).not.toBeInTheDocument();
  // No test wallet is unlocked, so no balance is claimed.
  expect(within(menu).queryByRole("group", { name: "Balance" })).not.toBeInTheDocument();
});

test("lock leaves a locked button that opens the unlock form", async () => {
  const user = userEvent.setup();
  withTestWallet();
  await user.click(await screen.findByRole("button", { name: /Account menu/ }, { timeout: 20_000 }));
  await user.click(await screen.findByRole("button", { name: "Lock" }));
  const locked = await screen.findByRole("button", { name: /Unlock wallet/ });
  // Focus moves to the button that replaced the menu, so the keyboard user does not lose their place.
  await waitFor(() => expect(locked).toHaveFocus());
  await user.click(locked);
  expect(await screen.findByLabelText("Password")).toBeInTheDocument();
}, 30_000);

test("disconnect leaves the connect button, and choosing the test wallet again asks for the password", async () => {
  const user = userEvent.setup();
  withTestWallet();
  await user.click(await screen.findByRole("button", { name: /Account menu/ }, { timeout: 20_000 }));
  await user.click(await screen.findByRole("button", { name: "Disconnect" }));
  await user.click(await screen.findByRole("button", { name: "Connect wallet" }));
  await user.click(await screen.findByRole("button", { name: /Test wallet in this browser/ }));
  expect(await screen.findByLabelText("Password")).toBeInTheDocument();
}, 30_000);

test("backing up the phrase asks first, then the password, then shows the phrase", async () => {
  const user = userEvent.setup();
  withTestWallet();
  await user.click(await screen.findByRole("button", { name: /Account menu/ }, { timeout: 20_000 }));
  await user.click(await screen.findByRole("button", { name: "Back up phrase" }));
  const confirm = await screen.findByRole("alertdialog");
  expect(within(confirm).getByText(/anyone who sees it/i)).toBeInTheDocument();
  await user.click(within(confirm).getByRole("button", { name: "Continue" }));

  const field = await screen.findByLabelText("Password");
  await user.type(field, "wrong password");
  await user.click(screen.getByRole("button", { name: "Show recovery phrase" }));
  expect(await screen.findByText("The password is not correct.", undefined, { timeout: 20_000 })).toBeInTheDocument();
  expect(screen.queryByRole("list", { name: "Recovery phrase" })).not.toBeInTheDocument();

  await user.clear(field);
  await user.type(field, PASSWORD);
  await user.click(screen.getByRole("button", { name: "Show recovery phrase" }));
  await waitFor(() => expect(screen.getByRole("list", { name: "Recovery phrase" })).toHaveTextContent(PHRASE), { timeout: 20_000 });

  // Closing the dialog removes the phrase from the page, and opening it again starts with the question.
  await user.click(screen.getByRole("button", { name: "Done" }));
  await waitFor(() => expect(screen.queryByRole("list", { name: "Recovery phrase" })).not.toBeInTheDocument());
  expect(document.body).not.toHaveTextContent(PHRASE);
  await user.click(await screen.findByRole("button", { name: /Account menu/ }));
  await user.click(await screen.findByRole("button", { name: "Back up phrase" }));
  expect(await screen.findByRole("alertdialog")).toBeInTheDocument();
  expect(screen.queryByRole("list", { name: "Recovery phrase" })).not.toBeInTheDocument();
  expect(document.body).not.toHaveTextContent(PHRASE);
}, 90_000);

test("on a phone the menu is a bottom sheet with the same content, closed by Escape, focus back on the trigger", async () => {
  const user = userEvent.setup();
  useDesktopViewport(false);
  withTestWallet();
  const trigger = await screen.findByRole("button", { name: /Account menu/ }, { timeout: 20_000 });
  await user.click(trigger);
  const sheet = await screen.findByRole("dialog", { name: "Account menu" });
  expect(sheet.getAttribute("data-slot")).toBe("drawer-popup");
  expect(document.querySelector('[data-slot="popover-content"]')).toBeNull();
  expect(within(sheet).getByRole("button", { name: "Copy address" })).toBeInTheDocument();
  expect(within(sheet).getByRole("button", { name: "Lock" })).toBeInTheDocument();
  await user.click(within(within(sheet).getByRole("group", { name: "Appearance" })).getByRole("button", { name: "Dark" }));
  expect(theme.setTheme).toHaveBeenCalledWith("dark");

  await user.keyboard("{Escape}");
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Account menu" })).not.toBeInTheDocument());
  await waitFor(() => expect(screen.getByRole("button", { name: /Account menu/ })).toHaveFocus());
}, 30_000);

test("on a phone an action closes the sheet before it opens its own dialog", async () => {
  const user = userEvent.setup();
  useDesktopViewport(false);
  withTestWallet();
  await user.click(await screen.findByRole("button", { name: /Account menu/ }, { timeout: 20_000 }));
  await user.click(await screen.findByRole("button", { name: "Back up phrase" }));
  expect(await screen.findByRole("alertdialog")).toBeInTheDocument();
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Account menu" })).not.toBeInTheDocument());
}, 30_000);

test("on a desktop the menu is a popover", async () => {
  const user = userEvent.setup();
  withTestWallet();
  await user.click(await screen.findByRole("button", { name: /Account menu/ }, { timeout: 20_000 }));
  const menu = await screen.findByRole("dialog", { name: "Account menu" });
  expect(menu.getAttribute("data-slot")).toBe("popover-content");
}, 30_000);

test("the appearance switch is reachable by keyboard and chooses with Enter", async () => {
  const user = userEvent.setup();
  withTestWallet();
  await user.click(await screen.findByRole("button", { name: /Account menu/ }, { timeout: 20_000 }));
  const menu = await screen.findByRole("dialog", { name: "Account menu" });
  const group = within(menu).getByRole("group", { name: "Appearance" });
  // Tab from the first control of the menu reaches the switch without a pointer.
  within(menu).getByRole("button", { name: "Copy address" }).focus();
  for (let i = 0; i < 8 && !group.contains(document.activeElement); i++) await user.tab();
  expect(group.contains(document.activeElement)).toBe(true);
  await user.keyboard("{ArrowRight}");
  expect(document.activeElement).toBe(within(group).getByRole("button", { name: "Dark" }));
  await user.keyboard("{Enter}");
  expect(theme.setTheme).toHaveBeenCalledWith("dark");
}, 30_000);
