const RPC = (process.env.QORE_RPC_URL ?? "https://rpc-testnet.qore.host").replace(/\/$/, "");
const MAX_BODY_BYTES = 64 * 1024;

/** CometBFT methods the in-browser transaction flow calls. Anything else is refused. */
export const RPC_METHODS = ["status", "broadcast_tx_sync", "tx_search"] as const;

const refuse = (error: string) => Response.json({ error }, { status: 400, headers: { "cache-control": "no-store" } });

export async function POST(req: Request) {
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > MAX_BODY_BYTES) return refuse("body too large");
  const text = await req.text();
  if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) return refuse("body too large");

  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return refuse("invalid JSON");
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) return refuse("expected one JSON-RPC request");
  const method = (body as { method?: unknown }).method;
  if (typeof method !== "string" || !(RPC_METHODS as readonly string[]).includes(method)) return refuse("method not allowed");

  let upstream: Response;
  try {
    upstream = await fetch(RPC, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: text,
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    return Response.json({ error: "upstream unavailable" }, { status: 502, headers: { "cache-control": "no-store" } });
  }
  return new Response(upstream.body, {
    status: upstream.status,
    headers: { "content-type": upstream.headers.get("content-type") ?? "application/json", "cache-control": "no-store" },
  });
}
