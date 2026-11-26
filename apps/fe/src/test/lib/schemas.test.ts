import { expect, test } from "vitest";
import { businessSchema, decisionSchema, orderSchema } from "@/lib/schemas";

test("business with services as JSON text", () => {
  const b = businessSchema.parse({
    slug: "counterparty-check", vault: "0x37bbb37dd96a973a22ca64bc809a8bc4d54b03d4", name: "Counterparty Check",
    tagline: "Is it safe to pay this address?", services: '[{"id":0,"name":"Counterparty risk grade","priceUnits":"250000"}]',
    operator: "0xa995b8848d08320166817a2de1562b2f7be0d7ac", spender: "0x487f449c21a48eaf9d2eb3804f511dfb7715eea9", startBlock: 10673594,
  });
  expect(b.services[0]).toEqual({ id: 0, name: "Counterparty risk grade", priceUnits: 250000n });
});

test("decision with suppliers as JSON text", () => {
  const d = decisionSchema.parse({
    id: 11, vault: "0x37bbb37dd96a973a22ca64bc809a8bc4d54b03d4", orderId: "5", decision: "delivered", reason: "delivered",
    suppliers: '[{"role":"dataIndexer","amount":"50000"}]', cost: "50000", createdAt: "2026-11-24T18:49:10.776Z",
  });
  expect(d.suppliers).toEqual([{ role: "dataIndexer", amount: 50000n }]);
  expect(d.cost).toBe(50000n);
  expect(d.createdAt).toBeInstanceOf(Date);
});

test("order", () => {
  const o = orderSchema.parse({
    vault: "0x37bbb37dd96a973a22ca64bc809a8bc4d54b03d4", orderId: "5", buyer: "0xbf27a5c7c521e3e8660dbcf369ca462939773351",
    serviceId: 0, price: "250000", requestRef: `0x${"7".repeat(64)}`, deadline: 1795549723, status: "delivered",
    placedTx: `0x${"f".repeat(64)}`, placedBlock: 10683171, envelopeHash: null,
  });
  expect(o.price).toBe(250000n);
  expect(o.deadline).toBeInstanceOf(Date);
});

test("rejects an unknown status", () => {
  const result = decisionSchema.safeParse({
    id: 1, vault: "0x37bbb37dd96a973a22ca64bc809a8bc4d54b03d4", orderId: null, decision: "maybe", reason: "", suppliers: [], cost: "0", createdAt: "2026-01-01T00:00:00Z",
  });
  expect(result.success).toBe(false);
  expect(result.error?.issues.map((i) => i.path.join("."))).toEqual(["decision"]);
});

test("a business without a version is a v1 vault; v2 carries ended and stats", () => {
  const base = {
    slug: "s", vault: `0x${"a".repeat(40)}`, name: "n", tagline: "t", services: [], operator: `0x${"b".repeat(40)}`,
    spender: `0x${"c".repeat(40)}`, startBlock: 1,
  };
  expect(businessSchema.parse(base)).toMatchObject({ version: 1, ended: null });
  expect(businessSchema.parse({ ...base, version: 2, ended: "defaulted", stats: { delivered: 4, rejected: 1, uniqueBuyers: 3 } }))
    .toMatchObject({ version: 2, ended: "defaulted", stats: { delivered: 4, rejected: 1, uniqueBuyers: 3 } });
  expect(() => businessSchema.parse({ ...base, version: 3 })).toThrow();
});

test("an order in review carries its review end; a rejection its refund", () => {
  const base = {
    vault: `0x${"a".repeat(40)}`, orderId: "5", buyer: `0x${"b".repeat(40)}`, serviceId: 0, price: "250000",
    requestRef: `0x${"7".repeat(64)}`, deadline: 1795549723, placedTx: `0x${"f".repeat(64)}`, placedBlock: 1, envelopeHash: null,
  };
  const review = orderSchema.parse({ ...base, status: "in_review", reviewEnds: 1_900_000_000, refund: null });
  expect(review.reviewEnds).toEqual(new Date(1_900_000_000_000));
  expect(orderSchema.parse({ ...base, status: "rejected", reviewEnds: 1, refund: "150000" }).refund).toBe(150000n);
  expect(orderSchema.parse({ ...base, status: "delivered" })).toMatchObject({ reviewEnds: null, refund: null });
});
