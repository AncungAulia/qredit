import { openEvmWindowMsg, type UnifiedAccount } from "@qorechain/sdk";
import { evmWindowStatus } from "@qorechain/evm";
import { broadcastHybrid, type Net, txEvents } from "./chain/tx.ts";

export type WindowOptions = { blocks: number; maxTxs: number; maxValue: bigint };
export interface WindowChain {
  status(address: string): Promise<{ blocks: number; txs: number }>;
  open(acc: UnifiedAccount, targets: string[], o: WindowOptions): Promise<string>;
}

export async function keepWindows(
  items: { account: UnifiedAccount; targets: string[] }[],
  chain: WindowChain,
  o: WindowOptions & { minBlocks: number; minTxs?: number },
): Promise<{ address: string; action: "kept" | "renewed" | "error"; tx?: string; error?: string }[]> {
  const out: { address: string; action: "kept" | "renewed" | "error"; tx?: string; error?: string }[] = [];
  for (const { account, targets } of items) {
    try {
      const s = await chain.status(account.cosmos);
      if (s.blocks >= o.minBlocks && s.txs >= (o.minTxs ?? 10)) {
        out.push({ address: account.cosmos, action: "kept" });
        continue;
      }
      out.push({ address: account.cosmos, action: "renewed", tx: await chain.open(account, targets, o) });
    } catch (e) {
      out.push({ address: account.cosmos, action: "error", error: (e as Error).message });
    }
  }
  return out;
}

export function sdkWindowChain(net: Net): WindowChain {
  return {
    async status(address) {
      const w = await evmWindowStatus({ rest: net.rest, address });
      if (!w.found || !w.live) return { blocks: 0, txs: 0 };
      return { blocks: Number(w.remainingBlocks), txs: Number(w.remainingTxs) };
    },
    async open(acc, targets, o) {
      const msg = openEvmWindowMsg({
        sender: acc.cosmos,
        blocks: BigInt(o.blocks),
        maxTxs: BigInt(o.maxTxs),
        maxValue: o.maxValue.toString(),
        allowedTargets: targets.map((t) => t.toLowerCase()),
      });
      const sent = await broadcastHybrid(net, acc, [msg], { memo: "qredit operator window" });
      if (sent.code !== 0) throw new Error(`window refused: code ${sent.code} ${sent.rawLog ?? ""}`);
      await txEvents(net.rest, sent.hash);
      return sent.hash;
    },
  };
}
