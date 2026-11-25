import { z } from "zod";

/** The answer to storing a sealed request: the hash the backend computed. */
export const envelopeResponseSchema = z.object({
  hash: z.string().regex(/^0x[0-9a-fA-F]{64}$/).transform((v) => v.toLowerCase() as `0x${string}`),
});
