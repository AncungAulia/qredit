import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { ApiError } from "@/lib/apiClient";

vi.mock("@/modules/market", async (orig) => ({
  ...(await orig<object>()),
  useBusinessQuery: () => ({
    isPending: false,
    isError: true,
    error: new ApiError("notFound", 404),
    refetch: vi.fn(),
  }),
}));
import { BusinessPage } from "@/modules/business/components/BusinessPage";

test("an unknown slug shows the not-found state", () => {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <BusinessPage slug="nope" />
    </QueryClientProvider>,
  );
  expect(screen.getByText("This business does not exist.")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /market/i })).toHaveAttribute("href", "/");
});
