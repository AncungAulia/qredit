import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, test, vi } from "vitest";
import { readStored } from "@/modules/wallet/keystore";
import { QOREX_UNAVAILABLE_SENTENCE } from "@/modules/wallet/qorex";
import { ConnectDialog } from "@/modules/wallet/components/ConnectDialog";
import { readWalletStatus } from "@/modules/wallet/api/wallet.api";
import { useWallet } from "@/modules/wallet";
import { Boot, PASSWORD, PHRASE, fakeQorex, memoryStorage, renderWithWallet, useDesktopViewport } from "@/test/helpers/wallet";

vi.mock("@/modules/wallet/api/wallet.api", async (orig) => ({
  ...(await orig<typeof import("@/modules/wallet/api/wallet.api")>()),
  readWalletStatus: vi.fn(),
  claimFaucet: vi.fn(),
}));

const fresh = { qor: 0n, fusdBank: 0n, fusd: 0n, pqcRegistered: false, kemRegistered: false, cardPublished: false };

function Probe() {
  const kind = useWallet((s) => s.session.kind);
  return <output aria-label="session">{kind}</output>;
}

beforeEach(() => {
  useDesktopViewport();
  vi.mocked(readWalletStatus).mockReset().mockResolvedValue(fresh);
});

test("the choice shows both ways in, with the test wallet labelled as a throwaway", async () => {
  renderWithWallet(<ConnectDialog open onOpenChange={vi.fn()} />, { qorex: fakeQorex("ready") });
  expect(screen.getByText("Connect a wallet")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /QoreX/ })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /Test wallet in this browser/ })).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: /Test wallet in this browser/ }));
  expect(screen.getByText(/throwaway wallet for the QoreChain testnet/i)).toBeInTheDocument();
});

test("create shows the phrase once, asks for the password twice, encrypts and starts setup", async () => {
  const user = userEvent.setup();
  const storage = memoryStorage();
  renderWithWallet(
    <>
      <Probe />
      <ConnectDialog open onOpenChange={vi.fn()} />
    </>,
    { storage },
  );
  await user.click(screen.getByRole("button", { name: /Test wallet in this browser/ }));
  await user.click(screen.getByRole("button", { name: "Create a new test wallet" }));

  // A 24-word phrase is shown and nothing is stored yet.
  const words = screen.getByRole("list", { name: "Recovery phrase" }).textContent!.trim().split(/\s+/);
  expect(words).toHaveLength(24);
  expect(readStored(storage)).toBeNull();

  await user.type(screen.getByLabelText("Password"), PASSWORD);
  await user.type(screen.getByLabelText("Repeat the password"), "something else");
  await user.tab();
  expect(await screen.findByText("The passwords do not match.")).toBeInTheDocument();
  await user.clear(screen.getByLabelText("Repeat the password"));
  await user.type(screen.getByLabelText("Repeat the password"), PASSWORD);

  // The phrase must be saved first.
  await user.click(screen.getByRole("button", { name: "Create test wallet" }));
  const savedError = await screen.findByText("Confirm that you saved the recovery phrase.");
  expect(savedError).toBeInTheDocument();
  expect(screen.getByRole("checkbox", { name: "I saved the recovery phrase" })).toHaveAttribute("aria-describedby", savedError.closest("[id]")!.id);
  expect(readStored(storage)).toBeNull();

  // The label toggles the checkbox, and the error is tied to it.
  const saved = screen.getByRole("checkbox", { name: "I saved the recovery phrase" });
  await user.click(screen.getByText("I saved the recovery phrase"));
  expect(saved).toBeChecked();
  await user.click(screen.getByRole("button", { name: "Create test wallet" }));

  // The wallet is encrypted (the stored record never holds the phrase) and the setup list appears.
  expect(await screen.findByRole("button", { name: "Get test funds" }, { timeout: 20_000 })).toBeInTheDocument();
  const stored = readStored(storage);
  expect(stored?.address).toMatch(/^qor1/);
  expect(JSON.stringify(stored)).not.toContain(words[0] + " " + words[1]);
  expect(screen.getByLabelText("session")).toHaveTextContent("test");
}, 60_000);

