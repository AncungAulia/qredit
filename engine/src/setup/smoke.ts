import { SUPPLIERS } from "@qredit/qore";
import type { VaultInit } from "./businesses.ts";

type Hex = `0x${string}`;

/** The keystore name of the operator account the smoke run creates; it serves only the smoke vault. */
export const SMOKE_OPERATOR = "smoke-operator";
/** The smoke vault never pays a supplier, so its spender is a fixed address that no key controls. */
export const SMOKE_SPENDER = "0x000000000000000000000000000000000000dEaD" as const;
export const SMOKE_PRICE = 200_000n;

/**
 * A one-fUSD vault with 600-second periods and no grace, so it falls three installments behind and can be defaulted
 * within the smoke run. 12 installments of 0.1 fUSD reach the 1.1 fUSD owed by maturity (7200 seconds).
 */
export function smokeInit(roles: { operator: Hex; ownerPq: Hex }, nowSeconds: number): VaultInit {
  return {
    spender: SMOKE_SPENDER,
    operator: roles.operator,
    ownerPq: roles.ownerPq,
    ownerPayout: roles.ownerPq,
    cosmosChainId: "qorechain-diana",
    lenderBps: 3000,
    ownerBps: 2000,
    dailyCap: 1_000_000n,
    orderTtl: 3600n,
    loan: {
      target: 1_000_000n,
      totalOwed: 1_100_000n,
      raiseDeadline: BigInt(nowSeconds + 3600),
      period: 600n,
      grace: 0n,
      installment: 100_000n,
      maturity: 7200n,
      maturityGrace: 600n,
      defaultAfterMissed: 3,
    },
    suppliers: [SUPPLIERS.dataIndexer],
    supplierCaps: [100_000n],
    servicePrices: [SMOKE_PRICE],
  };
}
