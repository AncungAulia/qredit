import { describe, expect, test } from "bun:test";
import { createSupplierApp, type PaymentSource } from "../src/suppliers/app.ts";

const V = "0x00000000000000000000000000000000000000aa";
const catalog = {
  dataIndexer: { name: "Data Indexer", priceUnits: "50000", address: "0x00000000000000000000000000000000000000d1" },
  listOracle: { name: "List Oracle", priceUnits: "100000", address: "0x00000000000000000000000000000000000000d2" },
  computeBasic: { name: "Compute Basic", priceUnits: "500000", address: "0x00000000000000000000000000000000000000d3" },
  computeDeep: { name: "Compute Deep", priceUnits: "1500000", address: "0x00000000000000000000000000000000000000d4" },
};

function app(paid: bigint) {
  const calls: unknown[] = [];
  const payments: PaymentSource = { paid: async (vault, orderId, supplier) => { calls.push([vault, orderId, supplier]); return paid; } };
  const data = {
    dataIndexer: async (q: Record<string, string>) => ({ address: q.address, txCount: 3 }),
    listOracle: async () => ({ match: false }),
    computeBasic: async () => ({ ok: true }),
    computeDeep: async () => ({ ok: true }),
  };
  return { a: createSupplierApp({ payments, catalog, data }), calls };
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
    expect(calls).toEqual([[V, "7", catalog.dataIndexer.address]]);
  });

  test("validates role, vault and order id", async () => {
    const { a } = app(0n);
    expect((await a.request(`/v1/unknown?vault=${V}&orderId=1`)).status).toBe(404);
    expect((await a.request(`/v1/listOracle?vault=0x12&orderId=1`)).status).toBe(400);
    expect((await a.request(`/v1/listOracle?vault=${V}&orderId=x`)).status).toBe(400);
  });
});
