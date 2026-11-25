import { afterEach, expect, test, vi } from "vitest";
import { GET, isAllowedPath } from "./[...path]/route";

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

test("refuses a path outside the allowlist", async () => {
  const res = await GET(new Request("http://x/api/chain/rest/cosmos/tx/v1beta1/txs"), { params: Promise.resolve({ path: ["cosmos", "tx", "v1beta1", "txs"] }) });
  expect(res.status).toBe(404);
});
