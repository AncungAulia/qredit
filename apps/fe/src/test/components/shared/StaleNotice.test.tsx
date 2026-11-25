import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { StaleNotice } from "@/components/shared/StaleNotice";

test("says the figures may be out of date and retries on request", async () => {
  const onRetry = vi.fn();
  render(<StaleNotice onRetry={onRetry} />);
  expect(
    screen.getByText(/This section could not be refreshed\. The figures may be out of date\./),
  ).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Retry" }));
  expect(onRetry).toHaveBeenCalledTimes(1);
});