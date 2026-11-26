import { screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { HeaderThemeButton } from "@/components/layout/HeaderThemeButton";
import { Boot, PASSWORD, PHRASE, fakeQorex, memoryStorage, renderWithWallet } from "@/test/helpers/wallet";

vi.mock("next-themes", () => ({ useTheme: () => ({ resolvedTheme: "light", setTheme: vi.fn() }) }));

const theme = () => screen.queryByRole("button", { name: "Switch to dark mode" });

test("without a wallet the header keeps the theme button", async () => {
  renderWithWallet(<HeaderThemeButton />, { storage: memoryStorage(), qorex: fakeQorex("notInstalled") });
  expect(await screen.findByRole("button", { name: "Switch to dark mode" })).toBeInTheDocument();
});

test("an unlocked test wallet moves the theme into the account menu", async () => {
  renderWithWallet(
    <Boot run={(s) => s.create(PHRASE, PASSWORD)}>
      <HeaderThemeButton />
    </Boot>,
    { storage: memoryStorage(), qorex: fakeQorex("notInstalled") },
  );
  await vi.waitFor(() => expect(theme()).not.toBeInTheDocument(), { timeout: 20_000 });
}, 30_000);

test("a QoreX session moves the theme into the account menu", async () => {
  renderWithWallet(
    <Boot run={(s) => s.connectQorex()}>
      <HeaderThemeButton />
    </Boot>,
    { storage: memoryStorage(), qorex: fakeQorex("ready") },
  );
  await vi.waitFor(() => expect(theme()).not.toBeInTheDocument());
});

test("a locked wallet keeps the header button, because its pill opens the unlock form and no menu", async () => {
  renderWithWallet(
    <Boot
      run={async (s) => {
        await s.create(PHRASE, PASSWORD);
        s.lock();
      }}
    >
      <HeaderThemeButton />
    </Boot>,
    { storage: memoryStorage(), qorex: fakeQorex("notInstalled") },
  );
  expect(await screen.findByRole("button", { name: "Switch to dark mode" }, { timeout: 20_000 })).toBeInTheDocument();
}, 30_000);
