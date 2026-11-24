import { describe, expect, test } from "bun:test";
import { createRateLimiter } from "../../src/lib/ratelimit.ts";
import { memoizeAsync } from "../../src/lib/ttl-cache.ts";

describe("createRateLimiter", () => {
  test("allows up to the limit, then reports seconds to wait, per key", () => {
    let t = 0;
    const hit = createRateLimiter({ limit: 2, windowMs: 60_000, now: () => t });
    expect(hit("a")).toEqual({ ok: true });
    t = 1000;
    expect(hit("a")).toEqual({ ok: true });
    expect(hit("a")).toEqual({ ok: false, retryAfter: 59 });
    expect(hit("b")).toEqual({ ok: true });
  });

  test("the window resets", () => {
    let t = 0;
    const hit = createRateLimiter({ limit: 1, windowMs: 60_000, now: () => t });
    hit("a");
    expect(hit("a").ok).toBe(false);
    t = 60_000;
    expect(hit("a")).toEqual({ ok: true });
  });

  test("memory stays bounded: expired keys go first, then the oldest", () => {
    let t = 0;
    const hit = createRateLimiter({ limit: 1, windowMs: 1000, maxKeys: 3, now: () => t });
    hit("a"); hit("b"); hit("c");
    hit("d"); // full: evicts the oldest ("a") since nothing expired
    expect(hit("a")).toEqual({ ok: true }); // "a" was forgotten
    expect(hit("c").ok).toBe(false); // "c" is still tracked
    t = 5000;
    hit("e"); // everything expired
    expect(hit("e").ok).toBe(false);
  });
});

describe("memoizeAsync", () => {
  test("caches for the ttl, shares in-flight loads and never caches rejections", async () => {
    let t = 0, calls = 0, fail = true;
    const get = memoizeAsync(async (k: string) => { calls++; if (fail) throw new Error("down"); return `${k}!`; }, { ttlMs: 60_000, now: () => t });
    await expect(get("a")).rejects.toThrow("down");
    fail = false;
    expect(await Promise.all([get("a"), get("a")])).toEqual(["a!", "a!"]);
    expect(calls).toBe(2);
    expect(await get("a")).toBe("a!");
    expect(calls).toBe(2);
    t = 60_001;
    await get("a");
    expect(calls).toBe(3);
  });
});
