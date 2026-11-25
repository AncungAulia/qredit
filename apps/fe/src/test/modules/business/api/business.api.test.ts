import { encodeFunctionData } from "viem";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { VAULT_FACTORY_ABI } from "@qredit/qore";

const chain = vi.hoisted(() => ({
  getLogs: vi.fn(),
  getTransaction: vi.fn(),
  readContract: vi.fn(),
}));
vi.mock("@/lib/chain", () => ({ publicClient: chain }));
const get = vi.hoisted(() => vi.fn());
vi.mock("@/lib/apiClient", async (orig) => ({
  ...(await orig<object>()),
  api: { get: (...a: unknown[]) => get(...a) },
}));
import {
  getDecisions,
  readCreationSuppliers,
  readVaultRules,
} from "@/modules/business/api/business.api";

const S1 = "0x1111111111111111111111111111111111111111";
const S2 = "0x2222222222222222222222222222222222222222";
const VAULT = "0x37bbb37dd96a973a22ca64bc809a8bc4d54b03d4";
const NOON = Date.UTC(2026, 10, 25, 12) / 1000;
const TODAY = Math.floor(NOON / 86400);

const init = {
  token: S1,
  spender: S1,
  operator: S1,
  ownerPq: S1,
  ownerPayout: S1,
  cosmosChainId: "qorechain-diana",
  lenderBps: 7000,
  ownerBps: 2000,
  dailyCap: 2_000_000n,
  orderTtl: 3600n,
  loan: { target: 1n, totalOwed: 1n, raiseDeadline: 1n, period: 1n, grace: 1n, installment: 1n },
  suppliers: [S1, S2],
  supplierCaps: [100_000n, 200_000n],
  servicePrices: [250_000n],
} as const;

function mockChain(dayIndex: number) {
  chain.getLogs.mockResolvedValue([{ args: { vault: VAULT }, transactionHash: "0xabc" }]);
  chain.getTransaction.mockResolvedValue({
    input: encodeFunctionData({ abi: VAULT_FACTORY_ABI, functionName: "create", args: [init] }),
  });
  chain.readContract.mockImplementation(
    ({ functionName, args }: { functionName: string; args?: unknown[] }) => {
      if (functionName === "suppliers")
        return Promise.resolve(args?.[0] === S1 ? [true, 100_000n] : [false, 0n]);
      const v: Record<string, unknown> = {
        dailyCap: 2_000_000n,
        spentToday: 50_000n,
        dayIndex: BigInt(dayIndex),
        lenderBps: 7000,
        ownerBps: 2000,
        orderTtl: 3600n,
      };
      return Promise.resolve(v[functionName]);
    },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOON * 1000);
});
afterEach(() => vi.useRealTimers());

test("suppliers come from the creation call, caps from the vault now", async () => {
  mockChain(TODAY);
  const r = await readVaultRules({ vault: VAULT, startBlock: 100 } as never);
  expect(chain.getLogs.mock.calls[0][0]).toMatchObject({ fromBlock: 100n, toBlock: 100n });
  expect(r.suppliers).toEqual([
    { address: S1, allowed: true, perTxCap: 100_000n },
    { address: S2, allowed: false, perTxCap: 0n },
  ]);
  expect(r).toMatchObject({
    dailyCap: 2_000_000n,
    spentToday: 50_000n,
    lenderBps: 7000,
    ownerBps: 2000,
    orderTtlSeconds: 3600,
  });
});

test("spent today reads as zero when the vault has not yet reset it for a new day", async () => {
  mockChain(TODAY - 1);
  const r = await readVaultRules({ vault: VAULT, startBlock: 100 } as never);
  expect(r.spentToday).toBe(0n);
});

test("given supplier addresses skip the creation lookup", async () => {
  mockChain(TODAY);
  const r = await readVaultRules({ vault: VAULT, startBlock: 100 } as never, [S1]);
  expect(chain.getLogs).not.toHaveBeenCalled();
  expect(r.suppliers).toHaveLength(1);
});

test("a creation that cannot be found rejects", async () => {
  chain.getLogs.mockResolvedValue([]);
  await expect(readCreationSuppliers({ vault: VAULT, startBlock: 100 })).rejects.toThrow();
});

test("decisions parse suppliers and cost sent as text", async () => {
  get.mockResolvedValue({
    data: [
      {
        id: 1,
        vault: VAULT,
        orderId: "18",
        decision: "delivered",
        reason: "Sealed.",
        suppliers: '[{"role":"dataIndexer","amount":"50000"}]',
        cost: "50000",
        createdAt: "2026-11-25T10:00:00Z",
      },
    ],
  });
  const d = await getDecisions(VAULT);
  expect(get).toHaveBeenCalledWith("/v1/decisions", { params: { vault: VAULT, limit: 50 } });
  expect(d[0].suppliers).toEqual([{ role: "dataIndexer", amount: 50000n }]);
  expect(d[0].cost).toBe(50000n);
});
