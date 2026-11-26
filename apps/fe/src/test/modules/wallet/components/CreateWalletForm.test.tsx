import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, test, vi } from "vitest";

const generateMnemonic = vi.hoisted(() => vi.fn());
vi.mock("@qorechain/sdk", async (orig) => ({
  ...(await orig<typeof import("@qorechain/sdk")>()),
  generateMnemonic: (...a: unknown[]) => generateMnemonic(...a),
}));

import { CreateWalletForm } from "@/modules/wallet/components/CreateWalletForm";
import { memoryStorage, renderWithWallet } from "@/test/helpers/wallet";

const PHRASE_24 = Array.from({ length: 24 }, (_, i) => `word${i + 1}`).join(" ");

beforeEach(() => generateMnemonic.mockReset());

test("the phrase appears once the key code has loaded", async () => {
  generateMnemonic.mockReturnValue(PHRASE_24);
  renderWithWallet(<CreateWalletForm onCreated={vi.fn()} />, { storage: memoryStorage() });
  expect(await screen.findByText("word24")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Create test wallet" })).toBeEnabled();
}, 30_000);

test("a failed load shows a failure with a retry, not an endless skeleton, and the retry shows the phrase", async () => {
  const user = userEvent.setup();
  generateMnemonic.mockImplementationOnce(() => {
    throw new Error("chunk failed to load");
  });
  generateMnemonic.mockReturnValue(PHRASE_24);
  renderWithWallet(<CreateWalletForm onCreated={vi.fn()} />, { storage: memoryStorage() });
  expect(await screen.findByText("The recovery phrase could not be prepared. Please try again.")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Create test wallet" })).toBeDisabled();
  await user.click(screen.getByRole("button", { name: "Try again" }));
  expect(await screen.findByText("word24")).toBeInTheDocument();
  expect(screen.queryByText("The recovery phrase could not be prepared. Please try again.")).not.toBeInTheDocument();
}, 30_000);
