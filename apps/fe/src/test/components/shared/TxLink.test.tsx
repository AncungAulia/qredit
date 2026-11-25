import { render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

const hash = "0xabcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789";

afterEach(() => vi.resetModules());

async function load(explorerUrl: string) {
  vi.doMock("@/lib/env", () => ({ env: { explorerUrl } }));
  return (await import("@/components/shared/TxLink")).TxLink;
}

test("links to the explorer in a new tab when an explorer URL is set", async () => {
  const TxLink = await load("https://explorer.example");
  render(<TxLink hash={hash} />);
  const link = screen.getByRole("link", { name: /View transaction/ });
  expect(link).toHaveAttribute("href", `https://explorer.example/tx/${hash}`);
  expect(link).toHaveAttribute("target", "_blank");
});

test("shows the short hash as text without an explorer URL", async () => {
  const TxLink = await load("");
  render(<TxLink hash={hash} />);
  expect(screen.queryByRole("link")).not.toBeInTheDocument();
  expect(screen.getByTitle(hash)).toBeInTheDocument();
});

test("compact shows the short hash with an accessible name", async () => {
  const TxLink = await load("https://explorer.example");
  render(<TxLink hash={hash} compact />);
  const link = screen.getByRole("link", { name: "View transaction on the explorer" });
  expect(link).toHaveTextContent("0xabcd…6789");
  expect(link).toHaveAttribute("href", `https://explorer.example/tx/${hash}`);
});
