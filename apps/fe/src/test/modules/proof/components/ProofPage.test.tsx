import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn() }),
  usePathname: () => "/proof",
  useSearchParams: () => new URLSearchParams("tab=attacks"),
}));
vi.mock("@/config/attacks", () => ({
  ATTACKS: [
    {
      id: "a",
      icon: () => null,
      title: "A leaked owner ECDSA key submits a policy order.",
      tried: "A policy order was signed with the classical owner key alone.",
      stoppedBy: "The vault checks an ML-DSA-87 signature.",
      txHash: null,
    },
    {
      id: "b",
      icon: () => null,
      title: "A stolen agent key calls another contract.",
      tried: "The agent key called an unlisted function.",
      stoppedBy: "The authenticator refuses it.",
      txHash: { kind: "cosmos", hash: "740D1C51219429394723759E9EF819554B89D77DCDE4409A25783C19386E1A6C" },
    },
  ],
}));
import { ProofPage } from "@/modules/proof/components/ProofPage";

const renderPage = (tab: "claims" | "attacks") =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ProofPage tab={tab} />
    </QueryClientProvider>,
  );

test("an attack without a recorded transaction says so", () => {
  renderPage("attacks");
  expect(screen.getByText("A leaked owner ECDSA key submits a policy order.")).toBeInTheDocument();
  expect(screen.getByText("Not recorded yet")).toBeInTheDocument();
});

test("a Cosmos transaction shows as a short hash, not as a link", () => {
  renderPage("attacks");
  expect(screen.getByText("740D1C…1A6C")).toBeInTheDocument();
  expect(screen.getAllByText("Not recorded yet")).toHaveLength(1);
  expect(screen.getByText("1", { selector: "span" })).toBeInTheDocument();
});
