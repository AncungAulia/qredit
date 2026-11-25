import { describe, expect, test } from "bun:test";
import { loadEngineConfig, requireAgentConfig } from "../src/config.ts";

const base = { OWNER_ADDRESS: "0x5f3c6d26d4acff449483a38aa18e043ac4cf0b40" };

describe("agent config", () => {
  test("defaults", () => {
    const c = loadEngineConfig(base);
    expect(c.AGENT_MODELS).toEqual(["google/gemini-3.1-flash-lite", "z-ai/glm-5.3-flash"]);
    expect(c.AGENT_EFFORT).toBe("minimal");
    expect(c.AGENT_EFFORT_DEEP).toBe("low");
    expect(c.SUPPLIERS_URL).toBe("http://localhost:8788");
    expect(c.AGENT_POLL_MS).toBe(3000);
  });
  test("models list is trimmed and must not be empty", () => {
    expect(loadEngineConfig({ ...base, AGENT_MODELS: " a/b , c/d " }).AGENT_MODELS).toEqual(["a/b", "c/d"]);
    expect(() => loadEngineConfig({ ...base, AGENT_MODELS: " , " })).toThrow();
  });
  test("effort is an enum", () => {
    expect(() => loadEngineConfig({ ...base, AGENT_EFFORT: "max" })).toThrow();
  });
  test("the agent needs the OpenRouter key and the engine token", () => {
    expect(() => requireAgentConfig(loadEngineConfig(base))).toThrow(/OPENROUTER_API_KEY/);
    const ok = loadEngineConfig({ ...base, OPENROUTER_API_KEY: "sk-or-v1-" + "x".repeat(40), ENGINE_TOKEN: "t".repeat(32) });
    expect(requireAgentConfig(ok).OPENROUTER_API_KEY.startsWith("sk-or-")).toBe(true);
  });
  test("unknown env vars are ignored", () => {
    expect(() => loadEngineConfig({ ...base, GEMINI_API_KEY: "x", PATH: "y" })).not.toThrow();
  });
});
