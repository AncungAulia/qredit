import { describe, expect, test } from "bun:test";
import { envelopeFromText, generateSealKeys, open, recipientOf } from "@qorechain/qoreseal";
import { envelopeHash } from "@qredit/qore";
import type { Llm, PlanInput } from "../src/agent/llm.ts";
import { handleOrder, type BusinessRuntime, type PipelineDeps } from "../src/agent/pipeline.ts";
import { sealRequest } from "../src/agent/seal.ts";
import { createSuppliersClient, SupplierRefused } from "../src/agent/suppliers-client.ts";
import type { Order, Prices } from "../src/agent/types.ts";
import { SERVICES } from "../src/services/index.ts";
import type { SupplierRole } from "../src/setup/businesses.ts";

const chainId = "qorechain-diana";
const vault = "0x37bbb37dd96a973a22ca64bc809a8bc4d54b03d4";
const ADDR = "0x487f449c21a48eaf9d2eb3804f511dfb7715eea9";
const agentKeys = generateSealKeys();
const buyerKeys = generateSealKeys();
const NOW = 1_000_000;
const prices: Prices = { dataIndexer: 50000n, listOracle: 20000n, computeBasic: 30000n, computeDeep: 100000n };
const address = Object.fromEntries(Object.keys(prices).map((r, i) => [r, "0x" + String(i + 1).repeat(40)])) as Record<SupplierRole, string>;

const indexer = {
  address: { bech32: "qor1x", hex: ADDR }, exists: true, sequence: 3, publicKeyType: "eth_secp256k1", isContract: false,
  pq: { registered: true, possessionProven: true, keyType: "hybrid", window: { live: false, allowedTargets: [] } },
  flagged: { listed: false, entry: null, list: "l" },
};
const bytecode = { address: ADDR, isContract: true, codeSize: 100, erc20Selectors: [], usesPqcVerify: true, usesPqcKeyStatus: false, ecrecoverHint: false };
const roleData: Partial<Record<SupplierRole, unknown>> = {
  dataIndexer: indexer,
  computeBasic: bytecode,
  computeDeep: { ...bytecode, token: { name: "T", symbol: "T", decimals: 18, totalSupply: "1" }, owner: null },
};

type Opts = {
  service?: string; serviceId?: number; input?: string; price?: string; envelope?: "ok" | "missing" | "junk";
  opex?: bigint; buyer?: boolean; prepaid?: SupplierRole[]; relayFail?: boolean | "not_broadcast" | "refused" | "unconfirmed" | "execution_failed"; closed?: boolean; now?: number;
  llm?: Partial<Llm>; wrongHash?: boolean;
  relayThrow?: boolean; payThrow?: boolean; waitForFail?: boolean; getError?: Error; deliverThrow?: boolean; shared?: Set<SupplierRole>;
  chain?: Set<SupplierRole>; slowRelay?: boolean;
};

