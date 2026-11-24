import type { PublicClient } from "viem";
import { VAULT_EVENTS } from "./chain/vault.ts";
import type { Db } from "./db.ts";
import { applyVaultEvent, getWatchState, setWatchState, type VaultEvent } from "./store.ts";

export interface LogSource {
  latestBlock(): Promise<number>;
  events(vault: string, from: number, to: number): Promise<VaultEvent[]>;
}

/** Bring one vault's orders up to the chain head. Returns the last block scanned. */
export async function syncVault(db: Db, src: LogSource, vault: string, startBlock: number, maxRange = 2000): Promise<number> {
  const saved = await getWatchState(db, vault);
  let from = saved === null ? startBlock : saved + 1;
  const head = await src.latestBlock();
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
      const logs = await client.getLogs({ address: vault as `0x${string}`, events: VAULT_EVENTS, fromBlock: BigInt(from), toBlock: BigInt(to) });
      return logs.map((l): VaultEvent => {
        const base = { vault: vault.toLowerCase(), orderId: String(l.args.orderId), block: Number(l.blockNumber), logIndex: Number(l.logIndex), tx: l.transactionHash.toLowerCase() };
        switch (l.eventName) {
          case "OrderPlaced":
            return { ...base, kind: "OrderPlaced", buyer: l.args.buyer!.toLowerCase(), serviceId: Number(l.args.serviceId), price: String(l.args.price), requestRef: l.args.requestRef!.toLowerCase(), deadline: Number(l.args.deadline) };
          case "Delivered":
            return { ...base, kind: "Delivered", envelopeHash: l.args.envelopeHash!.toLowerCase() };
          case "Declined":
            return { ...base, kind: "Declined" };
          default:
            return { ...base, kind: "Reclaimed" };
        }
      });
    },
  };
}
