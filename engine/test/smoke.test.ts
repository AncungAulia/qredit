import { expect, test } from "bun:test";
import { bondFor, SUPPLIERS } from "@qredit/qore";
import { SMOKE_PRICE, SMOKE_SPENDER, smokeInit } from "../src/setup/smoke.ts";

const roles = { operator: "0x00000000000000000000000000000000000000a1" as const, ownerPq: "0x00000000000000000000000000000000000000a2" as const };

test("the smoke vault passes the v2 constructor checks", () => {
  const i = smokeInit(roles, 1_000_000);
  const l = i.loan;
  expect(l.installment * (l.maturity / l.period) >= l.totalOwed).toBe(true);
  expect(l.defaultAfterMissed).toBe(3);
  expect(bondFor(l.target)).toBe(100_000n);
  expect(l.raiseDeadline).toBe(1_003_600n);
  expect(i.ownerPayout).toBe(roles.ownerPq);
  expect(i.servicePrices).toEqual([SMOKE_PRICE]);
});

test("no role of the smoke vault is a supplier", () => {
  const i = smokeInit(roles, 1_000_000);
  const supplier = SUPPLIERS.dataIndexer;
  expect(i.suppliers).toEqual([supplier]);
  for (const role of [SMOKE_SPENDER, i.operator, i.ownerPq]) expect(role.toLowerCase()).not.toBe(supplier);
});
