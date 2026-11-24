import { createHash } from "node:crypto";
import type { UnifiedAccount } from "@qorechain/sdk";
import { broadcastHybrid, BroadcastRefused, BroadcastUnconfirmed, type Net, serial, TxFailedOnChain, txEvents } from "../chain/tx.ts";
import { FUSD_DENOM } from "../config.ts";
import type { Db } from "../db/client.ts";
import { cancelGrant, completeGrant, reserveGrant } from "../db/store/index.ts";

export class FaucetCooldown extends Error {
  constructor(readonly retryAt: Date) {
    super(`test funds were already sent to this address or network; try again after ${retryAt.toISOString()}`);
  }
}

export class FaucetCapReached extends Error {
  constructor() {
    super("the faucet has reached its daily limit; try again later");
  }
}

export const ipHasher = (salt: string) => (ip: string) => createHash("sha256").update(`${salt}|${ip}`).digest("hex");

export function createFaucet(deps: {
  db: Db;
  send: (address: string) => Promise<string>;
  cooldownHours: number;
  dailyCap: number;
  hashIp: (ip: string) => string;
  now?: () => Date;
}): (address: string, ip: string) => Promise<{ tx: string }> {
  const now = deps.now ?? (() => new Date());
  return async (address, ip) => {
    const ipHash = deps.hashIp(ip);
    // Reserve atomically (advisory lock + checks + insert in one transaction), then send.
    const slot = await deps.db.transaction((q) => reserveGrant(q, address, ipHash, deps.cooldownHours, now(), deps.dailyCap));
    if (!slot.ok) throw slot.reason === "cap" ? new FaucetCapReached() : new FaucetCooldown(slot.retryAt);
    let tx: string;
    try {
      tx = await deps.send(address);
    } catch (e) {
      // Release the slot only when nothing was broadcast. After that the coins may have left: never cancel.
      if (e instanceof BroadcastRefused) {
        await cancelGrant(deps.db, slot.id).catch((ce) => console.error("[faucet] could not cancel grant", slot.id, (ce as Error).message));
      } else if (e instanceof BroadcastUnconfirmed) {
        await completeGrant(deps.db, slot.id, e.hash).catch((ce) => console.error("[faucet] could not record tx for grant", slot.id, (ce as Error).message));
      }
      throw e; // unknown outcome without a hash: the reservation stays pending (it expires after PENDING_GRANT_TTL_MS)
    }
    // The coins are sent; a bookkeeping failure must not turn into a failed request or a cancelled grant.
    await completeGrant(deps.db, slot.id, tx).catch((ce) => console.error("[faucet] could not record tx for grant", slot.id, (ce as Error).message));
    return { tx };
  };
}

export type TreasuryChain = { broadcast: typeof broadcastHybrid; events: typeof txEvents };

/** One native MsgSend with test QOR and faucet fUSD (bank coin); coins sorted by denom. */
export function treasurySender(
  net: Net,
  treasury: UnifiedAccount,
  uqor: bigint,
  fusdUnits: bigint,
  chain: TreasuryChain = { broadcast: broadcastHybrid, events: txEvents },
): (address: string) => Promise<string> {
  const run = serial();
  return (address) =>
    run(async () => {
      const amount = [
        { denom: FUSD_DENOM, amount: fusdUnits.toString() },
        { denom: "uqor", amount: uqor.toString() },
      ].sort((a, b) => (a.denom < b.denom ? -1 : 1));
      const msg = { typeUrl: "/cosmos.bank.v1beta1.MsgSend", value: { fromAddress: treasury.cosmos, toAddress: address, amount } };
      // BroadcastRefused (pre-hash connect/sign failure) propagates as is.
      const sent = await chain.broadcast(net, treasury, [msg], { memo: "Qredit test funds", gas: "300000", feeUqor: "60000" });
      if (sent.code !== 0) throw new BroadcastRefused(`treasury send refused: code ${sent.code} ${sent.rawLog ?? ""}`);
      try {
        await chain.events(net.rest, sent.hash);
      } catch (e) {
        // Included but failed in execution: no coins moved. Anything else (timeout, REST down): outcome unknown.
        if (e instanceof TxFailedOnChain) throw new BroadcastRefused(e.message, { cause: e });
        throw new BroadcastUnconfirmed(sent.hash, e instanceof Error ? e.message : String(e));
      }
      return sent.hash;
    });
}
