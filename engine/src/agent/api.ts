import type { Order } from "./types.ts";

// Copied from apps/be/src/services/relayer.ts (the engine never imports apps/be at runtime); keep in sync.
export type RelayRequest = {
  typeUrl: string;
  value: {
    relayer: string; account: string; scheme: string;
    pubkey: string; signature: string; // base64
    to: string; value: string;
    data: string; // base64 calldata
    gasLimit: string; nonce: string;
  };
};
export type RelayFailureCode = "not_broadcast" | "refused" | "unconfirmed" | "execution_failed";
export type RelayResult = { txHash: string; success: true } | { txHash: string; success: false; code: RelayFailureCode; reason: string };

export class ApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = "ApiError";
  }
}

export type Decision = {
  vault: string; orderId: string;
  decision: "accepted" | "declined" | "delivered" | "failed";
  reason: string; suppliers: unknown[]; cost: bigint;
};

export function createApi(o: { url: string; token: string; fetch?: typeof fetch; timeoutMs?: number }) {
  const doFetch = o.fetch ?? fetch;
  const base = o.url.replace(/\/+$/, "");

  async function request(method: "GET" | "POST", path: string, body?: unknown, allow404 = false): Promise<unknown | null> {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(new Error(`request timed out: ${method} ${path}`)), o.timeoutMs ?? 30_000);
    let res: Response;
    let text: string;
    try {
      res = await doFetch(`${base}${path}`, {
        method,
        headers: { authorization: `Bearer ${o.token}`, ...(body === undefined ? {} : { "content-type": "application/json" }) },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: ctl.signal,
      });
      text = await res.text();
    } finally {
      clearTimeout(timer);
    }
    if (res.status === 404 && allow404) return null;
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      /* non-JSON body */
    }
    if (!res.ok) {
      const err = (json as { error?: unknown } | null)?.error;
      throw new ApiError(res.status, typeof err === "string" ? err : text || `HTTP ${res.status}`);
    }
    return json;
  }

  return {
    async claim(vaults: string[]): Promise<Order | null> {
      const r = (await request("POST", "/v1/orders/claim", { vaults })) as { order: Order | null };
      return r.order ?? null;
    },
    async envelope(hash: string): Promise<string | null> {
      const r = (await request("GET", `/v1/envelopes/${hash}`, undefined, true)) as { body: string } | null;
      return r === null ? null : r.body;
    },
    async putReport(body: string): Promise<string> {
      return ((await request("POST", "/v1/envelopes", { kind: "report", body })) as { hash: string }).hash;
    },
    async decision(d: Decision): Promise<void> {
      await request("POST", "/v1/decisions", { ...d, cost: d.cost.toString() });
    },
    async card(qorAddress: string): Promise<unknown | null> {
      const r = (await request("GET", `/v1/cards/${qorAddress}`, undefined, true)) as { card: unknown } | null;
      return r === null ? null : r.card;
    },
    async relay(r: RelayRequest): Promise<RelayResult> {
      return (await request("POST", "/v1/relay", r)) as RelayResult;
    },
    async relayer(): Promise<string> {
      return ((await request("GET", "/v1/relayer")) as { address: string }).address;
    },
  };
}
export type Api = ReturnType<typeof createApi>;
