import { describe, expect, test } from "bun:test";
import { ApiError, createApi } from "../src/agent/api.ts";

type Call = { url: string; init: RequestInit };
const fakeFetch = (respond: (c: Call) => Response | Promise<Response>) => {
  const calls: Call[] = [];
  const f = (async (url: string, init: RequestInit) => {
    const c = { url, init };
    calls.push(c);
    return respond(c);
  }) as unknown as typeof fetch;
  return { f, calls };
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const V = "0x00000000000000000000000000000000000000aa";

describe("agent api client", () => {
  test("claim sends the vaults with the bearer header and returns the order or null", async () => {
    const order = { vault: V, orderId: "1", buyer: "0x1", serviceId: 0, price: "10", requestRef: "0x2", deadline: 5 };
    const a = fakeFetch(() => json({ order }));
    const api = createApi({ url: "http://be/", token: "tok", fetch: a.f });
    expect(await api.claim([V])).toEqual(order);
    expect(a.calls[0]!.url).toBe("http://be/v1/orders/claim");
    expect((a.calls[0]!.init.headers as Record<string, string>).authorization).toBe("Bearer tok");
    expect(JSON.parse(a.calls[0]!.init.body as string)).toEqual({ vaults: [V] });
    const none = createApi({ url: "http://be", token: "t", fetch: fakeFetch(() => json({ order: null })).f });
    expect(await none.claim([V])).toBeNull();
  });
  test("envelope and card return null on 404 and the payload on 200", async () => {
    const missing = createApi({ url: "http://be", token: "t", fetch: fakeFetch(() => json({ error: "not found" }, 404)).f });
    expect(await missing.envelope("0xab")).toBeNull();
    expect(await missing.card("qor1x")).toBeNull();
    const ok = createApi({ url: "http://be", token: "t", fetch: fakeFetch((c) => (c.url.includes("envelopes") ? json({ kind: "request", body: "txt" }) : json({ card: { a: 1 } }))).f });
    expect(await ok.envelope("0xab")).toBe("txt");
    expect(await ok.card("qor1x")).toEqual({ a: 1 });
  });
  test("a 422 from relay becomes ApiError with the error text", async () => {
    const api = createApi({ url: "http://be", token: "t", fetch: fakeFetch(() => json({ error: "gas limit must be 1..1000000" }, 422)).f });
    const err = await api.relay({ typeUrl: "x", value: {} as never }).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(422);
    expect(err.message).toBe("gas limit must be 1..1000000");
  });
  test("a hung request aborts after timeoutMs", async () => {
    const hang = ((_u: string, init: RequestInit) =>
      new Promise((_r, reject) => init.signal!.addEventListener("abort", () => reject(init.signal!.reason)))) as unknown as typeof fetch;
    const api = createApi({ url: "http://be", token: "t", fetch: hang, timeoutMs: 50 });
    await expect(api.relayer()).rejects.toBeDefined();
  });
  test("decision sends cost as a decimal string; putReport and relayer read their fields", async () => {
    const a = fakeFetch((c) => (c.url.endsWith("/v1/envelopes") ? json({ hash: "0xh" }) : c.url.endsWith("/v1/relayer") ? json({ address: "qor1r" }) : json({ id: 1 })));
    const api = createApi({ url: "http://be", token: "t", fetch: a.f });
    await api.decision({ vault: V, orderId: "1", decision: "accepted", reason: "ok", suppliers: [], cost: 12345678901234567890n });
    expect(JSON.parse(a.calls[0]!.init.body as string).cost).toBe("12345678901234567890");
    expect(await api.putReport("body")).toBe("0xh");
    expect(JSON.parse(a.calls[1]!.init.body as string)).toEqual({ kind: "report", body: "body" });
    expect(await api.relayer()).toBe("qor1r");
  });
});
