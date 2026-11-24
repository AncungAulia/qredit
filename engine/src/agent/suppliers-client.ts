import type { SupplierRole } from "../setup/businesses.ts";

const DEFAULT_POLL_MS = 3000;
const DEFAULT_MAX_WAIT_MS = 60_000;

export type SuppliersClient = {
  /** 200 -> data; 402 -> null (unpaid); anything else throws. */
  get(role: SupplierRole, vault: string, orderId: string, query: Record<string, string>): Promise<unknown | null>;
  /** Polls get() until it returns data or maxWaitMs passes; throws on timeout. */
  waitFor(role: SupplierRole, vault: string, orderId: string, query: Record<string, string>): Promise<unknown>;
};

export function createSuppliersClient(o: {
  url: string; fetch?: typeof fetch; pollMs?: number; maxWaitMs?: number; sleep?: (ms: number) => Promise<void>;
}): SuppliersClient {
  const doFetch = o.fetch ?? fetch;
  const base = o.url.replace(/\/+$/, "");
  const pollMs = o.pollMs ?? DEFAULT_POLL_MS;
  const maxWaitMs = o.maxWaitMs ?? DEFAULT_MAX_WAIT_MS;
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  const get: SuppliersClient["get"] = async (role, vault, orderId, query) => {
    const qs = new URLSearchParams({ vault, orderId, ...query });
    const res = await doFetch(`${base}/v1/${role}?${qs}`);
    if (res.status === 402) return null;
    if (res.status !== 200) throw new Error(`supplier ${role} answered HTTP ${res.status}`);
    return ((await res.json()) as { data: unknown }).data;
  };

  return {
    get,
    async waitFor(role, vault, orderId, query) {
      let waited = 0;
      for (;;) {
        const data = await get(role, vault, orderId, query);
        if (data !== null) return data;
        if (waited >= maxWaitMs) throw new Error(`supplier ${role} did not confirm payment within ${maxWaitMs} ms`);
        await sleep(pollMs);
        waited += pollMs;
      }
    },
  };
}
