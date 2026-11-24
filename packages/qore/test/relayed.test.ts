import { describe, expect, test } from "bun:test";
import { encodeFunctionData } from "viem";
import { VAULT_ABI } from "../src/abi.ts";
import { relayedPayments } from "../src/relayed.ts";

const V = "0x8f7354806358c87a32791418289f592376553d65";
const S1 = "0xcc8eef910e741eb33effc104121e79c43cb3488e";
const S2 = "0x" + "22".repeat(20);
const pay = (s: string, a: bigint, o: bigint) => Buffer.from(encodeFunctionData({ abi: VAULT_ABI, functionName: "paySupplier", args: [s as `0x${string}`, a, o] }).slice(2), "hex").toString("base64");
const other = Buffer.from(encodeFunctionData({ abi: VAULT_ABI, functionName: "deposit", args: [1n] }).slice(2), "hex").toString("base64");
type T = { hash: string; to?: string; data: string; code?: number; failed?: boolean };
const mk = (t: T) => ({
  tx: { body: { messages: [{ "@type": "/qorechain.abstractaccount.v1.MsgExecuteEVM", to: t.to ?? V, data: t.data }] } },
  res: { txhash: t.hash, height: "100", code: t.code ?? 0, events: t.failed ? [{ type: "abstractaccount_execution_failed" }] : [] },
});
const pageOf = (ts: T[]) => { const m = ts.map(mk); return { txs: m.map((x) => x.tx), tx_responses: m.map((x) => x.res) }; };
const fake = (pages: unknown[]) => {
  const urls: string[] = [];
  const f = (async (u: string) => { urls.push(u); const p = pages[urls.length - 1]; return p ? new Response(JSON.stringify(p)) : new Response("{}", { status: 400 }); }) as unknown as typeof fetch;
  return { f, urls };
};
const base = { rest: "http://x", relayer: "qor1abc", vault: V };

describe("relayedPayments", () => {
  test("keeps successful paySupplier calls to the vault and filters by order and supplier", async () => {
    const { f, urls } = fake([pageOf([
      { hash: "A", data: pay(S1, 100n, 1n) }, { hash: "B", data: pay(S2, 5n, 1n) }, { hash: "C", data: pay(S1, 7n, 2n) },
    ])]);
    expect((await relayedPayments({ ...base, fetch: f })).length).toBe(3);
    const { f: f2 } = fake([pageOf([{ hash: "A", data: pay(S1, 100n, 1n) }, { hash: "B", data: pay(S2, 5n, 1n) }, { hash: "C", data: pay(S1, 7n, 2n) }])]);
    const r = await relayedPayments({ ...base, orderId: 1n, supplier: S1.toUpperCase().replace("0X", "0x"), fetch: f2 });
    expect(r).toEqual([{ txHash: "A", height: 100, supplier: S1, amount: 100n, orderId: 1n }]);
    expect(urls[0]).toContain(encodeURIComponent("message.sender='qor1abc'"));
  });
  test("skips failed executions, other selectors, other vaults and non-zero codes", async () => {
    const { f } = fake([pageOf([
      { hash: "F", data: pay(S1, 1n, 1n), failed: true }, { hash: "O", data: other }, { hash: "W", to: "0x" + "99".repeat(20), data: pay(S1, 1n, 1n) },
      { hash: "X", data: pay(S1, 1n, 1n), code: 5 }, { hash: "OK", to: V.toUpperCase().replace("0X", "0x"), data: pay(S1, 3n, 1n) },
    ])]);
    expect((await relayedPayments({ ...base, fetch: f })).map((p) => p.txHash)).toEqual(["OK"]);
  });
  test("pages until a short page, and stops at maxPages", async () => {
    const full = pageOf(Array.from({ length: 50 }, (_, i) => ({ hash: `H${i}`, data: pay(S1, 1n, 1n) })));
    const { f, urls } = fake([full, pageOf([{ hash: "LAST", data: pay(S1, 1n, 1n) }])]);
    expect((await relayedPayments({ ...base, fetch: f })).length).toBe(51);
    expect(urls.length).toBe(2);
    const capped = fake([full, full, full]);
    await relayedPayments({ ...base, fetch: capped.f, maxPages: 2 });
    expect(capped.urls.length).toBe(2);
  });
  test("an HTTP error on the first page throws; past the last page it ends quietly", async () => {
    await expect(relayedPayments({ ...base, fetch: fake([]).f })).rejects.toThrow(/HTTP 400/);
    const full = pageOf(Array.from({ length: 50 }, (_, i) => ({ hash: `H${i}`, data: pay(S1, 1n, 1n) })));
    expect((await relayedPayments({ ...base, fetch: fake([full]).f })).length).toBe(50);
  });
});
