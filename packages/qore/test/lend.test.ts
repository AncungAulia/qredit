import { describe, expect, test } from "bun:test";
import { VAULT_STATE } from "../src/abi.ts";
import { planLend } from "../src/lend.ts";

describe("planLend", () => {
  const base = { state: VAULT_STATE.Raising as number, raised: 10n, target: 100n, balance: 500n, allowance: 0n };
  test("skips unless raising", () => {
    expect(planLend({ ...base, state: VAULT_STATE.Active }, 5n)).toEqual({ action: "skip", reason: "already funded or closed" });
    expect(planLend({ ...base, raised: 100n }, 5n).action).toBe("skip");
  });
  test("deposits min(requested, room) and approves only when needed", () => {
    expect(planLend(base, 20n)).toEqual({ action: "deposit", amount: 20n, approve: true });
    expect(planLend(base, 1000n)).toEqual({ action: "deposit", amount: 90n, approve: true });
    expect(planLend({ ...base, allowance: 90n }, 1000n)).toEqual({ action: "deposit", amount: 90n, approve: false });
  });
  test("errors clearly on insufficient balance", () => {
    expect(() => planLend({ ...base, balance: 5n }, 20n)).toThrow(/insufficient fUSD/);
  });
});
