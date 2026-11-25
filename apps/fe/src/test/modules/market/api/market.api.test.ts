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
  countDelivered,
  getBlockTimes,
  getBusiness,
  getMarket,
  isFailed,
  pickLatestOrders,
  readVaultSnapshot,
  toMarketEntry,
} from "@/modules/market/api/market.api";

beforeEach(() => vi.resetAllMocks());

const business = (slug: string, vault = "0x1") =>
  ({
    slug,
    vault,
    name: slug,
    tagline: "",
    services: [{ id: 0, name: "Grade", priceUnits: 250000n }],
    operator: "0x2",
    spender: "0x3",
    startBlock: 1,
  }) as never;

const wire = (slug: string, vault: string) => ({
  slug,
  vault,
  name: slug,
  tagline: "t",
  services: [{ id: 0, name: "Grade", priceUnits: "250000" }],
  operator: "0x2",
  spender: "0x3",
  startBlock: 1,
});

const VAULT_VALUES: Record<string, unknown> = {
  state: 1,
  raised: 50_000_000n,
  repaid: 11_000_000n,
  paused: false,
  lenderBps: 7000,
  loan: [50_000_000n, 55_000_000n, 1795500000n, 3600n, 600n, 5_000_000n],
};

test("reads and names the vault state", async () => {
  readContract.mockImplementation(({ functionName }: { functionName: string }) =>
    Promise.resolve(VAULT_VALUES[functionName]),
  );
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

test("one unreadable vault becomes a failed row and the others still load", async () => {
  get.mockImplementation((url: string) =>
    Promise.resolve({
      data: url === "/v1/businesses" ? [wire("a", "0xaa"), wire("b", "0xbb")] : [],
    }),
  );
  readContract.mockImplementation(
    ({ address, functionName }: { address: string; functionName: string }) =>
      address === "0xbb"
        ? Promise.reject(new Error("rpc down"))
        : Promise.resolve(VAULT_VALUES[functionName]),
  );
  const rows = await getMarket();
  expect(rows).toHaveLength(2);
  expect(isFailed(rows[0])).toBe(false);
  expect(isFailed(rows[1])).toBe(true);
  expect(rows[1].business.slug).toBe("b");
});

test("when no vault can be read the whole market fails", async () => {
  get.mockImplementation((url: string) =>
    Promise.resolve({ data: url === "/v1/businesses" ? [wire("a", "0xaa")] : [] }),
  );
  readContract.mockRejectedValue(new Error("rpc down"));
  await expect(getMarket()).rejects.toThrow("rpc down");
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

test("gives each block its time", async () => {
  getBlock.mockResolvedValue({ timestamp: 1_800_000_000n });
  const times = await getBlockTimes([30, 20]);
  expect(getBlock).toHaveBeenCalledWith({ blockNumber: 30n });
  expect(times[30]).toEqual(new Date(1_800_000_000 * 1000));
  expect(Object.keys(times)).toEqual(["20", "30"]);
});

test("countDelivered counts delivered orders and flags a list at the backend limit", () => {
  const list = (n: number, status = "delivered") => Array.from({ length: n }, () => ({ status })) as never;
  expect(countDelivered(list(99))).toEqual({ count: 99, capped: false });
  expect(countDelivered(list(100))).toEqual({ count: 100, capped: true });
  expect(countDelivered(list(100, "open"))).toEqual({ count: 0, capped: true });
  expect(toMarketEntry(business("a"), { state: "Active" } as never, list(100)).deliveredCapped).toBe(true);
});
