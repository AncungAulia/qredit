import type { PublicClient } from "viem";
import { VAULT_EVENTS_V1 } from "@qredit/qore";
import type { Db } from "../db/client.ts";
import { applyVaultEvent, getWatchState, setWatchState, type VaultEvent } from "../db/store/index.ts";

export interface LogSource {
  latestBlock(): Promise<number>;
  events(vault: string, from: number, to: number): Promise<VaultEvent[]>;
}

/** Bring one vault's orders up to the chain head. Returns the last block scanned. */
export async function syncVault(db: Db, src: LogSource, vault: string, startBlock: number, maxRange = 2000): Promise<number> {
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
    const events = (await src.events(vault, from, to)).sort((a, b) => a.block - b.block || a.logIndex - b.logIndex);
    // Events of one range and the saved position commit together, or not at all.
    await db.transaction(async (q) => {
      for (const e of events) {
        if (!(await applyVaultEvent(q, e))) console.warn(`watcher: ignored ${e.kind} for order ${e.orderId} in block ${e.block} (duplicate or order not open)`);
      }
      await setWatchState(q, vault, to);
    });
    last = to;
    from = to + 1;
  }
  return last;
}

export function viemLogSource(client: PublicClient): LogSource {
  return {
    latestBlock: async () => Number(await client.getBlockNumber()),
    async events(vault, from, to) {
      const logs = await client.getLogs({ address: vault as `0x${string}`, events: VAULT_EVENTS_V1, fromBlock: BigInt(from), toBlock: BigInt(to) });
      const out: VaultEvent[] = [];
      for (const l of logs) {
        const base = { vault: vault.toLowerCase(), orderId: String(l.args.orderId), block: Number(l.blockNumber), logIndex: Number(l.logIndex), tx: l.transactionHash.toLowerCase() };
        switch (l.eventName) {
          case "OrderPlaced":
            out.push({ ...base, kind: "OrderPlaced", buyer: l.args.buyer!.toLowerCase(), serviceId: Number(l.args.serviceId), price: String(l.args.price), requestRef: l.args.requestRef!.toLowerCase(), deadline: Number(l.args.deadline) });
            break;
          case "Delivered":
            out.push({ ...base, kind: "Delivered", envelopeHash: l.args.envelopeHash!.toLowerCase() });
            break;
          case "Declined":
            out.push({ ...base, kind: "Declined" });
            break;
          case "Reclaimed":
            out.push({ ...base, kind: "Reclaimed" });
            break;
          default: {
            const unexpected: never = l;
            console.warn(`watcher: skipped unknown event ${String((unexpected as { eventName?: string }).eventName)} in block ${base.block}`);
          }
        }
      }
      return out;
    },
  };
}
