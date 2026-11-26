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

test("the feature tile shows the sky photo with white text, the same in both themes", () => {
  const { container } = render(<KpiTile variant="feature" label="L" value="1" />);
  const tile = container.firstElementChild as HTMLElement;
  expect(tile.className).toContain("/kpi/feature-sky.webp");
  expect(tile.className).not.toContain("dark:");
  expect(screen.getByText("1").className).toContain("text-white");
});

test("the soft tile switches its background image with the theme", () => {
  const { container } = render(<KpiTile variant="soft" label="L" value="1" />);
  const tile = container.firstElementChild as HTMLElement;
  expect(tile.className).toContain("/kpi/soft-light.webp");
  expect(tile.className).toContain("dark:bg-[url('/kpi/soft-dark.webp')]");
  expect(tile.className).toContain("bg-right");
});
