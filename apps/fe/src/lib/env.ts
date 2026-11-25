// src/lib/env.ts: the only place that reads process.env.
// Missing or malformed values stop the app at startup instead of falling back to a guess.
import { z } from "zod";

const envSchema = z.object({
  // Optional until Task 3 defines the real variables; the build must not require them.
  NEXT_PUBLIC_API_URL: z.url().optional(),
});

// Each variable is referenced literally so Next.js can inline NEXT_PUBLIC_* values in the client bundle.
export const env = envSchema.parse({
  NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL,
});
