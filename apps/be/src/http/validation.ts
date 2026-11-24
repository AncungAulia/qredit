import type { Context } from "hono";
import { z } from "zod";

export const qorAddress = z.string().regex(/^qor1[02-9ac-hj-np-z]{38,58}$/);
export const evmAddress = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
export const hash32 = z.string().regex(/^0x[0-9a-fA-F]{64}$/);

export const bad = (c: Context, error: string, status: 400 | 401 | 404 | 413 | 422 | 429 | 503 = 400) => c.json({ error }, status);

/** Parse the JSON body against a schema; null when the body is not valid JSON or does not match. */
export const parseBody = async <T>(c: Context, schema: z.ZodType<T>): Promise<T | null> => {
  const parsed = schema.safeParse(await c.req.json().catch((e) => { if (e instanceof SyntaxError) return undefined; throw e; }));
  return parsed.success ? parsed.data : null;
};
