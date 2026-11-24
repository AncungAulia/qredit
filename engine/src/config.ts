import { join } from "node:path";
import { z } from "zod";

const schema = z.object({
  OWNER_ADDRESS: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  API_URL: z.string().url().default("http://localhost:8787"),
  ENGINE_TOKEN: z.string().min(32).optional(),
  GEMINI_API_KEY: z.string().optional(),
  KEYS_DIR: z.string().default(join(import.meta.dir, "..", ".keys")),
});
export type EngineConfig = z.infer<typeof schema>;
export const loadEngineConfig = (env: Record<string, string | undefined> = process.env): EngineConfig => schema.parse(env);
