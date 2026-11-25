import { afterEach, expect, test, vi } from "vitest";
import { GET, isAllowedPath } from "../../../../../../app/api/chain/rest/[...path]/route";

afterEach(() => vi.restoreAllMocks());

test("allowlist", () => {
  expect(isAllowedPath("qorechain/pqc/v1/account/qor1abc")).toBe(true);
  expect(isAllowedPath("cosmos/bank/v1beta1/balances/qor1abc")).toBe(true);
  expect(isAllowedPath("cosmos/tx/v1beta1/txs")).toBe(false);
  expect(isAllowedPath("../etc/passwd")).toBe(false);
});

test("forwards an allowed GET", async () => {
  const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response('{"ok":1}', { status: 200, headers: { "content-type": "application/json" } }));
  const res = await GET(new Request("http://x/api/chain/rest/cosmos/bank/v1beta1/balances/qor1abc?denom=uqor"), {
    params: Promise.resolve({ path: ["cosmos", "bank", "v1beta1", "balances", "qor1abc"] }),
  });
  expect(res.status).toBe(200);
  expect(spy.mock.calls[0][0]).toBe("https://api-testnet.qore.host/cosmos/bank/v1beta1/balances/qor1abc?denom=uqor");
});

test("returns 502 when the upstream is unreachable", async () => {
  vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("fetch failed"));
  const res = await GET(new Request("http://x/api/chain/rest/cosmos/bank/v1beta1/balances/qor1abc"), {
    params: Promise.resolve({ path: ["cosmos", "bank", "v1beta1", "balances", "qor1abc"] }),
  });
  expect(res.status).toBe(502);
  expect(await res.json()).toEqual({ error: "upstream unavailable" });
});

test("refuses a path outside the allowlist", async () => {
  const res = await GET(new Request("http://x/api/chain/rest/cosmos/tx/v1beta1/txs"), { params: Promise.resolve({ path: ["cosmos", "tx", "v1beta1", "txs"] }) });
  expect(res.status).toBe(404);
});

const call = (path: string[], url = "http://x/api/chain/rest/x") => GET(new Request(url), { params: Promise.resolve({ path }) });
const ACCOUNT = ["qorechain", "pqc", "v1", "account"];

test.each([
  ["a decoded dot segment", [...ACCOUNT, "..", "..", "cosmos", "base"]],
  ["an encoded dot segment", [...ACCOUNT, "%2e%2e", "cosmos"]],
  ["a double-encoded dot segment", [...ACCOUNT, "%2e%2e", "%2e%2e", "%2e%2e", "%2e%2e", "cosmos", "base", "tendermint", "v1beta1", "node_info"]],
  ["an encoded question mark", [...ACCOUNT, "qor1abc%3Fx=1"]],
  ["a question mark", [...ACCOUNT, "qor1abc?x=1"]],
  ["a hash", [...ACCOUNT, "qor1abc#frag"]],
  ["a backslash", [...ACCOUNT, "a\\b"]],
  ["an empty segment", [...ACCOUNT, "", "qor1abc"]],
])("refuses %s", async (_name, path) => {
  const spy = vi.spyOn(globalThis, "fetch");
  const res = await call(path);
  expect(res.status).toBe(404);
  expect(spy).not.toHaveBeenCalled();
});

test("forwards a normal allowed path to the exact upstream address", async () => {
  const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));
  const res = await call([...ACCOUNT, "qor1abc"], "http://x/api/chain/rest/x?a=1&b=2");
  expect(res.status).toBe(200);
  expect(res.headers.get("cache-control")).toBe("public, max-age=5");
  expect(spy.mock.calls[0][0]).toBe("https://api-testnet.qore.host/qorechain/pqc/v1/account/qor1abc?a=1&b=2");
});

test("does not cache a non-2xx upstream answer", async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response('{"error":"x"}', { status: 500 }));
  const res = await call([...ACCOUNT, "qor1abc"]);
  expect(res.status).toBe(500);
  expect(res.headers.get("cache-control")).toBe("no-store");
});
