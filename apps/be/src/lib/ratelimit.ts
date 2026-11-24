import { ExpiringMap } from "./expiring.ts";

export type RateResult = { ok: true } | { ok: false; retryAfter: number };
export type RateLimiter = (key: string) => RateResult;

/**
 * Fixed-window limiter, in memory: per process, not shared between instances (single-instance deployment).
 * Memory is bounded by maxKeys; when full, expired windows go first, then the oldest key.
 */
export function createRateLimiter(o: { limit: number; windowMs: number; maxKeys?: number; now?: () => number }): RateLimiter {
  const now = o.now ?? Date.now;
  const windows = new ExpiringMap<{ count: number }>(o.maxKeys ?? 10_000, now);
  return (key) => {
    const t = now();
    const w = windows.get(key);
    if (!w) {
      windows.set(key, { count: 1 }, t + o.windowMs);
      return { ok: true };
    }
    if (w.value.count >= o.limit) return { ok: false, retryAfter: Math.max(1, Math.ceil((w.expiresAt - t) / 1000)) };
    w.value.count++;
    return { ok: true };
  };
}
