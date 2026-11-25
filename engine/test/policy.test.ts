import { describe, expect, test } from "bun:test";
import { DECLINE, type Prices, type VaultFunds } from "../src/agent/types.ts";
import { planOrder, spendableToday } from "../src/agent/policy.ts";

const prices: Prices = { dataIndexer: 50000n, listOracle: 20000n, computeBasic: 30000n, computeDeep: 120000n };
const caps = { dataIndexer: 100000n, listOracle: 100000n, computeBasic: 100000n, computeDeep: 200000n };
const funds: VaultFunds = { opex: 5_000_000n, dailyCap: 5_000_000n, spentToday: 0n, dayIndex: 10n, nowDay: 10n, paused: false };
const counterparty = { required: ["dataIndexer" as const], choice: [] };
const diligence = { required: ["dataIndexer" as const], choice: ["computeBasic" as const, "computeDeep" as const] };

describe("spendableToday", () => {
  test("subtracts spent on the same day", () => {
    expect(spendableToday({ ...funds, spentToday: 1_000_000n })).toBe(4_000_000n);
  });
  test("ignores spent after day rollover", () => {
    expect(spendableToday({ ...funds, spentToday: 1_000_000n, dayIndex: 9n })).toBe(5_000_000n);
  });
  test("floors at zero", () => {
    expect(spendableToday({ ...funds, spentToday: 9_000_000n })).toBe(0n);
  });
});

describe("planOrder", () => {
  test("happy path with no choice", () => {
    const p = planOrder({ price: 250000n, supplierPlan: counterparty, prices, caps, funds });
    expect(p).toEqual({ ok: true, required: ["dataIndexer"], affordableChoice: [], budget: 200000n - 50000n });
  });
  test("opex limits choice to the basic compute", () => {
    // required 50000; opex 100000 leaves 50000: basic (30000) fits, deep (120000) does not
    const p = planOrder({ price: 1_000_000n, supplierPlan: diligence, prices, caps, funds: { ...funds, opex: 100000n } });
    expect(p).toMatchObject({ ok: true, affordableChoice: ["computeBasic"], budget: 50000n });
  });
  test("ample funds list choices cheapest first", () => {
    const p = planOrder({ price: 1_000_000n, supplierPlan: { required: [], choice: ["computeDeep", "computeBasic"] }, prices, caps, funds });
    expect(p).toMatchObject({ ok: true, affordableChoice: ["computeBasic", "computeDeep"] });
  });
  test("price below cost is unprofitable", () => {
    const p = planOrder({ price: 60000n, supplierPlan: counterparty, prices, caps, funds });
    expect(p).toMatchObject({ ok: false, code: DECLINE.unprofitable });
  });
  test("margin limit uses integer division and minMarginBps", () => {
    // limit = 62500 * 8000 / 10000 = 50000 -> cost 50000 passes
    expect(planOrder({ price: 62500n, supplierPlan: counterparty, prices, caps, funds }).ok).toBe(true);
    expect(planOrder({ price: 62499n, supplierPlan: counterparty, prices, caps, funds })).toMatchObject({ ok: false, code: DECLINE.unprofitable });
    expect(planOrder({ price: 50000n, supplierPlan: counterparty, prices, caps, funds, minMarginBps: 0 }).ok).toBe(true);
  });
  test("opex below cost is noFunds", () => {
    const p = planOrder({ price: 250000n, supplierPlan: counterparty, prices, caps, funds: { ...funds, opex: 49999n } });
    expect(p).toMatchObject({ ok: false, code: DECLINE.noFunds });
  });
  test("daily cap exhausted is noFunds; rollover frees it", () => {
    const used = { ...funds, dailyCap: 100000n, spentToday: 80000n };
    expect(planOrder({ price: 250000n, supplierPlan: counterparty, prices, caps, funds: used })).toMatchObject({ ok: false, code: DECLINE.noFunds });
    expect(planOrder({ price: 250000n, supplierPlan: counterparty, prices, caps, funds: { ...used, dayIndex: 9n } }).ok).toBe(true);
  });
  test("paused is noFunds", () => {
    expect(planOrder({ price: 250000n, supplierPlan: counterparty, prices, caps, funds: { ...funds, paused: true } })).toEqual({
      ok: false,
      code: DECLINE.noFunds,
      reason: "vault is paused by its owner",
    });
  });
  test("required role over its cap is declined naming the role", () => {
    const p = planOrder({ price: 250000n, supplierPlan: counterparty, prices, caps: { ...caps, dataIndexer: 49999n }, funds });
    expect(p).toEqual({ ok: false, code: DECLINE.noFunds, reason: "supplier dataIndexer is not usable in this vault" });
  });
  test("required role missing or zero cap is not usable", () => {
    const { dataIndexer: _, ...rest } = caps;
    expect(planOrder({ price: 250000n, supplierPlan: counterparty, prices, caps: rest, funds })).toMatchObject({ ok: false, code: DECLINE.noFunds });
    expect(planOrder({ price: 250000n, supplierPlan: counterparty, prices, caps: { ...caps, dataIndexer: 0n }, funds })).toMatchObject({
      ok: false,
      code: DECLINE.noFunds,
    });
  });
  test("choice role over its cap is dropped", () => {
    const p = planOrder({ price: 1_000_000n, supplierPlan: diligence, prices, caps: { ...caps, computeDeep: 100000n }, funds });
    expect(p).toMatchObject({ ok: true, affordableChoice: ["computeBasic"] });
  });
  test("no usable choice is noFunds", () => {
    const p = planOrder({ price: 1_000_000n, supplierPlan: diligence, prices, caps: { ...caps, computeBasic: 0n, computeDeep: 1n }, funds });
    expect(p).toEqual({ ok: false, code: DECLINE.noFunds, reason: "no usable compute supplier" });
  });
  test("ties keep the plan order", () => {
    const tie: Prices = { ...prices, computeDeep: 30000n };
    const p = planOrder({ price: 1_000_000n, supplierPlan: { required: [], choice: ["computeDeep", "computeBasic"] }, prices: tie, caps, funds });
    expect(p).toMatchObject({ ok: true, affordableChoice: ["computeDeep", "computeBasic"] });
  });
});
