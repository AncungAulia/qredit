import { render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";

let refreshFailed = false;
let checking = false;
const business = { slug: "a", vault: "0x1", name: "Alpha", tagline: "t", services: [], operator: "0x2", spender: "0x3", startBlock: 1 };
vi.mock("@/modules/market", () => ({
  useMarketQuery: () => ({ data: [{ business }], isError: false, isRefetchError: false, refetch: vi.fn() }),
}));
vi.mock("@/modules/proof/api/useProofQuery", () => ({
  useProofQueries: () => [
    {
      data: checking ? undefined : [{ id: "books", status: "proven", detail: "The books add up." }],
      isError: refreshFailed,
      isRefetchError: refreshFailed,
      refetch: vi.fn(),
    },
  ],
}));
import { ClaimList } from "@/modules/proof/components/ClaimList";

test("a business keeps its results and shows a notice when its refresh failed", () => {
  refreshFailed = true;
  render(<ClaimList />);
  expect(screen.getByText("The books add up.")).toBeInTheDocument();
  expect(screen.getByText(/could not be refreshed/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
});

test("the claims tile is a skeleton, not a word, while the checks run", () => {
  checking = true;
  refreshFailed = false;
  render(<ClaimList />);
  checking = false;
  expect(screen.queryByText("Checking")).not.toBeInTheDocument();
  expect(screen.getAllByRole("status").length).toBeGreaterThan(0);
  expect(document.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(0);
});

test("no notice while the refresh works", () => {
  refreshFailed = false;
  render(<ClaimList />);
  expect(screen.queryByText(/could not be refreshed/)).not.toBeInTheDocument();
});