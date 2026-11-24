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
  test("an HTTP error on any page throws, on the first and on a later one", async () => {
    await expect(relayedPayments({ ...base, fetch: fake([]).f })).rejects.toThrow(/HTTP 400/);
    const full = { ...pageOf(Array.from({ length: 50 }, (_, i) => ({ hash: `H${i}`, data: pay(S1, 1n, 1n) }))), total: "120" };
    await expect(relayedPayments({ ...base, fetch: fake([full]).f })).rejects.toThrow(/HTTP 400 \(page 2\)/);
  });
  test("reads every page up to the reported total, then stops", async () => {
    const mkPage = (n: number, tag: string, total: string) => ({ ...pageOf(Array.from({ length: n }, (_, i) => ({ hash: `${tag}${i}`, data: pay(S1, 1n, 1n) }))), total });
    const { f, urls } = fake([mkPage(50, "A", "120"), mkPage(50, "B", "120"), mkPage(20, "C", "120"), mkPage(5, "D", "120")]);
    expect((await relayedPayments({ ...base, fetch: f })).length).toBe(120);
    expect(urls.length).toBe(3);
    expect(urls[0]).toContain("limit=50&page=1");
  });
  test("a total in pagination.total is honoured; with no total a short page ends the list", async () => {
    const p = pageOf([{ hash: "A", data: pay(S1, 1n, 1n) }]);
    const a = fake([{ ...p, pagination: { total: "1" } }, p]);
    await relayedPayments({ ...base, fetch: a.f });
    expect(a.urls.length).toBe(1);
    const b = fake([p, p]);
    await relayedPayments({ ...base, fetch: b.f });
    expect(b.urls.length).toBe(1);
  });
  test("minHeight stops once a whole page is older", async () => {
    const old = (n: number) => { const x = pageOf(Array.from({ length: n }, (_, i) => ({ hash: `O${i}`, data: pay(S1, 1n, 1n) }))); x.tx_responses.forEach((r) => { r.height = "50"; }); return { ...x, total: "200" }; };
    const newer = { ...pageOf(Array.from({ length: 50 }, (_, i) => ({ hash: `N${i}`, data: pay(S1, 1n, 1n) }))), total: "200" };
    const { f, urls } = fake([newer, old(50), old(50), old(50)]);
    const r = await relayedPayments({ ...base, fetch: f, minHeight: 100 });
    expect(urls.length).toBe(2);
    expect(r.length).toBe(50); // payments below minHeight are dropped
  });
  test("a mismatched response or a never-ending list throws instead of truncating", async () => {
    const bad = { txs: pageOf([{ hash: "A", data: pay(S1, 1n, 1n) }]).txs, tx_responses: [] };
    await expect(relayedPayments({ ...base, fetch: fake([bad]).f })).rejects.toThrow(/mismatched/);
    const full = { ...pageOf(Array.from({ length: 50 }, (_, i) => ({ hash: `H${i}`, data: pay(S1, 1n, 1n) }))), total: "9999" };
    await expect(relayedPayments({ ...base, fetch: fake([full, full, full]).f, maxPages: 2 })).rejects.toThrow(/did not end/);
  });
});
