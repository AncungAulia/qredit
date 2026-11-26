import { screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { TopBar } from "@/components/layout/TopBar";
import { memoryStorage, renderWithWallet } from "@/test/helpers/wallet";

vi.mock("next/navigation", () => ({ usePathname: () => "/agents/counterparty-check" }));
vi.mock("next-themes", () => ({ useTheme: () => ({ resolvedTheme: "light", setTheme: vi.fn() }) }));

test("marks Market active on a business page and links all four sections", () => {
  renderWithWallet(<TopBar />, { storage: memoryStorage() });
  expect(screen.getByRole("link", { name: "Market" })).toHaveAttribute("aria-current", "page");
  for (const label of ["Lend", "Inbox", "Proof"])
    expect(screen.getByRole("link", { name: label })).not.toHaveAttribute("aria-current");
});

test("keeps the theme button and offers to connect a wallet", () => {
  renderWithWallet(<TopBar />, { storage: memoryStorage() });
  expect(screen.getByRole("button", { name: "Switch to dark mode" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Connect wallet" })).toBeInTheDocument();
});
