import { isIP } from "node:net";
import type { Context } from "hono";
import { getConnInfo } from "hono/bun";

export type ClientIp = (c: Context) => string;

/**
 * The client address. With `clientIpHeader` set (a header the edge overwrites, such as Railway's x-real-ip) its value is used
 * when it is a valid ip. Otherwise the address the trusted proxy appended to x-forwarded-for, else the socket peer.
 * Never the leftmost x-forwarded-for entry.
 */
export function clientIpResolver(trustedProxyHops: number, clientIpHeader?: string): ClientIp {
  return (c) => {
    if (clientIpHeader) {
      const value = c.req.header(clientIpHeader)?.trim();
      if (value && isIP(value)) return value;
    }
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
