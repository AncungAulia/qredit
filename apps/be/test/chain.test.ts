import { describe, expect, test } from "bun:test";
import { parseKeyList, parseKeySpec } from "../src/chain/keys.ts";
import { executionFailure, serial } from "../src/chain/tx.ts";
import { PAY_SUPPLIER_SELECTOR, VAULT_EVENTS } from "../src/chain/vault.ts";

describe("key specs", () => {
  test("mnemonic and seed forms", () => {
    const words = Array(12).fill("abandon").join(" ");
    expect(parseKeySpec(JSON.stringify({ mnemonic: words }))).toEqual({ mnemonic: words });
    const seed = { privateKey: `0x${"11".repeat(32)}`, recoveryCode: "QRC1-x" };
    expect(parseKeySpec(JSON.stringify(seed))).toEqual(seed as never);
    expect(() => parseKeySpec('{"mnemonic":"too short"}')).toThrow();
    expect(() => parseKeySpec('{"privateKey":"0x12"}')).toThrow();
    expect(parseKeyList(JSON.stringify([{ mnemonic: words }])).length).toBe(1);
    expect(() => parseKeyList('{"mnemonic":"x"}')).toThrow();
  });
});

describe("executionFailure", () => {
  test("finds the abstractaccount failure event", () => {
    expect(executionFailure([{ type: "message", attributes: [] }])).toBeNull();
    expect(
      executionFailure([{ type: "abstractaccount_execution_failed", attributes: [{ key: "reason", value: "call not listed in allowed_evm_calls" }] }]),
    ).toBe("call not listed in allowed_evm_calls");
    expect(executionFailure([{ type: "abstractaccount_execution_failed", attributes: [] }])).toBe("execution failed");
  });
});

describe("serial", () => {
  test("runs one task at a time, in order, surviving failures", async () => {
    const run = serial();
    const order: number[] = [];
    const slow = (n: number, ms: number) => run(async () => { await Bun.sleep(ms); order.push(n); return n; });
    const failing = run(async () => { throw new Error("boom"); });
    const results = await Promise.allSettled([slow(1, 30), failing, slow(2, 1)]);
    expect(order).toEqual([1, 2]);
    expect(results.map((r) => r.status)).toEqual(["fulfilled", "rejected", "fulfilled"]);
  });
});

describe("vault abi", () => {
  test("paySupplier selector and the four events", () => {
    expect(PAY_SUPPLIER_SELECTOR).toMatch(/^0x[0-9a-f]{8}$/);
    expect(VAULT_EVENTS.map((e) => e.name)).toEqual(["OrderPlaced", "Delivered", "Declined", "Reclaimed"]);
  });
});
