import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { Address } from "@/components/shared/Address";

test("shows the short form and keeps the full value for copy and title", () => {
  render(<Address value="0x487f449c21a48eaf9d2eb3804f511dfb7715eea9" />);
  const el = screen.getByText("0x487f…eea9");
  expect(el).toHaveAttribute("title", "0x487f449c21a48eaf9d2eb3804f511dfb7715eea9");
  expect(el.className).toContain("font-mono");
});

test("can show the qor1 form of an EVM address", () => {
  render(<Address value="0x487f449c21a48eaf9d2eb3804f511dfb7715eea9" kind="qor" />);
  expect(screen.getByText(/^qor1/)).toBeInTheDocument();
});
