import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { OrderStatusBadge } from "@/components/shared/OrderStatusBadge";

// Copy from the design (Inbox, Normal): an accepted v2 order reads "Accepted", not "Delivered".
test.each([
  ["open", "Pending"],
  ["claimed", "In progress"],
  ["delivered", "Delivered"],
  ["in_review", "In review"],
  ["settled", "Accepted"],
  ["rejected", "Rejected"],
  ["declined", "Declined"],
  ["reclaimed", "Reclaimed"],
] as const)("%s reads as %s", (status, label) => {
  render(<OrderStatusBadge status={status} />);
  expect(screen.getByText(label)).toBeInTheDocument();
});

const NOW = Date.parse("2026-11-26T12:00:00Z");

test("an order in review shows the hours left", () => {
  render(<OrderStatusBadge status="in_review" reviewEnds={new Date(NOW + 23 * 3_600_000 + 600_000)} now={NOW} />);
  expect(screen.getByText("In review, 23 h left")).toBeInTheDocument();
});

test("a review in its last hour says less than 1 h", () => {
  render(<OrderStatusBadge status="in_review" reviewEnds={new Date(NOW + 1_000_000)} now={NOW} />);
  expect(screen.getByText("In review, less than 1 h left")).toBeInTheDocument();
});

test("a rejection shows what was refunded", () => {
  render(<OrderStatusBadge status="rejected" refund={400_000n} />);
  expect(screen.getByText("Rejected, 0.40 fUSD refunded")).toBeInTheDocument();
});
