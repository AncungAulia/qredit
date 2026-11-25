const RPC = (process.env.QORE_RPC_URL ?? "https://rpc-testnet.qore.host").replace(/\/$/, "");
const MAX_BODY_BYTES = 64 * 1024;
const MAX_PER_PAGE = 10;
const HEADERS = { "cache-control": "no-store" };

/** CometBFT methods the in-browser transaction flow calls. Anything else is refused. */
export const RPC_METHODS = ["status", "broadcast_tx_sync", "tx_search"] as const;

const refuse = (error: string, status = 400) => Response.json({ error }, { status, headers: HEADERS });

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Reads the body as a stream and gives up once the cap is passed. Returns null when it is too large. */
async function readCapped(req: Request): Promise<string | null> {
  if (!req.body) return "";
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const all = new Uint8Array(size);
  let offset = 0;
  for (const c of chunks) {
    all.set(c, offset);
    offset += c.byteLength;
  }
  return new TextDecoder().decode(all);
}

/** The SDK polls a transaction by hash with exactly this query; nothing else is searched. */
const isHashQuery = (q: unknown) => typeof q === "string" && /^tx\.hash='[0-9a-fA-F]{64}'$/.test(q);

function txSearchAllowed(params: unknown): boolean {
  if (!isRecord(params) || !isHashQuery(params.query)) return false;
  const perPage = params.per_page;
  if (perPage === undefined) return true;
  const n = Number(perPage);
  return Number.isInteger(n) && n >= 1 && n <= MAX_PER_PAGE;
}

export async function POST(req: Request) {
  if (Number(req.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) return refuse("body too large", 413);
  const text = await readCapped(req);
  if (text === null) return refuse("body too large", 413);

  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return refuse("invalid JSON");
  }
  if (!isRecord(body)) return refuse("expected one JSON-RPC request");
  const { method, params } = body;
  if (typeof method !== "string" || !(RPC_METHODS as readonly string[]).includes(method)) return refuse("method not allowed");
  if (params !== undefined && params !== null && typeof params !== "object") return refuse("params must be an object or an array");
  if (method === "tx_search" && !txSearchAllowed(params)) return refuse("query not allowed");

  // Forward a rebuilt request: unknown top-level keys never reach the node.
  const forwarded = JSON.stringify({ jsonrpc: "2.0", id: body.id ?? null, method, params: params ?? {} });

  let upstream: Response;
  try {
    upstream = await fetch(RPC, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: forwarded,
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    });
  } catch (e) {
    const name = (e as { name?: unknown } | null)?.name;
    const timedOut = name === "TimeoutError" || name === "AbortError";
    return refuse(timedOut ? "upstream timed out" : "upstream unavailable", timedOut ? 504 : 502);
  }
  return new Response(upstream.body, {
    status: upstream.status,
    headers: { "content-type": upstream.headers.get("content-type") ?? "application/json", ...HEADERS },
  });
}
