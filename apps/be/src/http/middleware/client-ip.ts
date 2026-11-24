import { isIP } from "node:net";
import type { Context } from "hono";
import { getConnInfo } from "hono/bun";

export type ClientIp = (c: Context) => string;

/** The address the trusted proxy appended to x-forwarded-for; otherwise the socket peer. Never the leftmost entry. */
export function clientIpResolver(trustedProxyHops: number): ClientIp {
  return (c) => {
    if (trustedProxyHops > 0) {
      const parts = (c.req.header("x-forwarded-for") ?? "").split(",").map((p) => p.trim());
      const candidate = parts.length >= trustedProxyHops ? parts[parts.length - trustedProxyHops] : undefined;
      if (candidate && isIP(candidate)) return candidate;
    }
    try {
      return getConnInfo(c).remote.address ?? "unknown";
    } catch {
      return "unknown";
    }
  };
}
