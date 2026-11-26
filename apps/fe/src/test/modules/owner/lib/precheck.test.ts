import { expect, test } from "vitest";
import type { Rules } from "@/modules/owner/api/owner.api";
import { ENDED_SENTENCE, precheck } from "@/modules/owner/lib/precheck";
import type { PolicyKind } from "@/modules/owner/schemas/policyOrder.schema";

const fusd = (n: number) => BigInt(n) * 1_000_000n;
const rules = (over: Partial<Rules> = {}): Rules => ({
  state: "Active",
  paused: false,
  repaid: 0n,
  totalOwed: fusd(100),
  dailyCap: fusd(50),
  spentToday: 0n,
  ownerPending: 0n,
  bondHeld: 0n,
  claimAhead: false,
  spender: "0x01",
  operator: "0x02",
  ...over,
});

const cases: [string, PolicyKind, bigint | null, Partial<Rules>, string | null][] = [
  ["pause when running", "Pause", null, {}, null],
  ["pause when already paused", "Pause", null, { paused: true }, "The agent is already paused."],
  ["unpause when paused", "Unpause", null, { paused: true }, null],
  ["unpause when running", "Unpause", null, {}, "The agent is not paused."],
  ["lower below the cap", "LowerDailyCap", fusd(40), {}, null],
  ["lower to the cap", "LowerDailyCap", fusd(50), {}, "Enter an amount below the current daily cap of 50.00 fUSD."],
  ["lower above the cap", "LowerDailyCap", fusd(60), {}, "Enter an amount below the current daily cap of 50.00 fUSD."],
  ["lower with no amount yet", "LowerDailyCap", null, {}, null],
  ["raise above the cap when repaid", "RaiseDailyCap", fusd(80), { state: "Repaid" }, null],
  ["raise to the cap when repaid", "RaiseDailyCap", fusd(50), { state: "Repaid" }, "Enter an amount above the current daily cap of 50.00 fUSD."],
  ["raise during the loan", "RaiseDailyCap", fusd(80), {}, "Locked until the loan is repaid. The vault refuses this change until then."],
  ["add a supplier during the loan", "AddSupplier", fusd(5), { state: "Trapped" }, "Locked until the loan is repaid. The vault refuses this change until then."],
  ["raise a supplier cap when repaid", "RaiseSupplierCap", fusd(5), { state: "Repaid" }, null],
  ["raise a supplier cap during the loan", "RaiseSupplierCap", null, {}, "Locked until the loan is repaid. The vault refuses this change until then."],
  ["supplier cases are left to the simulation", "LowerSupplierCap", fusd(1), {}, null],
  ["removing a supplier is left to the simulation", "RemoveSupplier", null, {}, null],
];

test.each(cases)("%s", (_name, kind, value, over, expected) => {
  expect(precheck(kind, value, rules(over))).toBe(expected);
});

test("an ended vault refuses every order", () => {
  for (const state of ["Defaulted", "Closed"] as const) {
    expect(precheck("Pause", null, rules({ state }))).toBe(ENDED_SENTENCE);
    expect(precheck("RotateAgent", null, rules({ state }))).toBe(ENDED_SENTENCE);
  }
});

test("Close only while the loan runs", () => {
  expect(precheck("Close", null, rules({ state: "Active" }))).toBeNull();
  expect(precheck("Close", null, rules({ state: "Trapped" }))).toBeNull();
  expect(precheck("Close", null, rules({ state: "Repaid" }))).toBe("A repaid loan cannot be closed.");
  expect(precheck("Close", null, rules({ state: "Raising" }))).toBe("The loan can be closed only once it is funded and running.");
});
