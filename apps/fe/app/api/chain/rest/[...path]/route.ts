const REST = (process.env.QORE_REST_URL ?? "https://api-testnet.qore.host").replace(/\/$/, "");

/** Read-only paths the SDK helpers request: fetchPqcStatus, fetchKemKey, evmWindowStatus, fetchSpendingRules, fetchAuthenticators, plus balances and accounts. */
export const ALLOWED_PREFIXES = [
  "qorechain/pqc/v1/account/",
  "qorechain/pqc/v1/kem/",
  "qorechain/pqc/v1/evm_window/",
  "qorechain/abstractaccount/v1/accounts/",
  "cosmos/bank/v1beta1/balances/",
  "cosmos/auth/v1beta1/accounts/",
] as const;

export const isAllowedPath = (p: string) => !p.includes("..") && ALLOWED_PREFIXES.some((x) => p.startsWith(x));

/** A segment is safe only when it cannot change the path or the query once placed in a URL. */
const isSafeSegment = (s: string) => s !== "" && s !== "." && s !== ".." && !/[%/\\?#]/.test(s);

/** Builds the upstream URL from decoded segments, or null when the request must be refused. */
function upstreamUrl(segments: string[], search: string): string | null {
  if (!segments.every(isSafeSegment)) return null;
  const base = new URL(REST);
  const url = new URL(segments.map(encodeURIComponent).join("/"), `${REST}/`);
  if (url.origin !== base.origin || !isAllowedPath(url.pathname.replace(/^\//, ""))) return null;
  return `${url.origin}${url.pathname}${search}`;
}

export async function GET(req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  const target = upstreamUrl((await ctx.params).path, new URL(req.url).search);
  if (!target) return Response.json({ error: "not found" }, { status: 404 });
  let upstream: Response;
  try {
    upstream = await fetch(target, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(15_000) });
  } catch {
    return Response.json({ error: "upstream unavailable" }, { status: 502 });
  }
  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      "content-type": upstream.headers.get("content-type") ?? "application/json",
      "cache-control": upstream.ok ? "public, max-age=5" : "no-store",
    },
  });
}
