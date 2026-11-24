import { join } from "node:path";
import { z } from "zod";

const defaultKeysDir = join(import.meta.dir, "..", ".keys");
const effort = z.enum(["none", "minimal", "low", "medium"]);
const modelList = z
  .string()
  .default("google/gemini-3.1-flash-lite,z-ai/glm-5.3-flash")
  .transform((s) => s.split(",").map((m) => m.trim()).filter(Boolean))
  .refine((l) => l.length > 0, "AGENT_MODELS must name at least one model");

const schema = z.object({
  OWNER_ADDRESS: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  API_URL: z.string().url().default("http://localhost:8787"),
  ENGINE_TOKEN: z.string().min(32).optional(),
  OPENROUTER_API_KEY: z.string().min(20).optional(),
  AGENT_MODELS: modelList,
  AGENT_EFFORT: effort.default("minimal"),
  AGENT_EFFORT_DEEP: effort.default("low"),
  SUPPLIERS_URL: z.string().url().default("http://localhost:8788"),
  AGENT_POLL_MS: z.coerce.number().int().min(500).default(3000),
  KEYS_DIR: z.string().default(defaultKeysDir),
});
export type EngineConfig = z.infer<typeof schema>;
export type AgentConfig = EngineConfig & { OPENROUTER_API_KEY: string; ENGINE_TOKEN: string };

export const loadEngineConfig = (env: Record<string, string | undefined> = process.env): EngineConfig => schema.parse(env);

/** The agent runner needs the LLM key and the backend token; the owner CLI does not. */
export function requireAgentConfig(c: EngineConfig): AgentConfig {
  if (!c.OPENROUTER_API_KEY) throw new Error("set OPENROUTER_API_KEY in engine/.env (OpenRouter key for the agents)");
  if (!c.ENGINE_TOKEN) throw new Error("set ENGINE_TOKEN in engine/.env (same value as apps/be/.env)");
  return c as AgentConfig;
}

/** The key folder alone, so commands that need no other setting (accounts init) work on a fresh checkout. */
export const keysDir = (env: Record<string, string | undefined> = process.env): string => env.KEYS_DIR ?? defaultKeysDir;
