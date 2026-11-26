import { describe, expect, test } from "bun:test";
import type { BusinessRuntime, Outcome, PipelineDeps } from "../src/agent/pipeline.ts";
import { runLoop } from "../src/agent/run.ts";
import type { Order } from "../src/agent/types.ts";

const V1 = "0x" + "11".repeat(20);
const V2 = "0x" + "22".repeat(20);
const biz = (slug: string, vault: string) => ({ slug, vault }) as unknown as BusinessRuntime;
const order = (vault: string, orderId: string) => ({ vault, orderId }) as unknown as Order;

describe("runLoop", () => {
  test("routes orders by vault, survives a thrown handler, sleeps when idle, exits on abort", async () => {
    const queue: (Order | null)[] = [order(V1, "1"), null, order(V2, "2"), null];
    const logs: string[] = [];
    const handled: string[] = [];
    const sleeps: number[] = [];
    const ctl = new AbortController();
    const claimed: string[][] = [];
    await runLoop({
      businesses: [biz("a", V1), biz("b", V2)],
      deps: { log: (l: string) => logs.push(l) } as unknown as PipelineDeps,
      pollMs: 50,
      signal: ctl.signal,
      claim: async (vaults) => {
        claimed.push(vaults);
        if (queue.length === 0) { ctl.abort(); return null; }
        return queue.shift()!;
      },
      handle: async (o, b): Promise<Outcome> => {
        handled.push(`${b.slug}:${o.orderId}`);
        if (b.slug === "b") throw new Error("boom");
        return { status: "delivered" };
      },
      sleep: async (ms) => { sleeps.push(ms); },
    });
    expect(handled).toEqual(["a:1", "b:2"]);
    expect(claimed[0]).toEqual([V1, V2]);
    expect(logs.some((l) => l.includes("boom"))).toBe(true);
    expect(sleeps.length).toBeGreaterThanOrEqual(2);
    expect(sleeps.every((s) => s === 50)).toBe(true);
  });

  test("an order for an unknown vault is logged and skipped", async () => {
    const logs: string[] = [];
    const ctl = new AbortController();
    let n = 0;
    await runLoop({
      businesses: [biz("a", V1)],
      deps: { log: (l: string) => logs.push(l) } as unknown as PipelineDeps,
      pollMs: 1, signal: ctl.signal,
      claim: async () => { if (n++ === 0) return order(V2, "9"); ctl.abort(); return null; },
      handle: async () => { throw new Error("must not run"); },
      sleep: async () => {},
    });
    expect(logs.some((l) => l.includes("unknown vault"))).toBe(true);
  });

  test("a claim error is logged and the loop keeps going", async () => {
    const logs: string[] = [];
    const ctl = new AbortController();
    let n = 0;
    await runLoop({
      businesses: [biz("a", V1)],
      deps: { log: (l: string) => logs.push(l) } as unknown as PipelineDeps,
      pollMs: 1, signal: ctl.signal,
      claim: async () => { if (n++ === 0) throw new Error("net down"); ctl.abort(); return null; },
      sleep: async () => {},
    });
    expect(logs.some((l) => l.includes("net down"))).toBe(true);
  });

  test("calls onIdle when nothing was claimed, before sleeping", async () => {
    const ctl = new AbortController();
    const seen: string[] = [];
    let polls = 0;
    await runLoop({
      businesses: [biz("a", V1)],
      deps: { log: () => {} } as unknown as PipelineDeps,
      pollMs: 10,
      signal: ctl.signal,
      claim: async () => { if (++polls > 2) ctl.abort(); return null; },
      onIdle: async () => { seen.push("idle"); },
      sleep: async () => { seen.push("sleep"); },
    });
    expect(seen.slice(0, 4)).toEqual(["idle", "sleep", "idle", "sleep"]);
  });
});
