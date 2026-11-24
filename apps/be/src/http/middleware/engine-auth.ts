import { timingSafeEqual } from "node:crypto";
import type { Context, MiddlewareHandler } from "hono";

export type EngineAuth = {
  /** True when the request carries the engine bearer token (constant-time compare). */
  isEngine: (c: Context) => boolean;
  /** Middleware that answers 401 unless the request is from the engine. */
  requireEngine: MiddlewareHandler;
};

export function engineAuth(engineToken: string): EngineAuth {
  const token = Buffer.from(engineToken);
  const isEngine = (c: Context) => {
    const given = Buffer.from((c.req.header("authorization") ?? "").replace(/^Bearer /, ""));
    return given.length === token.length && timingSafeEqual(given, token);
  };
  const requireEngine: MiddlewareHandler = async (c, next) => {
    if (!isEngine(c)) return c.json({ error: "unauthorized" }, 401);
    return next();
  };
  return { isEngine, requireEngine };
}
