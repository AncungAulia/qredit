/** Tiny liveness endpoint for the agent runner: GET /health -> {"ok":true,"lastLoopAt":<iso|null>}. */
export function healthResponse(lastLoopAt: Date | null): Response {
  return Response.json({ ok: true, lastLoopAt: lastLoopAt ? lastLoopAt.toISOString() : null });
}

export function startHealthServer(o: { port: number; lastLoopAt: () => Date | null }): { port: number; stop: () => void } {
  const server = Bun.serve({
    hostname: "::",
    port: o.port,
    fetch: (req) => {
      const { pathname } = new URL(req.url);
      return req.method === "GET" && pathname === "/health" ? healthResponse(o.lastLoopAt()) : new Response("not found", { status: 404 });
    },
  });
  return { port: server.port as number, stop: () => void server.stop(true) };
}

/** AGENT_HEALTH_PORT wins, then the platform's PORT; undefined means no health server. */
export function healthPort(env: Record<string, string | undefined> = process.env): number | undefined {
  const raw = env.AGENT_HEALTH_PORT ?? env.PORT;
  if (raw === undefined || raw === "") return undefined;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0 || n > 65535) throw new Error("AGENT_HEALTH_PORT/PORT must be a port number");
  return n;
}
