import { readFileSync } from "node:fs";
import { join } from "node:path";
import { FUSD_ADDRESS } from "@qredit/qore";
import { z } from "zod";

const units = z.string().regex(/^[0-9]+$/);
const roleEnum = z.enum(["dataIndexer", "listOracle", "computeBasic", "computeDeep"]);
export type SupplierRole = z.infer<typeof roleEnum>;

const business = z.object({
  slug: z.string().regex(/^[a-z0-9-]{2,40}$/),
  name: z.string(),
  tagline: z.string(),
  services: z.array(z.object({ id: z.number().int().nonnegative(), name: z.string(), priceUnits: units })).min(1),
  suppliers: z.array(z.object({ role: roleEnum, capUnits: units })).min(1),
  split: z.object({ lenderBps: z.number().int().min(0).max(10_000), ownerBps: z.number().int().min(0).max(10_000) }),
  dailyCapUnits: units,
  orderTtlSeconds: z.number().int().positive(),
  loan: z.object({
    targetUnits: units, totalOwedUnits: units, raiseSeconds: z.number().int().positive(),
    periodSeconds: z.number().int().positive(), graceSeconds: z.number().int().nonnegative(), installmentUnits: units,
  }),
  demoState: z.enum(["raising", "active", "trapped", "repaid"]),
});
const file = z.object({
  suppliers: z.record(roleEnum, z.object({ name: z.string(), priceUnits: units })),
  businesses: z.array(business),
});
export type BusinessParams = z.infer<typeof business>;
export type SupplierCatalog = z.infer<typeof file>["suppliers"];

const DEFAULT_PATH = join(import.meta.dir, "..", "..", "businesses.json");
export const loadCatalog = (path = DEFAULT_PATH) => file.parse(JSON.parse(readFileSync(path, "utf8")));
export const loadBusinesses = (path = DEFAULT_PATH): BusinessParams[] => loadCatalog(path).businesses;

type Hex = `0x${string}`;
export function vaultInit(
  b: BusinessParams,
  roles: { spender: Hex; operator: Hex; ownerPq: Hex; suppliers: Record<SupplierRole, Hex> },
  nowSeconds: number,
) {
  return {
    token: FUSD_ADDRESS as Hex,
    spender: roles.spender,
    operator: roles.operator,
    ownerPq: roles.ownerPq,
    ownerPayout: roles.ownerPq,
    cosmosChainId: "qorechain-diana",
    lenderBps: b.split.lenderBps,
    ownerBps: b.split.ownerBps,
    dailyCap: BigInt(b.dailyCapUnits),
    orderTtl: BigInt(b.orderTtlSeconds),
    loan: {
      target: BigInt(b.loan.targetUnits),
      totalOwed: BigInt(b.loan.totalOwedUnits),
      raiseDeadline: BigInt(nowSeconds + b.loan.raiseSeconds),
      period: BigInt(b.loan.periodSeconds),
      grace: BigInt(b.loan.graceSeconds),
      installment: BigInt(b.loan.installmentUnits),
    },
    suppliers: b.suppliers.map((s) => roles.suppliers[s.role]),
    supplierCaps: b.suppliers.map((s) => BigInt(s.capUnits)),
    servicePrices: b.services.map((s) => BigInt(s.priceUnits)),
  };
}
