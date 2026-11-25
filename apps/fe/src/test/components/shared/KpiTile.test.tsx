import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { KpiTile } from "@/components/shared/KpiTile";

test("shows the figure and its unit", () => {
  render(<KpiTile label="Target" value="1,000" unit="fUSD" />);
  expect(screen.getByText("1,000")).toBeInTheDocument();
  expect(screen.getByText("fUSD")).toBeInTheDocument();
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
});

test("shows a shimmer skeleton of the figure, never a word, while the value loads", () => {
  const { container } = render(<KpiTile variant="feature" label="Claims proven" value={undefined} />);
  expect(screen.getByRole("status")).toHaveAttribute("aria-busy", "true");
  const skeleton = container.querySelector('[data-slot="skeleton"]');
  expect(skeleton).not.toBeNull();
  expect(skeleton?.className).toContain("animate-shimmer");
  expect(skeleton?.className).toContain("h-8");
  expect(screen.queryByText("Checking")).not.toBeInTheDocument();
});

test("feature art hangs from the right edge and scales with the tile", () => {
  const { container } = render(<KpiTile variant="feature" label="L" value="1" />);
  const box = container.querySelector("img")?.parentElement;
  expect(box?.className).toContain("-right-5");
  expect(box?.className).toContain("w-[min(250px,60%)]");
});

test("soft art spans the whole tile", () => {
  const { container } = render(<KpiTile variant="soft" label="L" value="1" />);
  expect(container.querySelector(".inset-0.overflow-hidden")).not.toBeNull();
});
