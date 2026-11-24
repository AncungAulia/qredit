import type { Context, MiddlewareHandler } from "hono";
import { bodyLimit } from "hono/body-limit";

export const MAX_BODY_DEFAULT = 16 * 1024;
export const MAX_BODY_ENVELOPE = 300 * 1024;

/** Size limits run before any JSON parsing or auth that needs the body. */
export function bodyLimits(): MiddlewareHandler {
  const tooLarge = (c: Context) => c.json({ error: "request body too large" }, 413);
  const small = bodyLimit({ maxSize: MAX_BODY_DEFAULT, onError: tooLarge });
  const large = bodyLimit({ maxSize: MAX_BODY_ENVELOPE, onError: tooLarge });
  return (c, next) => (c.req.method === "POST" && c.req.path === "/v1/envelopes" ? large(c, next) : small(c, next));
}
