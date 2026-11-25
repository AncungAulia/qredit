import { render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { TopBar } from "@/components/layout/TopBar";

vi.mock("next/navigation", () => ({ usePathname: () => "/agents/counterparty-check" }));
vi.mock("next-themes", () => ({ useTheme: () => ({ resolvedTheme: "light", setTheme: vi.fn() }) }));

test("marks Market active on a business page and links all four sections", () => {
  render(<TopBar />);
  expect(screen.getByRole("link", { name: "Market" })).toHaveAttribute("aria-current", "page");
  for (const label of ["Lend", "Inbox", "Proof"])
    expect(screen.getByRole("link", { name: label })).not.toHaveAttribute("aria-current");
});
