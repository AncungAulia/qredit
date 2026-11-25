import { afterEach, expect, test, vi } from "vitest";
import { POST } from "../../../../../../app/api/chain/rpc/route";

afterEach(() => vi.restoreAllMocks());

const HASH = "729C6A888BFED69B3D59F1DDA5C0758EB93EF91136555C497CC5EB1A98C80893";
const raw = (text: string, headers: Record<string, string> = {}) =>
  POST(new Request("http://x/api/chain/rpc", { method: "POST", body: text, headers: { "content-type": "application/json", ...headers } }));
const call = (body: unknown, headers: Record<string, string> = {}) => raw(JSON.stringify(body), headers);
const ok = () => vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response('{"jsonrpc":"2.0","id":1,"result":{}}', { status: 200 }));
const sent = (spy: ReturnType<typeof ok>) => JSON.parse(String(spy.mock.calls[0][1]?.body)) as Record<string, unknown>;

test("forwards an allowed method", async () => {
  const spy = ok();
  const res = await call({ jsonrpc: "2.0", id: 1, method: "status", params: {} });
  expect(res.status).toBe(200);
  expect(spy.mock.calls[0][0]).toBe("https://rpc-testnet.qore.host");
  expect(res.headers.get("cache-control")).toBe("no-store");
});

test("forwards only the validated request and drops unknown keys", async () => {
  const spy = ok();
  await raw('{"method":"status","Method":"unsafe_flush_mempool","extra":1}');
  expect(sent(spy)).toEqual({ jsonrpc: "2.0", id: null, method: "status", params: {} });
});

test("keeps the id and the params of the request", async () => {
  const spy = ok();
  await call({ id: 7, method: "broadcast_tx_sync", params: { tx: "AAAA" } });
  expect(sent(spy)).toEqual({ jsonrpc: "2.0", id: 7, method: "broadcast_tx_sync", params: { tx: "AAAA" } });
});

test.each([
  ["another method", { jsonrpc: "2.0", id: 1, method: "unsafe_flush_mempool" }],
  ["a batch", [{ jsonrpc: "2.0", id: 1, method: "status" }]],
  ["null", null],
  ["a missing method", { jsonrpc: "2.0", id: 1 }],
  ["params that are a string", { method: "status", params: "x" }],
])("refuses %s with no-store", async (_n, body) => {
  const spy = vi.spyOn(globalThis, "fetch");
  const res = await call(body);
  expect(res.status).toBe(400);
  expect(res.headers.get("cache-control")).toBe("no-store");
  expect(spy).not.toHaveBeenCalled();
});

test("refuses a body that is not JSON", async () => {
  expect((await raw("not json")).status).toBe(400);
});

test("refuses a body over 64 KB without buffering it, with and without content-length", async () => {
  const spy = vi.spyOn(globalThis, "fetch");
  const big = JSON.stringify({ method: "status", params: { pad: "x".repeat(70_000) } });
  const a = await raw(big);
  expect(a.status).toBe(413);
  expect(a.headers.get("cache-control")).toBe("no-store");
  expect((await call({ method: "status" }, { "content-length": "70000" })).status).toBe(413);
  expect(spy).not.toHaveBeenCalled();
});

test("tx_search accepts only a hash query and a small page size", async () => {
  const spy = ok();
  expect((await call({ method: "tx_search", params: { query: `tx.hash='${HASH}'`, prove: false, page: "1" } })).status).toBe(200);
  expect((await call({ method: "tx_search", params: { query: `tx.hash='${HASH}'`, per_page: "10" } })).status).toBe(200);
  expect(spy).toHaveBeenCalledTimes(2);
  spy.mockClear();
  for (const params of [
    { query: "message.sender='qor1abc'" },
    { query: `tx.hash='${HASH}' OR tx.height>0` },
    { query: "tx.hash='abc'" },
    { query: `tx.hash='${HASH}'`, per_page: "100" },
    { query: `tx.hash='${HASH}'`, per_page: "0" },
    {},
    [`tx.hash='${HASH}'`],
  ]) {
    expect((await call({ method: "tx_search", params })).status).toBe(400);
  }
  expect(spy).not.toHaveBeenCalled();
});

test("passes an upstream error through with no-store", async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response('{"error":"x"}', { status: 500 }));
  const res = await call({ method: "status" });
  expect(res.status).toBe(500);
  expect(res.headers.get("cache-control")).toBe("no-store");
});

test("returns 502 when the upstream is unreachable", async () => {
  vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("fetch failed"));
  const res = await call({ method: "status" });
  expect(res.status).toBe(502);
  expect(res.headers.get("cache-control")).toBe("no-store");
});

test.each(["TimeoutError", "AbortError"])("returns 504 on %s", async (name) => {
  vi.spyOn(globalThis, "fetch").mockRejectedValue(new DOMException("timed out", name));
  const res = await call({ method: "status" });
  expect(res.status).toBe(504);
  expect(res.headers.get("cache-control")).toBe("no-store");
});