function setup(o: Opts = {}) {
  const slug = o.service ?? "counterparty-check";
  const serviceId = o.serviceId ?? 0;
  const text = sealRequest({ body: { v: 1, serviceId, input: o.input ?? ADDR }, vault, recipient: recipientOf(agentKeys), chainId });
  const order: Order = { vault, orderId: "7", buyer: "0x" + "ab".repeat(20), serviceId: 0, price: o.price ?? "200000", requestRef: envelopeHash(text), deadline: NOW + 3600 };
  const calls = {
    relay: [] as string[], deliver: [] as unknown[][], decline: [] as unknown[][],
    decisions: [] as Record<string, any>[], planCalls: 0, writeCalls: 0,
  };
  const logs: string[] = [];
  const chain = o.chain ?? new Set<SupplierRole>();
  const paid = o.shared ?? new Set<SupplierRole>(o.prepaid ?? []);
  let stored = "";
  const roleOf = (to: string) => (Object.keys(address) as SupplierRole[]).find((r) => address[r] === to)!;
  const llm: Llm = {
    async plan() { calls.planCalls++; return { model: null }; },
    async write() { calls.writeCalls++; return null; },
    ...o.llm,
  };
  const deps: PipelineDeps = {
    api: {
      envelope: async () => (o.envelope === "missing" ? null : o.envelope === "junk" ? "not an envelope" : text),
      putReport: async (b) => { stored = b; return o.wrongHash ? "0x" + "00".repeat(32) : envelopeHash(b); },
      decision: async (d) => { calls.decisions.push(d); },
      relay: async (r) => {
        const role = roleOf(r.value.to);
        calls.relay.push(role);
        chain.add(role);
        if (o.slowRelay) await new Promise((r) => setTimeout(r, 30));
        if (o.relayThrow) throw new Error(`fetch failed for ${ADDR}`);
        if (o.relayFail) return { txHash: "0xdead", success: false, code: o.relayFail === true ? "refused" : o.relayFail, reason: "nope" };
        paid.add(role);
        return { txHash: "0xbeef", success: true };
      },
    },
    signer: { payRequest: async (_v, supplier) => { if (o.payThrow) throw new Error(`rpc down ${ADDR}`); return { typeUrl: "t", value: { to: supplier } as never }; } },
    operator: {
      deliver: async (...a: unknown[]) => { calls.deliver.push(a); if (o.deliverThrow) throw new Error("rpc down"); return o.closed ? { tx: null, alreadyClosed: true } : { tx: "0xdel", alreadyClosed: false }; },
      decline: async (...a: unknown[]) => { calls.decline.push(a); return { tx: "0xdec", alreadyClosed: false }; },
    } as never,
    vaults: {
      funds: async () => ({ opex: o.opex ?? 100000n, dailyCap: 10_000_000n, spentToday: 0n, dayIndex: 1n, nowDay: 1n, paused: false }),
      supplierCap: async () => 1_000_000n,
    },
    suppliers: {
      get: async (role) => { if (o.getError) throw o.getError; return paid.has(role) ? roleData[role] : null; },
      waitFor: async (role) => { if (o.waitForFail || !(paid.has(role) || chain.has(role))) throw new Error(`timeout for ${ADDR}`); return roleData[role]; },
    },
    paidOnChain: async (_v, _o, supplier) => (chain.has(roleOf(supplier)) ? prices[roleOf(supplier)] : 0n),
    llm, prices, chainId, log: (l) => { logs.push(l); },
    resolveBuyer: async () => (o.buyer === false ? null : recipientOf(buyerKeys)),
    now: () => o.now ?? NOW,
  };
  const biz: BusinessRuntime = { slug, vault, spenderQor: "qor1s", service: SERVICES[slug]!, servicePrices: [200000n], sealKeys: agentKeys, supplierAddress: address };
  const report = () =>
    JSON.parse(new TextDecoder().decode(open({ chainId, purpose: "qredit/report/v1", envelope: envelopeFromText(stored), keys: buyerKeys, aad: new TextEncoder().encode(`${vault}:7`) })));
  return { order, biz, deps, calls, logs, report, stored: () => stored };
}

const DD = { service: "due-diligence", price: "300000" } as const;

describe("counterparty happy path", () => {
  test("pays the indexer once, seals the report, delivers the stored hash", async () => {
    const t = setup();
    const out = await handleOrder(t.order, t.biz, t.deps);
    expect(out).toEqual({ status: "delivered", tx: "0xdel" });
    expect(t.calls.relay).toEqual(["dataIndexer"]);
    expect(t.calls.planCalls).toBe(0);
    const rep = t.report();
    expect(rep.verdict.label).toBe("A");
    expect(rep.generatedBy).toBe("facts-only");
    expect(rep.suppliers).toEqual([{ role: "dataIndexer", amount: "50000" }]);
    expect(t.calls.deliver[0]).toEqual([vault, 7n, envelopeHash(t.stored())]);
    expect(t.calls.decisions).toHaveLength(1);
    expect(t.calls.decisions[0]).toMatchObject({ decision: "delivered", cost: 50000n, suppliers: [{ role: "dataIndexer", amount: "50000" }] });
  });
  test("the verdict labels go to llm.write and a grounded write sets generatedBy", async () => {
    let seen: readonly string[] | undefined;
    const t = setup({ llm: { async write(o) { seen = o.labels; return { prose: { summary: "ok", findings: [] }, model: "m/x" }; } } });
    await handleOrder(t.order, t.biz, t.deps);
    expect(seen).toEqual(["F", "D", "C", "B", "A"]);
    expect(t.report().generatedBy).toBe("m/x");
  });
});

