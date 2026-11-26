import type { PublicClient } from "viem";
import { VAULT_EVENTS, VAULT_EVENTS_V1, type VaultVersion } from "@qredit/qore";
import type { Db } from "../db/client.ts";
import { applyVaultEvent, type Ended, getWatchState, setWatchState, type VaultEvent } from "../db/store/index.ts";

export interface LogSource {
  latestBlock(): Promise<number>;
  events(vault: string, from: number, to: number, version: VaultVersion): Promise<VaultEvent[]>;
}

/** Bring one vault's orders up to the chain head, decoding the events of the vault's own version. Returns the last block scanned. */
export async function syncVault(db: Db, src: LogSource, vault: string, startBlock: number, version: VaultVersion, maxRange = 2000): Promise<number> {
  const saved = await getWatchState(db, vault);
  let from = saved === null ? startBlock : saved + 1;
  const head = await src.latestBlock();
  if (saved !== null && saved > head) {
    console.warn(`watcher: saved block ${saved} is ahead of chain head ${head} for ${vault}; skipping (chain reset or wrong node?)`);
    return saved;
  }
  let last = from - 1;
  while (from <= head) {
    const to = Math.min(head, from + maxRange - 1);
    const events = (await src.events(vault, from, to, version)).sort((a, b) => a.block - b.block || a.logIndex - b.logIndex);
    // Events of one range and the saved position commit together, or not at all.
    await db.transaction(async (q) => {
      for (const e of events) {
        if (!(await applyVaultEvent(q, e))) {
          console.warn(`watcher: ignored ${e.kind} for ${"orderId" in e ? `order ${e.orderId}` : "vault"} in block ${e.block} (duplicate or did not fit the state)`);
        }
      }
      await setWatchState(q, vault, to);
    });
    last = to;
    from = to + 1;
  }
  return last;
}

/** A decoded log as viem returns it, loosely typed so one mapper serves both vault versions. */
export type RawLog = { eventName: string; args: Record<string, unknown>; blockNumber: bigint | null; logIndex: number | null; transactionHash: string | null };

const ENDED: Record<number, Ended> = { 1: "defaulted", 2: "closed" };

/** Maps one decoded vault log to a watcher event; null for an event the watcher does not keep. */
export function toVaultEvent(vault: string, version: VaultVersion, l: RawLog): VaultEvent | null {
  const base = { vault: vault.toLowerCase(), block: Number(l.blockNumber), logIndex: Number(l.logIndex), tx: String(l.transactionHash).toLowerCase() };
  const a = l.args;
  const order = { ...base, orderId: String(a.orderId) };
  switch (l.eventName) {
    case "OrderPlaced":
      return {
        ...order, kind: "OrderPlaced", buyer: String(a.buyer).toLowerCase(), serviceId: Number(a.serviceId), price: String(a.price),
        requestRef: String(a.requestRef).toLowerCase(), deadline: Number(a.deadline),
      };
    case "Delivered":
      return { ...order, kind: "Delivered", envelopeHash: String(a.envelopeHash).toLowerCase(), reviewEnds: version === 1 ? null : Number(a.reviewEnds) };
    case "Settled":
      return { ...order, kind: "Settled" };
    case "Rejected":
      return { ...order, kind: "Rejected", refund: String(a.refund) };
    case "Declined":
    case "Reclaimed":
      return { ...order, kind: l.eventName };
    case "LoanEnded": {
      const ended = ENDED[Number(a.kind)];
      return ended ? { ...base, kind: "LoanEnded", ended } : null;
    }
    case "AgentRotated":
      return { ...base, kind: "AgentRotated", spender: String(a.spender).toLowerCase(), operator: String(a.operator).toLowerCase() };
    default:
      return null;
  }
}

export function viemLogSource(client: PublicClient): LogSource {
  return {
    latestBlock: async () => Number(await client.getBlockNumber()),
    async events(vault, from, to, version) {
      const range = { address: vault as `0x${string}`, fromBlock: BigInt(from), toBlock: BigInt(to) };
      const logs = version === 1
        ? await client.getLogs({ ...range, events: VAULT_EVENTS_V1 })
        : await client.getLogs({ ...range, events: VAULT_EVENTS });
      const out: VaultEvent[] = [];
      for (const l of logs as unknown as RawLog[]) {
        const e = toVaultEvent(vault, version, l);
        if (e) out.push(e);
        else console.warn(`watcher: skipped ${l.eventName} in block ${Number(l.blockNumber)}`);
      }
      return out;
    },
  };
}
