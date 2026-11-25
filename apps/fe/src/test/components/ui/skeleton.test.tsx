import { render } from "@testing-library/react";
import { expect, test } from "vitest";
import { Skeleton } from "@/components/ui/skeleton";

test("shimmers and never pulses", () => {
  const { container } = render(<Skeleton className="h-4" />);
  const el = container.firstElementChild!;
  expect(el).toHaveClass("animate-shimmer", "bg-surface-muted", "h-4");
  expect(el.className).not.toContain("animate-pulse");
});