test("import validates the phrase and starts setup", async () => {
  const user = userEvent.setup();
  const storage = memoryStorage();
  renderWithWallet(<ConnectDialog open onOpenChange={vi.fn()} />, { storage });
  await user.click(screen.getByRole("button", { name: /Test wallet in this browser/ }));
  await user.click(screen.getByRole("button", { name: "Import a recovery phrase" }));
  await user.type(screen.getByLabelText("Recovery phrase"), "not a real phrase at all");
  await user.type(screen.getByLabelText("Password"), PASSWORD);
  await user.tab();
  expect(await screen.findByText("This is not a valid recovery phrase.")).toBeInTheDocument();
  await user.clear(screen.getByLabelText("Recovery phrase"));
  await user.type(screen.getByLabelText("Recovery phrase"), PHRASE);
  await user.click(screen.getByRole("button", { name: "Import test wallet" }));
  expect(await screen.findByRole("button", { name: "Get test funds" }, { timeout: 20_000 })).toBeInTheDocument();
  expect(readStored(storage)).not.toBeNull();
}, 60_000);

test("a wrong password shows the error under the field and keeps the wallet locked", async () => {
  const user = userEvent.setup();
  const storage = memoryStorage();
  renderWithWallet(
    <>
      <Probe />
      <Boot
        run={async (s) => {
          await s.create(PHRASE, PASSWORD);
          s.lock();
        }}
      >
        <ConnectDialog open onOpenChange={vi.fn()} initialView="unlock" />
      </Boot>
    </>,
    { storage },
  );
  const field = await screen.findByLabelText("Password");
  await user.type(field, "wrong password");
  await user.click(screen.getByRole("button", { name: "Unlock" }));
  const message = await screen.findByText("The password is not correct.", undefined, { timeout: 20_000 });
  expect(field.closest("[data-slot=field]")).toContainElement(message);
  expect(field).toHaveAttribute("aria-invalid", "true");
  expect(screen.getByLabelText("session")).toHaveTextContent("locked");
}, 60_000);

test("the right password unlocks and closes the dialog", async () => {
  const user = userEvent.setup();
  const onOpenChange = vi.fn();
  renderWithWallet(
    <>
      <Probe />
      <Boot
        run={async (s) => {
          await s.create(PHRASE, PASSWORD);
          s.lock();
        }}
      >
        <ConnectDialog open onOpenChange={onOpenChange} initialView="unlock" />
      </Boot>
    </>,
    { storage: memoryStorage() },
  );
  await user.type(await screen.findByLabelText("Password"), PASSWORD);
  await user.click(screen.getByRole("button", { name: "Unlock" }));
  await waitFor(() => expect(screen.getByLabelText("session")).toHaveTextContent("test"), { timeout: 20_000 });
  expect(onOpenChange).toHaveBeenCalledWith(false);
}, 60_000);

test("forgetting the wallet asks first and removes it only after the confirmation", async () => {
  const user = userEvent.setup();
  const storage = memoryStorage();
  renderWithWallet(
    <>
      <Probe />
      <Boot
        run={async (s) => {
          await s.create(PHRASE, PASSWORD);
          s.lock();
        }}
      >
        <ConnectDialog open onOpenChange={vi.fn()} initialView="unlock" />
      </Boot>
    </>,
    { storage },
  );
  await user.click(await screen.findByRole("button", { name: "Forget this wallet" }));
  const confirm = await screen.findByRole("alertdialog");
  expect(within(confirm).getByText(/recovery phrase/i)).toBeInTheDocument();
  expect(readStored(storage)).not.toBeNull();
  await user.click(within(confirm).getByRole("button", { name: "Cancel" }));
  expect(readStored(storage)).not.toBeNull();

  await user.click(screen.getByRole("button", { name: "Forget this wallet" }));
  await user.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Forget wallet" }));
  await waitFor(() => expect(readStored(storage)).toBeNull());
  expect(screen.getByLabelText("session")).toHaveTextContent("none");
}, 60_000);

