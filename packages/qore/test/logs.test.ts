import { describe, expect, test } from "bun:test";
import { blockRanges, scanChunked } from "../src/logs.ts";

describe("chunked log scan", () => {
  test("ranges are inclusive, contiguous and bounded", () => {
    expect(blockRanges(0, 4_999)).toEqual([[0, 1_999], [2_000, 3_999], [4_000, 4_999]]);
    expect(blockRanges(10, 10)).toEqual([[10, 10]]);
    expect(blockRanges(11, 10)).toEqual([]);
    expect(() => blockRanges(0, 1, 0)).toThrow();
  });
  test("concatenates results in order and passes bigint bounds", async () => {
    const seen: [bigint, bigint][] = [];
    const out = await scanChunked(100, 4_500, async (a, b) => { seen.push([a, b]); return [Number(a)]; });
    expect(out).toEqual([100, 2_100, 4_100]);
    expect(seen[2]).toEqual([4_100n, 4_500n]);
  });
  test("a failing chunk rejects the whole scan", async () => {
    await expect(scanChunked(0, 5_000, async () => { throw new Error("rpc down"); })).rejects.toThrow("rpc down");
  });
});