describe("crash recovery", () => {
  test("data already served: no relay, cost counts the catalog price; a closed order is already-closed", async () => {
    const a = setup({ prepaid: ["dataIndexer"] });
    expect((await handleOrder(a.order, a.biz, a.deps)).status).toBe("delivered");
    expect(a.calls.relay).toEqual([]);
    expect(a.calls.decisions[0]).toMatchObject({ cost: 50000n });
    const b = setup({ prepaid: ["dataIndexer"], closed: true });
    expect((await handleOrder(b.order, b.biz, b.deps)).status).toBe("already-closed");
    expect(b.calls.relay).toEqual([]);
  });
  test("a choice role paid in an earlier run is reused without asking the model", async () => {
    const t = setup({ ...DD, prepaid: ["dataIndexer", "computeBasic"] });
    expect((await handleOrder(t.order, t.biz, t.deps)).status).toBe("delivered");
    expect(t.calls.relay).toEqual([]);
    expect(t.calls.planCalls).toBe(0);
    expect(t.calls.decisions[0]).toMatchObject({ cost: 80000n });
  });
});

describe("crash recovery against post-payment funds", () => {
  test("run 1 pays then crashes before deliver; run 2 with no opex left still delivers without paying", async () => {
    const shared = new Set<SupplierRole>();
    const one = setup({ ...DD, shared, deliverThrow: true, llm: { async plan(o) { await o.pay("computeBasic"); return { model: "m" }; } } });
    expect((await handleOrder(one.order, one.biz, one.deps)).status).toBe("failed");
    expect(one.calls.relay).toEqual(["dataIndexer", "computeBasic"]);
    expect(one.calls.decisions[0]).toMatchObject({ decision: "failed", cost: 80000n });
    const two = setup({ ...DD, shared, opex: 0n });
    expect((await handleOrder(two.order, two.biz, two.deps)).status).toBe("delivered");
    expect(two.calls.relay).toEqual([]);
    expect(two.calls.planCalls).toBe(0);
    expect(two.calls.decisions[0]).toMatchObject({ decision: "delivered", cost: 80000n });
  });
  test("only computeDeep paid earlier: deep is reused and basic is never paid", async () => {
    const t = setup({ ...DD, prepaid: ["dataIndexer", "computeDeep"], opex: 40000n });
    expect((await handleOrder(t.order, t.biz, t.deps)).status).toBe("delivered");
    expect(t.calls.relay).toEqual([]);
    expect(t.calls.decisions[0]).toMatchObject({ cost: 150000n });
  });
  test("resume pays only the unpaid required roles and picks the cheapest usable choice", async () => {
    const t = setup({ ...DD, prepaid: ["computeDeep"] });
    expect((await handleOrder(t.order, t.biz, t.deps)).status).toBe("delivered");
    expect(t.calls.relay).toEqual(["dataIndexer"]);
    const u = setup({ ...DD, prepaid: ["dataIndexer"], opex: 50000n });
    await handleOrder(u.order, u.biz, u.deps);
    expect(u.calls.relay).toEqual(["computeBasic"]);
    expect(u.calls.planCalls).toBe(0);
  });
});

describe("chain-checked payment probe", () => {
  test("supplier says 402 but the chain shows the payment: no relay, waits for data, delivers", async () => {
    const t = setup({ chain: new Set<SupplierRole>(["dataIndexer"]) });
    expect((await handleOrder(t.order, t.biz, t.deps)).status).toBe("delivered");
    expect(t.calls.relay).toEqual([]);
    expect(t.calls.decisions[0]).toMatchObject({ cost: 50000n });
  });
  test("relay threw in run 1 after submitting; run 2 does not pay again", async () => {
    const chain = new Set<SupplierRole>();
    const one = setup({ chain, relayThrow: true });
    expect((await handleOrder(one.order, one.biz, one.deps)).status).toBe("failed");
    const two = setup({ chain });
    expect((await handleOrder(two.order, two.biz, two.deps)).status).toBe("delivered");
    expect(two.calls.relay).toEqual([]);
  });
  test("an expired order records the cost found on chain", async () => {
    const t = setup({ now: NOW + 3600, chain: new Set<SupplierRole>(["dataIndexer"]) });
    expect((await handleOrder(t.order, t.biz, t.deps)).reason).toBe("expired");
    expect(t.calls.decisions[0]).toMatchObject({ decision: "failed", cost: 50000n });
  });
});

