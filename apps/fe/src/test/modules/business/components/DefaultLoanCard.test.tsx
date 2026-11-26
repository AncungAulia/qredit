import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, test, vi } from "vitest";

const dryRun = vi.fn();
const send = vi.fn();
vi.mock("@/modules/business/api/useBusinessPage", () => ({
  useDefaultDryRunQuery: () => dryRun(),
  useDefaultAction: () => send,
  useDefaultBooksQuery: () => ({ data: { opex: 2_000_000n, ownerOwed: 500_000n, bond: 1_200_000_000n } }),
}));
vi.mock("@/modules/wallet/WalletProvider", () => ({ useWallet: (pick: (s: unknown) => unknown) => pick({ session: { kind: "test" } }) }));
vi.mock("@/modules/wallet/signer", async (orig) => ({ ...(await orig<object>()), testWalletOf: () => ({ evm: "0x9" }) }));

import { DefaultLoanCard } from "@/modules/business/components/DefaultLoanCard";
import { LoanEndedNotice } from "@/modules/business/components/LoanEndedNotice";

beforeEach(() => vi.resetAllMocks());
const business = { vault: "0x1", name: "Due Diligence", slug: "due" } as never;
const vault = { state: "Active", bondHeld: 1_200_000_000n, defaultAfterMissed: 3, maturityGrace: 86_400, maturityAt: new Date(Date.now() + 1e9), swept: 0n } as never;

test("nothing shows while the vault would refuse the default", () => {
  dryRun.mockReturnValue({ data: { ok: false, reason: "x" } });
  const { container } = render(<DefaultLoanCard business={business} vault={vault} />);
  expect(container).toBeEmptyDOMElement();
});

test("when the dry run passes, the button asks first with the books and says it cannot be undone", async () => {
  dryRun.mockReturnValue({ data: { ok: true } });
  render(<DefaultLoanCard business={business} vault={vault} />);
  expect(screen.getByText("Repayments are 3 installments behind")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Default this loan" }));
  expect(await screen.findByText("Default this loan?")).toBeInTheDocument();
  expect(screen.getByText("Owner bond")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Default the loan" })).toBeInTheDocument();
  expect(send).not.toHaveBeenCalled();
});

test("past maturity the title says so", () => {
  dryRun.mockReturnValue({ data: { ok: true } });
  render(<DefaultLoanCard business={business} vault={{ ...(vault as object), maturityAt: new Date(Date.now() - 1e9) } as never} />);
  expect(screen.getByText("The loan is past its maturity and grace")).toBeInTheDocument();
});

test("an ended loan says how it ended", () => {
  const { rerender } = render(<LoanEndedNotice vault={{ ...(vault as object), state: "Defaulted", swept: 5_000_000n } as never} />);
  expect(screen.getByText("This loan defaulted")).toBeInTheDocument();
  rerender(<LoanEndedNotice vault={{ ...(vault as object), state: "Closed" } as never} />);
  expect(screen.getByText("The owner closed this business")).toBeInTheDocument();
});
