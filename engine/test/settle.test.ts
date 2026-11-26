import { describe, expect, test } from "bun:test";
import { everyMs, settleDue, type ReviewOrder } from "../src/agent/settle.ts";

const V1 = "0x" + "11".repeat(20);
const V2 = "0x" + "22".repeat(20);

describe("settleDue", () => {
  test("settles only orders whose review has ended and keeps going after a failure", async () => {
    const lists: Record<string, ReviewOrder[]> = {
      [V1]: [{ orderId: "1", reviewEnds: 100 }, { orderId: "2", reviewEnds: 200 }, { orderId: "3", reviewEnds: null }],
      [V2]: [{ orderId: "4", reviewEnds: 50 }],
    };
    const settled: string[] = [];
    const logs: string[] = [];
    const n = await settleDue([V1, V2], {
      inReview: async (v) => lists[v]!,
      settle: async (v, id) => {
        if (id === 4n) throw new Error("rpc down");
        settled.push(`${v}:${id}`);
        return { tx: "0xs", alreadyClosed: false };
      },
      now: () => 150,
      log: (l) => logs.push(l),
    });
    expect(settled).toEqual([`${V1}:1`]);
    expect(n).toBe(1);
    expect(logs.some((l) => l.includes("order 4") && l.includes("rpc down"))).toBe(true);
  });

  test("a vault whose list cannot be read is skipped", async () => {
    const logs: string[] = [];
    const n = await settleDue([V1], {
      inReview: async () => { throw new Error("HTTP 503"); },
      settle: async () => ({ tx: "0xs", alreadyClosed: false }),
      now: () => 0,
      log: (l) => logs.push(l),
    });
    expect(n).toBe(0);
    expect(logs[0]).toContain("HTTP 503");
  });

  test("an order settled by someone else is not counted", async () => {
    const n = await settleDue([V1], {
      inReview: async () => [{ orderId: "1", reviewEnds: 1 }],
      settle: async () => ({ tx: null, alreadyClosed: true }),
      now: () => 10,
      log: () => {},
    });
    expect(n).toBe(0);
  });
});

describe("everyMs", () => {
  test("runs at most once per interval", async () => {
    let t = 0;
    let runs = 0;
    const tick = everyMs(async () => { runs++; }, 1000, () => t);
    await tick();
    t = 500;
    await tick();
    t = 1000;
    await tick();
    expect(runs).toBe(2);
  });
});
