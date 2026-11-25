import { matchList, type ListFile } from "./lists.ts";

export type Flagged = { listed: boolean; entry: string | null; list: string };
export type IndexerData = {
  address: { bech32: string; hex: string };
  exists: boolean;
  sequence: number;
  publicKeyType: string | null;
  isContract: boolean;
  pq: { registered: boolean; possessionProven: boolean; keyType: string | null; window: { live: boolean; allowedTargets: string[] } };
  flagged: Flagged;
};

/** Calls an MCP tool by its unprefixed name (`get_address_info`). */
export type CallTool = (name: string, args: Record<string, string>) => Promise<unknown>;

type Rec = Record<string, any>;

export function toIndexerData(info: Rec, pq: Rec, flagged: Flagged): IndexerData {
  return {
    address: { bech32: info.address.bech32, hex: String(info.address.hex).toLowerCase() },
    exists: Boolean(info.exists),
    sequence: Number(info.sequence ?? 0),
    publicKeyType: info.public_key_type ?? null,
    isContract: Boolean(info.is_contract),
    pq: {
      registered: Boolean(pq.registered),
      possessionProven: Boolean(pq.possession_proven),
      keyType: pq.key_type ?? null,
      window: { live: Boolean(pq.evm_window?.live), allowedTargets: pq.evm_window?.allowed_targets ?? [] },
    },
    flagged,
  };
}

/** The MCP server reports validation failures as `{ error: true }` instead of throwing; surface them as errors. */
function unwrap(name: string, out: unknown): Rec {
  const r = out as Rec | null;
  if (!r || typeof r !== "object" || r.error) throw new Error(`${name} failed: ${r?.message ?? "unavailable"}`);
  return r;
}

export function createIndexer(deps: { callTool: CallTool; flags: ListFile }) {
  return {
    async lookup(address: string): Promise<IndexerData> {
      const [info, pq] = await Promise.all([
        deps.callTool("get_address_info", { address }).then((o) => unwrap("get_address_info", o)),
        deps.callTool("get_pq_status", { target: address }).then((o) => unwrap("get_pq_status", o)),
      ]);
      const hit = matchList(deps.flags, [String(info.address.hex)]).matches[0];
      return toIndexerData(info, pq.address_status ?? {}, { listed: Boolean(hit), entry: hit?.entry ?? null, list: deps.flags.list });
    },
  };
}
