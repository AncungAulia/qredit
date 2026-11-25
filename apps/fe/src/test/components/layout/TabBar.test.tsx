import { render, screen } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import { TabBar } from "@/components/layout/TabBar";

let pathname = "/";
vi.mock("next/navigation", () => ({ usePathname: () => pathname }));
beforeEach(() => {
  pathname = "/";
});

test("is shown on a top-level page with the current section marked", () => {
  render(<TabBar />);
  expect(screen.getByRole("navigation", { name: "Main" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Market" })).toHaveAttribute("aria-current", "page");
});

test("is hidden on a detail page", () => {
  pathname = "/agents/x";
  render(<TabBar />);
  expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
});
