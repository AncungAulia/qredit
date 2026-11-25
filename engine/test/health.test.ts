import { describe, expect, test } from "bun:test";
import { healthPort, startHealthServer } from "../src/health.ts";

describe("agent health", () => {
  test("serves ok with the last loop time, null before the first loop", async () => {
    let last: Date | null = null;
    const h = startHealthServer({ port: 0, lastLoopAt: () => last });
    try {
      expect(await (await fetch(`http://localhost:${h.port}/health`)).json()).toEqual({ ok: true, lastLoopAt: null });
      last = new Date("2026-11-25T10:00:00.000Z");
      expect(await (await fetch(`http://localhost:${h.port}/health`)).json()).toEqual({ ok: true, lastLoopAt: "2026-11-25T10:00:00.000Z" });
      expect((await fetch(`http://localhost:${h.port}/other`)).status).toBe(404);
    } finally { h.stop(); }
  });
  test("port: AGENT_HEALTH_PORT, then PORT, else none", () => {
    expect(healthPort({ AGENT_HEALTH_PORT: "9000", PORT: "1" })).toBe(9000);
    expect(healthPort({ PORT: "8080" })).toBe(8080);
    expect(healthPort({})).toBeUndefined();
    expect(() => healthPort({ PORT: "abc" })).toThrow();
  });
});
