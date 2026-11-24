import { join } from "node:path";
import { z } from "zod";

const defaultKeysDir = join(import.meta.dir, "..", ".keys");
const schema = z.object({
  OWNER_ADDRESS: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  API_URL: z.string().url().default("http://localhost:8787"),
  ENGINE_TOKEN: z.string().min(32).optional(),
  GEMINI_API_KEY: z.string().optional(),
  KEYS_DIR: z.string().default(defaultKeysDir),
});
export type EngineConfig = z.infer<typeof schema>;
export const loadEngineConfig = (env: Record<string, string | undefined> = process.env): EngineConfig => schema.parse(env);

/** The key folder alone, so commands that need no other setting (accounts init) work on a fresh checkout. */
export const keysDir = (env: Record<string, string | undefined> = process.env): string => env.KEYS_DIR ?? defaultKeysDir;
