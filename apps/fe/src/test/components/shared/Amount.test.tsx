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

test("the decimals sit in the same group as the whole part, with the unit once after it", () => {
  const { container } = render(<Amount units={20_000_000n} unit="fUSD" size="sm" />);
  const figure = screen.getByText("20").parentElement as HTMLElement;
  expect(figure.textContent).toBe("20.00");
  expect(figure.className).not.toMatch(/\bgap-/);
  expect(container.textContent).toBe("20.00fUSD");
});
