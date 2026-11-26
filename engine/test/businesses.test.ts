import { describe, expect, test } from "bun:test";
import { loadBusinesses, vaultInit } from "../src/setup/businesses.ts";

const roles = {
  spender: "0x0000000000000000000000000000000000000001" as const,
  operator: "0x0000000000000000000000000000000000000002" as const,
  ownerPq: "0x0000000000000000000000000000000000000003" as const,
  suppliers: {
    dataIndexer: "0x00000000000000000000000000000000000000d1" as const,
    listOracle: "0x00000000000000000000000000000000000000d2" as const,
    computeBasic: "0x00000000000000000000000000000000000000d3" as const,
    computeDeep: "0x00000000000000000000000000000000000000d4" as const,
  },
};

describe("businesses.json", () => {
  test("loads four businesses with valid parameters", () => {
    const list = loadBusinesses();
    expect(list.map((b) => b.slug)).toEqual(["counterparty-check", "sanctions-screen", "due-diligence", "contract-auditor"]);
    for (const b of list) expect(b.split.lenderBps + b.split.ownerBps).toBeLessThanOrEqual(10_000);
  });

  test("vaultInit maps parameters to the factory Init", () => {
    const due = loadBusinesses().find((b) => b.slug === "due-diligence")!;
    const init = vaultInit(due, roles, 1_000_000);
    expect(init.cosmosChainId).toBe("qorechain-diana");
    expect(init.ownerPq).toBe(roles.ownerPq);
    expect(init.ownerPayout).toBe(roles.ownerPq);
    expect(init.suppliers).toEqual([roles.suppliers.dataIndexer, roles.suppliers.computeBasic, roles.suppliers.computeDeep]);
    expect(init.supplierCaps).toEqual([200_000n, 1_000_000n, 2_000_000n]);
    expect(init.servicePrices).toEqual([3_000_000n]);
    expect(init.loan.raiseDeadline).toBe(1_000_000n + 1_209_600n);
    expect(init.loan.period).toBe(3600n);
    expect(init.orderTtl).toBe(3600n);
    expect("token" in init).toBe(false);
    expect(init.loan.maturity).toBe(79_200n);
    expect(init.loan.maturityGrace).toBe(3600n);
    expect(init.loan.defaultAfterMissed).toBe(3);
  });
  test("every business has a schedule that reaches its debt by maturity", () => {
    for (const b of loadBusinesses()) {
      const periods = BigInt(Math.floor(b.loan.maturitySeconds / b.loan.periodSeconds));
      expect(BigInt(b.loan.installmentUnits) * periods >= BigInt(b.loan.totalOwedUnits)).toBe(true);
      expect(b.loan.defaultAfterMissed).toBe(3);
    }
  });
});
