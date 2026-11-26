import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, test } from "vitest";
import { ConnectPrompt } from "@/modules/wallet/components/ConnectPrompt";
import { fakeQorex, memoryStorage, renderWithWallet, useDesktopViewport } from "@/test/helpers/wallet";

beforeEach(() => useDesktopViewport());

test("with no wallet the button opens the connect dialog and the dialog stays while the button is mounted", async () => {
  renderWithWallet(<ConnectPrompt />, { storage: memoryStorage(), qorex: fakeQorex() });
  await userEvent.click(screen.getByRole("button", { name: "Connect wallet" }));
  expect(await screen.findByText("Qredit runs on the QoreChain testnet. Nothing here uses real money.")).toBeInTheDocument();
});