describe("serialized tool callbacks", () => {
  test("plan rejects while a pay call is still in flight: one relay, computeBasic used", async () => {
    const t = setup({ ...DD, slowRelay: true, llm: { async plan(o) { void o.pay("computeBasic"); throw new Error("timeout"); } } });
    expect((await handleOrder(t.order, t.biz, t.deps)).status).toBe("delivered");
    expect(t.calls.relay.filter((x) => x === "computeBasic")).toHaveLength(1);
    expect(t.report().suppliers.map((x: { role: string }) => x.role)).toContain("computeBasic");
  });
  test("concurrent distinct roles: one relay, the other refused", async () => {
    const msgs: string[] = [];
    const t = setup({ ...DD, opex: 1_000_000n, llm: { async plan(o) { msgs.push(...(await Promise.all([o.pay("computeBasic"), o.pay("computeDeep")]))); return { model: "m" }; } } });
    await handleOrder(t.order, t.biz, t.deps);
    expect(t.calls.relay).toEqual(["dataIndexer", "computeBasic"]);
    expect(msgs[1]).toStartWith("refused");
  });
  test("concurrent same role: exactly one relay", async () => {
    const t = setup({ ...DD, llm: { async plan(o) { await Promise.all([o.pay("computeBasic"), o.pay("computeBasic")]); return { model: "m" }; } } });
    await handleOrder(t.order, t.biz, t.deps);
    expect(t.calls.relay).toEqual(["dataIndexer", "computeBasic"]);
  });
  test("pay after an honoured decline is refused", async () => {
    let msg = "";
    const t = setup({ ...DD, llm: { async plan(o) { await o.decline(1, "x"); msg = await o.pay("computeBasic"); return { model: "m" }; } } });
    const out = await handleOrder(t.order, t.biz, t.deps);
    expect(out).toMatchObject({ status: "declined", code: 1 });
    expect(msg).toStartWith("refused");
    expect(t.calls.relay).toEqual(["dataIndexer"]);
  });
  test("the default plan picks the cheapest when basic and deep are both affordable", async () => {
    const t = setup({ ...DD, opex: 1_000_000n });
    await handleOrder(t.order, t.biz, t.deps);
    expect(t.calls.relay).toEqual(["dataIndexer", "computeBasic"]);
  });
});

describe("retriable failures", () => {
  const retry = { status: "failed" as const, reason: "temporary failure; will retry" };
  const cases: [string, Opts][] = [
    ["relay throws", { relayThrow: true }],
    ["payRequest throws", { payThrow: true }],
    ["supplier 5xx or network error", { getError: new Error(`fetch failed ${ADDR}`) }],
    ["waitFor times out", { waitForFail: true }],
    ["deliver throws", { deliverThrow: true }],
  ];
  for (const [name, o] of cases) {
    test(`${name}: failed, no chain decline, reason is fixed`, async () => {
      const t = setup(o);
      const out = await handleOrder(t.order, t.biz, t.deps);
      expect(out).toEqual(retry);
      expect(t.calls.decline).toHaveLength(0);
      expect(t.calls.decisions).toHaveLength(1);
      expect(t.calls.decisions[0]!.decision).toBe("failed");
      expect(t.calls.decisions[0]!.reason).toBe(retry.reason);
      expect(JSON.stringify(t.calls.decisions[0], (_k, v) => (typeof v === "bigint" ? v.toString() : v))).not.toContain(ADDR);
    });
  }
  for (const code of ["unconfirmed", "not_broadcast"] as const) {
    test(`relay ${code}: failed, no chain decline (the payment may have landed)`, async () => {
      const t = setup({ relayFail: code });
      expect(await handleOrder(t.order, t.biz, t.deps)).toEqual(retry);
      expect(t.calls.decline).toHaveLength(0);
      expect(t.calls.decisions[0]).toMatchObject({ decision: "failed", reason: retry.reason });
    });
  }
  test("a relay throw is logged with its step tag, never in the public reason", async () => {
    const t = setup({ relayThrow: true });
    await handleOrder(t.order, t.biz, t.deps);
    expect(t.logs.some((l) => l.includes("[relay]"))).toBe(true);
    expect(t.calls.decisions[0]!.reason).not.toContain("relay");
  });
  test("a paid role whose data never arrived is failed with its cost", async () => {
    const t = setup({ waitForFail: true });
    await handleOrder(t.order, t.biz, t.deps);
    expect(t.calls.decisions[0]).toMatchObject({ cost: 50000n });
    expect(t.calls.deliver).toHaveLength(0);
  });
  test("deliver throwing records the cost", async () => {
    const t = setup({ deliverThrow: true });
    await handleOrder(t.order, t.biz, t.deps);
    expect(t.calls.decisions[0]).toMatchObject({ decision: "failed", cost: 50000n });
  });
  test("a supplier answering 4xx declines with 6", async () => {
    const t = setup({ getError: new SupplierRefused("HTTP 400") });
    expect(await handleOrder(t.order, t.biz, t.deps)).toMatchObject({ status: "declined", code: 6 });
  });
  test("a closed order posts no decision (deliver and decline)", async () => {
    const a = setup({ closed: true });
    expect((await handleOrder(a.order, a.biz, a.deps)).status).toBe("already-closed");
    expect(a.calls.decisions).toHaveLength(0);
    const b = setup({ buyer: false });
    b.deps.operator.decline = (async () => ({ tx: null, alreadyClosed: true })) as never;
    expect((await handleOrder(b.order, b.biz, b.deps)).status).toBe("already-closed");
    expect(b.calls.decisions).toHaveLength(0);
  });
});

