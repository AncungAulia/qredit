import { fireEvent, render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
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

test("has no copy button by default, so it can sit inside a link", () => {
  render(<Address value="0x487f449c21a48eaf9d2eb3804f511dfb7715eea9" />);
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
});

test("copyable adds a named copy button that announces the copy", async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.assign(navigator, { clipboard: { writeText } });
  render(<Address value="0x487f449c21a48eaf9d2eb3804f511dfb7715eea9" copyable />);
  fireEvent.click(screen.getByRole("button", { name: "Copy address" }));
  expect(writeText).toHaveBeenCalledWith("0x487f449c21a48eaf9d2eb3804f511dfb7715eea9");
  expect(await screen.findByText("Address copied")).toBeInTheDocument();
});
