import { afterEach, expect, test, vi } from "vitest";
import { POST, RPC_METHODS } from "../../../../../../app/api/chain/rpc/route";

afterEach(() => vi.restoreAllMocks());

const call = (body: unknown, headers: Record<string, string> = {}) =>
  POST(new Request("http://x/api/chain/rpc", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json", ...headers } }));

test("forwards an allowed method", async () => {
  const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response('{"jsonrpc":"2.0","id":1,"result":{}}', { status: 200 }));
  const res = await call({ jsonrpc: "2.0", id: 1, method: "status", params: {} });
  expect(res.status).toBe(200);
  expect(spy.mock.calls[0][0]).toBe("https://rpc-testnet.qore.host");
  expect(res.headers.get("cache-control")).toBe("no-store");
});

test("refuses other methods, batches and bad bodies", async () => {
  const spy = vi.spyOn(globalThis, "fetch");
  expect((await call({ jsonrpc: "2.0", id: 1, method: "unsafe_flush_mempool" })).status).toBe(400);
  expect((await call([{ jsonrpc: "2.0", id: 1, method: "status" }])).status).toBe(400);
  expect((await call(null)).status).toBe(400);
  expect((await call({ jsonrpc: "2.0", id: 1 })).status).toBe(400);
  expect((await POST(new Request("http://x", { method: "POST", body: "not json" }))).status).toBe(400);
  expect(spy).not.toHaveBeenCalled();
});

test("refuses a body over 64 KB", async () => {
  const spy = vi.spyOn(globalThis, "fetch");
  const big = { jsonrpc: "2.0", id: 1, method: "status", params: { pad: "x".repeat(70_000) } };
  expect((await call(big)).status).toBe(400);
  expect((await call({ jsonrpc: "2.0", id: 1, method: "status" }, { "content-length": "70000" })).status).toBe(400);
  expect(spy).not.toHaveBeenCalled();
});

test("returns 502 when the upstream is unreachable", async () => {
  vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("fetch failed"));
  const res = await call({ jsonrpc: "2.0", id: 1, method: "status" });
  expect(res.status).toBe(502);
});

test("the method allowlist holds only what the browser needs", () => {
  expect([...RPC_METHODS]).toContain("broadcast_tx_sync");
  expect([...RPC_METHODS]).toContain("tx_search");
  expect([...RPC_METHODS]).toEqual(["status", "broadcast_tx_sync", "tx_search"]);
});
