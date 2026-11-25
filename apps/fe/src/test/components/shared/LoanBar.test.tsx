import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { LoanBar } from "@/components/shared/LoanBar";

test("raising shows raised of target", () => {
  render(
    <LoanBar
      state="Raising"
      raised={20_000_000n}
      target={50_000_000n}
      repaid={0n}
      totalOwed={55_000_000n}
    />,
  );
  expect(screen.getByText("20.00")).toBeInTheDocument();
  expect(screen.getByText(/of 50.00 fUSD raised/)).toBeInTheDocument();
  expect(screen.getByText("40%")).toBeInTheDocument();
  expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "40");
});

test("repaying shows repaid of total owed", () => {
  render(
    <LoanBar
      state="Active"
      raised={50_000_000n}
      target={50_000_000n}
      repaid={11_000_000n}
      totalOwed={55_000_000n}
    />,
  );
  expect(screen.getByText("11.00")).toBeInTheDocument();
  expect(screen.getByText(/of 55.00 fUSD repaid/)).toBeInTheDocument();
  expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "20");
});

test("fills the ticks in proportion, 48 in all", () => {
  const { container } = render(
    <LoanBar
      state="Raising"
      raised={25_000_000n}
      target={50_000_000n}
      repaid={0n}
      totalOwed={0n}
    />,
  );
  const ticks = container.querySelectorAll("[data-tick]");
  expect(ticks).toHaveLength(48);
  expect(container.querySelectorAll('[data-tick="filled"]')).toHaveLength(24);
});
