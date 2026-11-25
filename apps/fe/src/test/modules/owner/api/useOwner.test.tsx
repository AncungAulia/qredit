import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";

const applyOrder = vi.fn();
vi.mock("@/modules/owner/api/owner.api", async (orig) => ({
  ...(await orig<object>()),
  applyOrder: (...a: unknown[]) => applyOrder(...a),
}));
vi.mock("@/modules/wallet/WalletProvider", () => ({
  useWallet: (select: (s: unknown) => unknown) => select({ session: { kind: "none" } }),
}));

import { useOwnerActions } from "@/modules/owner/api/useOwner";

const V = "0x1111111111111111111111111111111111111111" as const;
const order = { kind: 5, target: V, value: 1n, nonce: 0n, expiry: 1n };

beforeEach(() => {
  vi.clearAllMocks();
  applyOrder.mockResolvedValue("0xabc");
});

function setup() {
  const client = new QueryClient();
  const spy = vi.spyOn(client, "invalidateQueries");
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const { result } = renderHook(() => useOwnerActions(), { wrapper });
  return { result, spy };
}

test("a confirmed order refreshes the owner, market and business queries", async () => {
  const { result, spy } = setup();
  expect(await result.current.apply(V, order, Uint8Array.from([1]))).toBe("0xabc");
  const keys = spy.mock.calls.map((c) => (c[0] as { queryKey: readonly string[] }).queryKey);
  expect(keys).toContainEqual(["owner"]);
  expect(keys).toContainEqual(["market"]);
  // covers the rules and the supplier list of the business page
  expect(keys).toContainEqual(["business"]);
});

test("a refused send refreshes nothing", async () => {
  applyOrder.mockRejectedValue(new Error("no"));
  const { result, spy } = setup();
  await expect(result.current.apply(V, order, Uint8Array.from([1]))).rejects.toThrow("no");
  expect(spy).not.toHaveBeenCalled();
});
