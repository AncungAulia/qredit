import { beforeEach, expect, test, vi } from "vitest";

const readContract = vi.fn();
const getBlock = vi.fn();
vi.mock("@/lib/chain", () => ({
  publicClient: {
    readContract: (...a: unknown[]) => readContract(...a),
    getBlock: (...a: unknown[]) => getBlock(...a),
  },
}));
const get = vi.fn();
vi.mock("@/lib/apiClient", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/apiClient")>()),
  api: { get: (...a: unknown[]) => get(...a) },
}));

import { ApiError } from "@/lib/apiClient";
import {
  getBusiness,
  getLatestOrders,
  pickLatestOrders,
  readVaultSnapshot,
  toMarketEntry,
} from "@/modules/market/api/market.api";

beforeEach(() => vi.clearAllMocks());

const business = (slug: string) =>
  ({
    slug,
    vault: "0x1",
    name: slug,
    tagline: "",
    services: [{ id: 0, name: "Grade", priceUnits: 250000n }],
    operator: "0x2",
    spender: "0x3",
    startBlock: 1,
  }) as never;

test("reads and names the vault state", async () => {
  readContract.mockImplementation(({ functionName }: { functionName: string }) => {
    const values: Record<string, unknown> = {
      state: 1,
      raised: 50_000_000n,
      repaid: 11_000_000n,
      paused: false,
      lenderBps: 7000,
      loan: [50_000_000n, 55_000_000n, 1795500000n, 3600n, 600n, 5_000_000n],
    };
    return Promise.resolve(values[functionName]);
  });
  const s = await readVaultSnapshot("0x37bbb37dd96a973a22ca64bc809a8bc4d54b03d4");
  expect(s.state).toBe("Active");
  expect(s.target).toBe(50_000_000n);
  expect(s.totalOwed).toBe(55_000_000n);
  expect(s.installment).toBe(5_000_000n);
  expect(s.lenderBps).toBe(7000);
  expect(s.raiseDeadline).toEqual(new Date(1795500000 * 1000));
});

test("an unknown vault state is an error, never a guess", async () => {
  readContract.mockResolvedValue(9);
  await expect(readVaultSnapshot("0x1")).rejects.toThrow();
});

test("summarises orders for a card", () => {
  const orders = [
    { status: "delivered", placedBlock: 10 },
    { status: "open", placedBlock: 12 },
  ] as never;
  const e = toMarketEntry(business("a"), { state: "Active" } as never, orders);
  expect(e.ordersDelivered).toBe(1);
  expect(e.orders).toHaveLength(2);
});

test("a business response of the wrong shape is invalid, a missing one is notFound", async () => {
  get.mockResolvedValue({ data: { nope: true } });
  await expect(getBusiness("x")).rejects.toMatchObject({ kind: "invalid" });
  get.mockRejectedValue(new ApiError("notFound", 404));
  await expect(getBusiness("x")).rejects.toMatchObject({ kind: "notFound" });
});

test("picks the newest orders across businesses", () => {
  const entries = [
    {
      business: business("a"),
      orders: [
        { placedBlock: 5, orderId: "1", serviceId: 0 },
        { placedBlock: 30, orderId: "2", serviceId: 0 },
      ],
    },
    { business: business("b"), orders: [{ placedBlock: 20, orderId: "3", serviceId: 0 }] },
  ] as never;
  const picked = pickLatestOrders(entries, 2);
  expect(picked.map((p) => p.order.orderId)).toEqual(["2", "3"]);
  expect(picked[0].business.slug).toBe("a");
  expect(picked[0].serviceName).toBe("Grade");
});

test("gives each latest order the time of its block", async () => {
  getBlock.mockResolvedValue({ timestamp: 1_800_000_000n });
  const refs = pickLatestOrders(
    [
      { business: business("a"), orders: [{ placedBlock: 30, orderId: "2", serviceId: 0 }] },
    ] as never,
    4,
  );
  const [row] = await getLatestOrders(refs);
  expect(getBlock).toHaveBeenCalledWith({ blockNumber: 30n });
  expect(row.placedAt).toEqual(new Date(1_800_000_000 * 1000));
});
