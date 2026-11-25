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

export async function GET(req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  const path = (await ctx.params).path.join("/");
  if (!isAllowedPath(path)) return Response.json({ error: "not found" }, { status: 404 });
  const query = new URL(req.url).search;
  const upstream = await fetch(`${REST}/${path}${query}`, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(15_000) });
  return new Response(upstream.body, {
    status: upstream.status,
    headers: { "content-type": upstream.headers.get("content-type") ?? "application/json", "cache-control": "public, max-age=5" },
  });
}
