import type { Hono } from "hono";

export function healthRoutes(app: Hono, deps: { relayerAddress: string }): void {
  app.get("/health", (c) => c.json({ ok: true }));
  app.get("/v1/relayer", (c) => c.json({ address: deps.relayerAddress }));
}
