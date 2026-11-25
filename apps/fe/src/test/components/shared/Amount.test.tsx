import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { Amount } from "@/components/shared/Amount";

test("lg is the default design size", () => {
  render(<Amount units={12_340_000n} />);
  expect(screen.getByText("12").className).toContain("text-[56px]");
});

test("size changes the classes", () => {
  render(<Amount units={12_340_000n} size="sm" />);
  const whole = screen.getByText("12");
  expect(whole.className).toContain("text-xl");
  expect(whole.className).not.toContain("text-[56px]");
});