describe("llm behaviour", () => {
  test("plan throws: the cheapest affordable choice is bought", async () => {
    const t = setup({ ...DD, llm: { plan: async () => { throw new Error("down"); } } });
    expect((await handleOrder(t.order, t.biz, t.deps)).status).toBe("delivered");
    expect(t.calls.relay).toEqual(["dataIndexer", "computeBasic"]);
  });
  test("plan buys nothing: the default choice is bought", async () => {
    const t = setup(DD);
    await handleOrder(t.order, t.biz, t.deps);
    expect(t.calls.planCalls).toBe(1);
    expect(t.calls.relay).toEqual(["dataIndexer", "computeBasic"]);
  });
  test("a role that is not affordable is refused; allowed prices are passed to the model", async () => {
    let msg = "";
    let input: PlanInput | undefined;
    const t = setup({ ...DD, llm: { async plan(o) { input = o; msg = await o.pay("computeDeep"); return { model: "m" }; } } });
    await handleOrder(t.order, t.biz, t.deps);
    expect(msg).toStartWith("refused");
    expect(t.calls.relay).not.toContain("computeDeep");
    expect(input!.allowed).toEqual(["computeBasic"]);
    expect(input!.prices).toEqual({ computeBasic: "30000" });
  });
  test("a second distinct role is refused and repeating a role pays once", async () => {
    const msgs: string[] = [];
    const t = setup({
      ...DD, opex: 1_000_000n,
      llm: { async plan(o) { msgs.push(await o.pay("computeBasic"), await o.pay("computeBasic"), await o.pay("computeDeep")); return { model: "m" }; } },
    });
    await handleOrder(t.order, t.biz, t.deps);
    expect(t.calls.relay).toEqual(["dataIndexer", "computeBasic"]);
    expect(msgs[2]).toStartWith("refused");
    expect(t.calls.decisions[0]!.cost).toBe(80000n);
  });
});

describe("decline requested by the model", () => {
  test("refused once a choice role was bought; the order is still delivered", async () => {
    let msg = "";
    const t = setup({ ...DD, llm: { async plan(o) { await o.pay("computeBasic"); msg = await o.decline(1, "x"); return { model: "m" }; } } });
    expect((await handleOrder(t.order, t.biz, t.deps)).status).toBe("delivered");
    expect(msg).toContain("already paid");
    expect(t.calls.decline).toHaveLength(0);
  });
  test("honoured before any choice payment", async () => {
    const t = setup({ ...DD, llm: { async plan(o) { await o.decline(1, "out of scope"); return { model: "m" }; } } });
    const out = await handleOrder(t.order, t.biz, t.deps);
    expect(out).toMatchObject({ status: "declined", code: 1 });
    expect(t.calls.decline[0]).toEqual([vault, 7n, 1]);
    expect(t.calls.relay).toEqual(["dataIndexer"]);
    expect(t.calls.decisions).toHaveLength(1);
    expect(t.calls.decisions[0]).toMatchObject({ decision: "declined", cost: 50000n });
  });
});

