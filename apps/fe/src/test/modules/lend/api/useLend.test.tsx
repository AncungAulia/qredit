import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { expect, test, vi } from "vitest";

vi.mock("@/modules/wallet/WalletProvider", () => ({
  useWallet: (select: (s: unknown) => unknown) => select({ session: { kind: "none" } }),
}));
const api = vi.hoisted(() => ({
  lend: vi.fn(async () => ({ depositTx: "0xaa" })),
  claim: vi.fn(async () => "0xbb"),
  refund: vi.fn(async () => "0xcc"),
}));
vi.mock("@/modules/lend/api/lend.api", () => ({ ...api, readFusdBalance: vi.fn(), readPositions: vi.fn() }));

import { lendKeys } from "@/modules/lend/api/lend.keys";
import { useLendActions } from "@/modules/lend/api/useLend";
import { marketKeys } from "@/modules/market";
import { walletKeys } from "@/modules/wallet/api/useWalletStatus";

const VAULT = "0x1111111111111111111111111111111111111111" as const;

function setup() {
  const client = new QueryClient();
  const spy = vi.spyOn(client, "invalidateQueries");
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const { result } = renderHook(() => useLendActions(), { wrapper });
  return { result, spy };
}
const invalidated = (spy: ReturnType<typeof setup>["spy"]) =>
  spy.mock.calls.map((c: unknown[]) => (c[0] as { queryKey: unknown }).queryKey);

test.each([
  ["lend", (a: ReturnType<typeof setup>["result"]["current"]) => a.lend(VAULT, 1n)],
  ["claim", (a: ReturnType<typeof setup>["result"]["current"]) => a.claim(VAULT)],
  ["refund", (a: ReturnType<typeof setup>["result"]["current"]) => a.refund(VAULT)],
])("after %s succeeds the market, lending and wallet status queries are refetched", async (_name, act) => {
  const { result, spy } = setup();
  await act(result.current);
  const keys = invalidated(spy);
  expect(keys).toContainEqual(marketKeys.all);
  expect(keys).toContainEqual(lendKeys.all);
  expect(keys).toContainEqual(walletKeys.all);
});

test("a failed action refetches nothing", async () => {
  api.claim.mockRejectedValueOnce(new Error("no"));
  const { result, spy } = setup();
  await expect(result.current.claim(VAULT)).rejects.toThrow();
  expect(spy).not.toHaveBeenCalled();
});
