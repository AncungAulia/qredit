import { describe, expect, test } from "bun:test";
import { chainPayments, createSupplierApp, type PaymentSource } from "../src/suppliers/app.ts";

const V = "0x00000000000000000000000000000000000000aa";
const START = 1234;
const vaults = new Map([[V, { startBlock: START }]]);
const catalog = {
  dataIndexer: { name: "Data Indexer", priceUnits: "50000", address: "0x00000000000000000000000000000000000000d1" },
  listOracle: { name: "List Oracle", priceUnits: "100000", address: "0x00000000000000000000000000000000000000d2" },
  computeBasic: { name: "Compute Basic", priceUnits: "500000", address: "0x00000000000000000000000000000000000000d3" },
  computeDeep: { name: "Compute Deep", priceUnits: "1500000", address: "0x00000000000000000000000000000000000000d4" },
};

function app(paid: bigint | Error) {
  const calls: unknown[] = [];
  const payments: PaymentSource = { paid: async (vault, orderId, supplier, startBlock) => { calls.push([vault, orderId, supplier, startBlock]); if (paid instanceof Error) throw paid; return paid; } };
  const data = {
    dataIndexer: async (q: Record<string, string>) => ({ address: q.address, txCount: 3 }),
    listOracle: async () => ({ match: false }),
    computeBasic: async () => ({ ok: true }),
    computeDeep: async () => ({ ok: true }),
  };
  return { a: createSupplierApp({ payments, vaults, catalog, data }), calls };
}

describe("suppliers", () => {
  test("402 with the price until paid", async () => {
    const { a } = app(10_000n);
    const res = await a.request(`/v1/dataIndexer?vault=${V}&orderId=7&address=qor1x`);
    expect(res.status).toBe(402);
    expect(await res.json()).toMatchObject({ priceUnits: "50000", payTo: catalog.dataIndexer.address });
  });

  test("returns data once the vault paid this supplier for this order", async () => {
    const { a, calls } = app(50_000n);
    const res = await a.request(`/v1/dataIndexer?vault=${V}&orderId=7&address=qor1x`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ supplier: "Data Indexer", data: { address: "qor1x", txCount: 3 } });
    expect(calls).toEqual([[V, "7", catalog.dataIndexer.address, START]]);
  });

  test("validates role, vault and order id", async () => {
    const { a } = app(0n);
    expect((await a.request(`/v1/unknown?vault=${V}&orderId=1`)).status).toBe(404);
    expect((await a.request(`/v1/listOracle?vault=0x12&orderId=1`)).status).toBe(400);
    expect((await a.request(`/v1/listOracle?vault=${V}&orderId=x`)).status).toBe(400);
  });

  test("an unknown vault is refused before any chain call", async () => {
    const { a, calls } = app(50_000n);
    const res = await a.request(`/v1/dataIndexer?vault=0x00000000000000000000000000000000000000bb&orderId=7`);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "unknown vault" });
    expect(calls).toEqual([]);
  });

  test("prototype keys are not roles; order ids are bounded", async () => {
    const { a, calls } = app(0n);
    expect((await a.request(`/v1/constructor?vault=${V}&orderId=1`)).status).toBe(404);
    expect((await a.request(`/v1/__proto__?vault=${V}&orderId=1`)).status).toBe(404);
    expect((await a.request(`/v1/listOracle?vault=${V}&orderId=${"9".repeat(79)}`)).status).toBe(400);
    expect((await a.request(`/v1/listOracle?vault=${V}&orderId=${"9".repeat(78)}`)).status).toBe(402);
    expect(calls.length).toBe(1);
  });

  test("an RPC failure is 503, not a crash", async () => {
    const { a } = app(new Error("rpc down"));
    const res = await a.request(`/v1/dataIndexer?vault=${V}&orderId=7`);
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "payment check unavailable" });
  });
});

describe("chainPayments", () => {
  test("scans from the start block to head in 2000-block chunks and sums", async () => {
    const ranges: [bigint, bigint][] = [];
    const client = {
      getBlockNumber: async () => 5_500n,
      getLogs: async (p: { fromBlock: bigint; toBlock: bigint }) => { ranges.push([p.fromBlock, p.toBlock]); return [{ args: { amount: 10n } }]; },
    };
    const paid = await chainPayments(client as never).paid(V, "7", catalog.dataIndexer.address, 1_000);
    expect(ranges).toEqual([[1000n, 2999n], [3000n, 4999n], [5000n, 5500n]]);
    expect(paid).toBe(30n);
  });
});

describe("data function errors", () => {
  const failing = (msg: string) => {
    const payments: PaymentSource = { paid: async () => 10_000_000n };
    const boom = async () => { throw new Error(msg); };
    return createSupplierApp({ payments, vaults, catalog, data: { dataIndexer: boom, listOracle: boom, computeBasic: boom, computeDeep: boom } });
  };
  test("an invalid or required error is HTTP 400", async () => {
    expect((await failing("invalid address").request(`/v1/dataIndexer?vault=${V}&orderId=7`)).status).toBe(400);
    expect((await failing("address required").request(`/v1/dataIndexer?vault=${V}&orderId=7`)).status).toBe(400);
  });
  test("any other error is HTTP 503", async () => {
    expect((await failing("mcp timeout").request(`/v1/dataIndexer?vault=${V}&orderId=7`)).status).toBe(503);
  });
});
