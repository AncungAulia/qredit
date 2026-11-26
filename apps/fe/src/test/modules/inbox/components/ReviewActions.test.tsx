import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, test, vi } from "vitest";

const accept = vi.fn();
const reject = vi.fn();
const refund = vi.fn();
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/modules/inbox/api/useInbox", () => ({
  useInboxActions: () => ({ accept, reject }),
  useRejectRefundQuery: (_v: string, _o: string, _p: bigint, enabled: boolean) =>
    enabled ? { data: refund(), isError: false, isFetching: false } : { data: undefined, isError: false, isFetching: false },
}));

import { ReviewActions } from "@/modules/inbox/components/ReviewActions";
import { useDesktopViewport } from "@/test/helpers/wallet";

beforeEach(() => {
  vi.resetAllMocks();
  useDesktopViewport();
});

const NOW = Date.parse("2026-11-26T12:00:00Z");
const order = { vault: "0x1" as const, orderId: "7", price: 250_000n, reviewEnds: new Date(NOW + (23 * 60 + 14) * 60_000) };
const business = { name: "Counterparty Check" };

test("the review bar names the time left and what a rejection returns", () => {
  refund.mockReturnValue(200_000n);
  render(<ReviewActions order={order} business={business} now={NOW} />);
  expect(screen.getByText("Review this report · 23 h 14 min left")).toBeInTheDocument();
  expect(screen.getByText(/Rejecting refunds 0\.20 fUSD\. The 0\.05 fUSD paid to suppliers stays with the business\. Silence counts as accepted\./)).toBeInTheDocument();
});

test("Reject asks first and lays out the three amounts", async () => {
  refund.mockReturnValue(200_000n);
  render(<ReviewActions order={order} business={business} now={NOW} />);
  await userEvent.click(screen.getByRole("button", { name: "Reject" }));
  expect(await screen.findByText("Reject this report?")).toBeInTheDocument();
  expect(screen.getByText(/The business keeps the 0\.05 fUSD it already paid its suppliers for this order\. This cannot be undone\./)).toBeInTheDocument();
  expect(screen.getByText("You paid")).toBeInTheDocument();
  expect(screen.getByText("Kept for supplier costs")).toBeInTheDocument();
  expect(screen.getByText("Refund to you")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Keep the report" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Reject and refund" })).toBeInTheDocument();
  expect(reject).not.toHaveBeenCalled();
});

test("Reject and refund sends the rejection", async () => {
  refund.mockReturnValue(200_000n);
  reject.mockResolvedValue("0xabc");
  render(<ReviewActions order={order} business={business} now={NOW} />);
  await userEvent.click(screen.getByRole("button", { name: "Reject" }));
  await userEvent.click(await screen.findByRole("button", { name: "Reject and refund" }));
  expect(reject).toHaveBeenCalledWith("0x1", "7");
});

test("Reject waits until the refund is read", () => {
  refund.mockReturnValue(undefined);
  render(<ReviewActions order={order} business={business} now={NOW} />);
  expect(screen.getByRole("button", { name: "Reject" })).toBeDisabled();
  expect(screen.queryByText(/Rejecting refunds 0/)).not.toBeInTheDocument();
});

test("Accept report asks first and says the sale is final", async () => {
  refund.mockReturnValue(200_000n);
  render(<ReviewActions order={order} business={business} now={NOW} />);
  await userEvent.click(screen.getByRole("button", { name: "Accept report" }));
  expect(await screen.findByText(/This cannot be undone/)).toBeInTheDocument();
  expect(accept).not.toHaveBeenCalled();
});
