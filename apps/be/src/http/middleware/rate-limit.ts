import type { Context, MiddlewareHandler } from "hono";
import { createRateLimiter } from "../../lib/ratelimit.ts";
import type { ClientIp } from "./client-ip.ts";

const RATE_WINDOW_MS = 60_000;

export type RateLimit = (perMinute: number, skip?: (c: Context) => boolean) => MiddlewareHandler;

/** Builds per-route limiters (per client ip, fixed one-minute window, in memory). */
export function rateLimiter(clientIp: ClientIp, now?: () => number): RateLimit {
  return (perMinute, skip) => {
    const hit = createRateLimiter({ limit: perMinute, windowMs: RATE_WINDOW_MS, now });
    return async (c, next) => {
      if (skip?.(c)) return next();
      const r = hit(clientIp(c));
      if (r.ok) return next();
      c.header("retry-after", String(r.retryAfter));
      return c.json({ error: "too many requests", retryAfter: r.retryAfter }, 429);
    };
  };
}