test("QoreX not installed links to the install page and keeps the test wallet", () => {
  renderWithWallet(<ConnectDialog open onOpenChange={vi.fn()} />, { qorex: fakeQorex("notInstalled") });
  const link = screen.getByRole("link", { name: /Install QoreX/ });
  expect(link).toHaveAttribute("target", "_blank");
  expect(screen.getByText("Not found in this browser. Install it, then return to this page.")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /Test wallet in this browser/ })).toBeEnabled();
});

test("QoreX connecting waits for approval", async () => {
  const user = userEvent.setup();
  let release!: () => void;
  const qorex = fakeQorex(
    "ready",
    () =>
      new Promise((resolve) => {
        release = () => resolve({ address: "qor1abc", evm: "0x0000000000000000000000000000000000000002" });
      }),
  );
  renderWithWallet(<ConnectDialog open onOpenChange={vi.fn()} />, { qorex });
  await user.click(screen.getByRole("button", { name: /QoreX/ }));
  expect(await screen.findByText("Approve the connection in the QoreX window.")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /Test wallet in this browser/ })).toBeDisabled();
  release();
});

test("QoreX that rejects the connection says to switch it to the testnet", async () => {
  const user = userEvent.setup();
  const connect = vi.fn(() => Promise.reject(new Error("wrong chain")));
  const qorex = fakeQorex("ready", connect);
  renderWithWallet(<ConnectDialog open onOpenChange={vi.fn()} />, { qorex });
  await user.click(screen.getByRole("button", { name: /QoreX/ }));
  expect(await screen.findByText(QOREX_UNAVAILABLE_SENTENCE)).toBeInTheDocument();
  expect(QOREX_UNAVAILABLE_SENTENCE).toContain("tap the version text seven times");
  expect(QOREX_UNAVAILABLE_SENTENCE).toContain("approve the request in QoreX");
});

test("the Connect QoreX press looks for the extension again, because it may inject late", async () => {
  const user = userEvent.setup();
  let present = false;
  const connect = vi.fn(async () => ({ address: "qor1late", evm: "0x0000000000000000000000000000000000000003" as const }));
  const qorex = { ...fakeQorex("notInstalled", connect), detect: vi.fn(() => (present ? ("ready" as const) : ("notInstalled" as const))) };
  const onOpenChange = vi.fn();
  renderWithWallet(
    <>
      <Probe />
      <ConnectDialog open onOpenChange={onOpenChange} />
    </>,
    { qorex },
  );
  present = true; // the extension injected itself after the page loaded
  await user.click(screen.getByRole("link", { name: /Install QoreX/ }));
  await waitFor(() => expect(connect).toHaveBeenCalled());
  await waitFor(() => expect(screen.getByLabelText("session")).toHaveTextContent("qorex"));
  expect(onOpenChange).toHaveBeenCalledWith(false);
});

test("a mismatch is reported even while the password is still too short", async () => {
  const user = userEvent.setup();
  renderWithWallet(<ConnectDialog open onOpenChange={vi.fn()} />, { storage: memoryStorage() });
  await user.click(screen.getByRole("button", { name: /Test wallet in this browser/ }));
  await user.click(screen.getByRole("button", { name: "Create a new test wallet" }));
  await user.type(screen.getByLabelText("Password"), "abc");
  await user.type(screen.getByLabelText("Repeat the password"), "abd");
  await user.tab();
  expect(await screen.findByText("The passwords do not match.")).toBeInTheDocument();
  expect(screen.getByText("The password must have at least 8 characters.")).toBeInTheDocument();
});
