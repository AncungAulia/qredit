import { useState } from "react";
import { expect, test } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NumberInput, sanitizeNumber } from "@/components/shared/NumberInput";

function Harness({ decimals = 6, initial = "" }: { decimals?: number; initial?: string }) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <NumberInput aria-label="Amount" value={value} onValueChange={setValue} decimals={decimals} suffix="fUSD" />
      <output>{value === "" ? "empty" : value}</output>
    </>
  );
}

test("sanitize keeps digits and one dot, limits decimals and drops leading zeros", () => {
  expect(sanitizeNumber("1,250.5x", 6)).toBe("1250.5");
  expect(sanitizeNumber("007", 6)).toBe("7");
  expect(sanitizeNumber("0.5", 6)).toBe("0.5");
  expect(sanitizeNumber("1.2.3", 6)).toBe("1.23");
  expect(sanitizeNumber("1.1234567", 6)).toBe("1.123456");
  expect(sanitizeNumber(".5", 6)).toBe("0.5");
  expect(sanitizeNumber("abc", 6)).toBe("");
  expect(sanitizeNumber("12.5", 0)).toBe("125");
});

test("groups thousands while typing and reports the raw text", async () => {
  render(<Harness />);
  await userEvent.type(screen.getByLabelText("Amount"), "1250000.5");
  expect(screen.getByLabelText("Amount")).toHaveValue("1,250,000.5");
  expect(screen.getByRole("status")).toHaveTextContent("1250000.5");
});

test("stays empty when cleared and shows the suffix inside the field", async () => {
  render(<Harness initial="500" />);
  expect(screen.getByLabelText("Amount")).toHaveValue("500");
  expect(screen.getByText("fUSD")).toBeInTheDocument();
  await userEvent.clear(screen.getByLabelText("Amount"));
  expect(screen.getByRole("status")).toHaveTextContent("empty");
});

test("follows a value set from outside", () => {
  render(<Harness initial="3600" />);
  expect(screen.getByLabelText("Amount")).toHaveValue("3,600");
});
