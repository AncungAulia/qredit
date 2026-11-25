import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, test, vi } from "vitest";
import type { WalletChainStatus } from "@/modules/wallet/schemas/wallet.schema";

const wallet = vi.hoisted(() => ({ session: { kind: "test", evm: "0x1", account: {}, sealKeys: {} } as { kind: string } }));
vi.mock("@/modules/wallet/WalletProvider", () => ({
  useWallet: (select: (s: unknown) => unknown) => select({ session: wallet.session, hydrated: true }),
}));
const query = vi.hoisted(() => ({
  data: undefined as unknown,
  isPending: false,
  isError: false,
  refetch: vi.fn(),
}));
vi.mock("@/modules/wallet/api/useWalletStatus", () => ({ useWalletStatusQuery: () => query }));
vi.mock("@/modules/wallet/components/WalletSetup", () => ({ WalletSetup: () => <p>setup steps</p> }));

import { RequireReadyWallet } from "@/modules/wallet/components/RequireReadyWallet";

const ready: WalletChainStatus = {
  qor: 5n,
  fusdBank: 0n,
  fusd: 50n,
  pqcRegistered: true,
  kemRegistered: true,
  cardPublished: true,
};

const show = () =>
  render(
    <RequireReadyWallet>
      <p>the form</p>
    </RequireReadyWallet>,
  );

beforeEach(() => {
  vi.clearAllMocks();
  wallet.session = { kind: "test" };
  query.data = ready;
  query.isPending = false;
  query.isError = false;
});

test("a ready wallet sees the children", () => {
  show();
  expect(screen.getByText("the form")).toBeInTheDocument();
  expect(screen.queryByText("Finish setting up your wallet")).not.toBeInTheDocument();
});

test("a wallet with fUSD that is not converted sees the setup state, not the children", () => {
  query.data = { ...ready, fusdBank: 50_000_000n, fusd: 0n };
  show();
  expect(screen.getByText("Finish setting up your wallet")).toBeInTheDocument();
  expect(screen.getByText("setup steps")).toBeInTheDocument();
  expect(screen.queryByText("the form")).not.toBeInTheDocument();
});

test("an unregistered key sees the setup state", () => {
  query.data = { ...ready, pqcRegistered: false };
  show();
  expect(screen.getByText("Finish setting up your wallet")).toBeInTheDocument();
});

test("loading shows a skeleton, not the children", () => {
  query.data = undefined;
  query.isPending = true;
  show();
  expect(screen.getByRole("status")).toHaveAttribute("aria-busy", "true");
  expect(screen.queryByText("the form")).not.toBeInTheDocument();
});

test("a failed status read shows an error with a retry", async () => {
  query.data = undefined;
  query.isError = true;
  show();
  await userEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(query.refetch).toHaveBeenCalled();
  expect(screen.queryByText("the form")).not.toBeInTheDocument();
});

test("without a test wallet the children are left to their own not-connected state", () => {
  wallet.session = { kind: "none" };
  show();
  expect(screen.getByText("the form")).toBeInTheDocument();
});
