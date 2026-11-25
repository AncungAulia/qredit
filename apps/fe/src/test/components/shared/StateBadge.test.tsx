import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { StateBadge, vaultStateName } from "@/components/shared/StateBadge";

test("maps chain numbers to names", () => {
  expect([0, 1, 2, 3, 4].map(vaultStateName)).toEqual([
    "Raising",
    "Active",
    "Trapped",
    "Repaid",
    "Refunded",
  ]);
});

// Words are taken from the design: Badge/Neutral (Raising, Repaying), Badge/Warning (Trapped), Badge/Success (Repaid).
test.each([
  ["Raising", "Raising"],
  ["Active", "Repaying"],
  ["Trapped", "Trapped"],
  ["Repaid", "Repaid"],
  ["Refunded", "Refunded"],
] as const)("%s reads as %s", (state, label) => {
  render(<StateBadge state={state} />);
  expect(screen.getByText(label)).toBeInTheDocument();
});

test("an unknown state number is an error, never a guess", () => {
  expect(() => vaultStateName(7)).toThrow("Unknown vault state 7");
  expect(() => vaultStateName(-1)).toThrow("Unknown vault state -1");
});
