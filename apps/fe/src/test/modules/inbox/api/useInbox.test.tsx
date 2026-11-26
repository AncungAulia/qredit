import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";

const readDelivery = vi.hoisted(() => vi.fn());
vi.mock("@/modules/inbox/api/inbox.api", async (orig) => ({
  ...(await orig<typeof import("@/modules/inbox/api/inbox.api")>()),
  readDelivery: (...a: unknown[]) => readDelivery(...a),
}));
vi.mock("@/modules/wallet/WalletProvider", () => ({ useWallet: () => ({ kind: "none" }) }));

import { DeliveryNotFound, ReportDoesNotMatch } from "@/modules/inbox/api/inbox.api";
import { useDeliveryQuery } from "@/modules/inbox/api/useInbox";

const VAULT = "0x37bbb37dd96a973a22ca64bc809a8bc4d54b03d4" as const;
const DEADLINE = new Date("2026-11-25T15:00:00Z");

let client: QueryClient;
const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;

beforeEach(() => {
  readDelivery.mockReset();
  client = new QueryClient();
});

test("the delivery is read from the placement block up to the deadline", async () => {
  readDelivery.mockResolvedValue({ ok: true });
  const { result } = renderHook(() => useDeliveryQuery(VAULT, "5", 100, DEADLINE, true), { wrapper });
  await waitFor(() => expect(result.current.isSuccess).toBe(true));
  expect(readDelivery).toHaveBeenCalledWith(VAULT, "5", 100, DEADLINE);
});

test("nothing is read until the order is delivered", () => {
  renderHook(() => useDeliveryQuery(VAULT, "5", 100, DEADLINE, false), { wrapper });
  expect(readDelivery).not.toHaveBeenCalled();
});

test("a missing delivery record is not asked for again on its own", async () => {
  readDelivery.mockImplementation(async () => { throw new DeliveryNotFound(); });
  const { result } = renderHook(() => useDeliveryQuery(VAULT, "5", 100, DEADLINE, true), { wrapper });
  await waitFor(() => expect(result.current.isError).toBe(true));
  expect(readDelivery).toHaveBeenCalledTimes(1);
});

test("a hash mismatch is final and is not asked for again", async () => {
  readDelivery.mockImplementation(async () => { throw new ReportDoesNotMatch(`0x${"11".repeat(32)}`, `0x${"22".repeat(32)}`); });
  const { result } = renderHook(() => useDeliveryQuery(VAULT, "5", 100, DEADLINE, true), { wrapper });
  await waitFor(() => expect(result.current.isError).toBe(true));
  expect(readDelivery).toHaveBeenCalledTimes(1);
});
