import { describe, expect, test } from "bun:test";
import { parseKeyList, parseKeySpec } from "../src/keys.ts";
import { executionFailure, serial, signModeOf, txEvents } from "../src/tx.ts";
import { PAY_SUPPLIER_SELECTOR, VAULT_EVENTS } from "../src/abi.ts";

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

describe("key parse errors", () => {
  test("name the variable and never include the input", () => {
    const secret = "{not json mnemonic abandon abandon";
    for (const fn of [() => parseKeySpec(secret, "RELAYER_KEY"), () => parseKeyList(secret, "OPERATOR_KEYS")]) {
      let msg = "";
      try { fn(); } catch (e) { msg = (e as Error).message; }
      expect(msg).toMatch(/^(RELAYER_KEY|OPERATOR_KEYS) is not valid JSON$/);
      expect(msg).not.toContain("abandon");
    }
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

describe("txEvents", () => {
  test("retries a response without tx_response, then fails clearly", async () => {
    let calls = 0;
    const server = Bun.serve({ port: 0, fetch: () => { calls++; return Response.json({}); } });
    try {
      await expect(txEvents(`http://localhost:${server.port}`, "0xabc", 3, 1)).rejects.toThrow(/not found \(or no tx_response\)/);
      expect(calls).toBe(3);
    } finally {
      server.stop(true);
    }
  });
});

describe("sign mode", () => {
  test("defaults to hybrid; classical only when asked", () => {
    expect(signModeOf({})).toBe("hybrid");
    expect(signModeOf({ signMode: "classical" })).toBe("classical");
  });
});
