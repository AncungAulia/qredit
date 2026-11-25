import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { OrderProgress } from "@/modules/orders/components/OrderProgress";

test("a skipped approval is shown as already allowed", () => {
  render(<OrderProgress step="buying" reached={["sealing", "posting", "window", "buying"]} />);
  expect(screen.getByText("Already allowed")).toBeInTheDocument();
  expect(screen.queryByText("Allowing the business to take payment")).not.toBeInTheDocument();
});

test("an approval that runs shows its running label", () => {
  render(<OrderProgress step="approving" reached={["sealing", "posting", "window", "approving"]} />);
  expect(screen.getByText("Allowing the business to take payment").closest("li")).toHaveAttribute("aria-current", "step");
});