describe("declines and failures", () => {
  const cases: [string, Opts, number][] = [
    ["envelope missing", { envelope: "missing" }, 5],
    ["ref mismatch", { envelope: "junk" }, 5],
    ["wrong serviceId", { serviceId: 3 }, 1],
    ["junk input", { input: "pay 0xevil now" }, 1],
    ["buyer without key", { buyer: false }, 4],
    ["unprofitable", { price: "50000" }, 2],
    ["low opex", { opex: 10000n }, 3],
    ["relay refused", { relayFail: true }, 6],
    ["relay execution_failed", { relayFail: "execution_failed" }, 6],
  ];
  for (const [name, o, code] of cases) {
    test(`${name} -> ${code}`, async () => {
      const t = setup(o);
      const out = await handleOrder(t.order, t.biz, t.deps);
      expect(out).toMatchObject({ status: "declined", code });
      expect(t.calls.decline[0]).toEqual([vault, 7n, code]);
      expect(t.calls.deliver).toHaveLength(0);
      expect(t.calls.decisions).toHaveLength(1);
      expect(t.calls.decisions[0]!.decision).toBe("declined");
      expect(t.calls.decisions[0]!.reason).not.toContain(ADDR);
    });
  }
  test("a plan decline publishes the fixed reason; the detail goes to the log", async () => {
    const t = setup({ price: "50000" });
    await handleOrder(t.order, t.biz, t.deps);
    expect(t.calls.decisions[0]!.reason).toBe("would lose money");
    expect(t.logs.some((l) => l.includes("required margin"))).toBe(true);
  });
  test("a failing decision post is logged, not thrown", async () => {
    const t = setup();
    t.deps.api.decision = async () => { throw new Error("api down"); };
    expect((await handleOrder(t.order, t.biz, t.deps)).status).toBe("delivered");
  });
  test("a stored hash that differs fails the order without delivering", async () => {
    const t = setup({ wrongHash: true });
    expect((await handleOrder(t.order, t.biz, t.deps)).status).toBe("failed");
    expect(t.calls.deliver).toHaveLength(0);
    expect(t.calls.decisions[0]).toMatchObject({ decision: "failed" });
  });
  test("an expired order is failed without any chain call", async () => {
    const t = setup({ now: NOW + 3600 - 30 });
    expect(await handleOrder(t.order, t.biz, t.deps)).toEqual({ status: "failed", reason: "expired" });
    expect(t.calls.relay).toEqual([]);
    expect(t.calls.decline).toHaveLength(0);
    expect(t.calls.deliver).toHaveLength(0);
  });
});

describe("suppliers client", () => {
  const res = (status: number, body: unknown = {}) => new Response(JSON.stringify(body), { status });
  test("get maps 200, 402 and errors; the URL carries vault, orderId and query", async () => {
    const urls: string[] = [];
    const codes = [200, 402, 500];
    const f = (async (u: string) => { urls.push(u); return res(codes.shift()!, { data: { a: 1 } }); }) as unknown as typeof fetch;
    const c = createSuppliersClient({ url: "http://s/", fetch: f });
    expect(await c.get("dataIndexer", vault, "7", { address: ADDR })).toEqual({ a: 1 });
    expect(await c.get("dataIndexer", vault, "7", { address: ADDR })).toBeNull();
    await expect(c.get("dataIndexer", vault, "7", {})).rejects.toThrow();
    expect(urls[0]).toBe(`http://s/v1/dataIndexer?vault=${vault}&orderId=7&address=${ADDR}`);
  });
  test("waitFor polls until data and times out", async () => {
    let n = 0;
    const slept: number[] = [];
    const mk = (ok: boolean) =>
      createSuppliersClient({
        url: "http://s", pollMs: 10, maxWaitMs: 30, sleep: async (ms) => { slept.push(ms); },
        fetch: (async () => (ok && ++n >= 3 ? res(200, { data: 1 }) : res(402))) as unknown as typeof fetch,
      });
    expect(await mk(true).waitFor("listOracle", vault, "1", {})).toBe(1);
    expect(slept).toEqual([10, 10]);
    await expect(mk(false).waitFor("listOracle", vault, "1", {})).rejects.toThrow(/did not confirm/);
  });
});
