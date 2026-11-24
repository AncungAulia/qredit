import { createHash } from "node:crypto";
import type { UnifiedAccount } from "@qorechain/sdk";
import { broadcastHybrid, type Net, serial, txEvents } from "./chain/tx.ts";
import { FUSD_DENOM } from "./config.ts";
import type { Db } from "./db.ts";
import { cancelGrant, completeGrant, reserveGrant } from "./store.ts";

export class FaucetCooldown extends Error {
  constructor(readonly retryAt: Date) {
    super(`test funds were already sent to this address or network; try again after ${retryAt.toISOString()}`);
  }
}

export const ipHasher = (salt: string) => (ip: string) => createHash("sha256").update(`${salt}|${ip}`).digest("hex");

export function createFaucet(deps: {
  db: Db;
  send: (address: string) => Promise<string>;
  cooldownHours: number;
  hashIp: (ip: string) => string;
  now?: () => Date;
}): (address: string, ip: string) => Promise<{ tx: string }> {
  const now = deps.now ?? (() => new Date());
  return async (address, ip) => {
    const ipHash = deps.hashIp(ip);
    // Reserve atomically (advisory lock + check + insert in one transaction), then send.
    const slot = await deps.db.transaction((q) => reserveGrant(q, address, ipHash, deps.cooldownHours, now()));
    if (!slot.ok) throw new FaucetCooldown(slot.retryAt);
    try {
      const tx = await deps.send(address);
      await completeGrant(deps.db, slot.id, tx);
      return { tx };
    } catch (e) {
      await cancelGrant(deps.db, slot.id);
      throw e;
    }
  };
}

/** One native MsgSend with test QOR and faucet fUSD (bank coin); coins sorted by denom. */
export function treasurySender(net: Net, treasury: UnifiedAccount, uqor: bigint, fusdUnits: bigint): (address: string) => Promise<string> {
  const run = serial();
  return (address) =>
    run(async () => {
      const amount = [
        { denom: FUSD_DENOM, amount: fusdUnits.toString() },
        { denom: "uqor", amount: uqor.toString() },
      ].sort((a, b) => (a.denom < b.denom ? -1 : 1));
      const msg = { typeUrl: "/cosmos.bank.v1beta1.MsgSend", value: { fromAddress: treasury.cosmos, toAddress: address, amount } };
      const sent = await broadcastHybrid(net, treasury, [msg], { memo: "Qredit test funds", gas: "300000", feeUqor: "60000" });
      if (sent.code !== 0) throw new Error(`treasury send refused: code ${sent.code} ${sent.rawLog ?? ""}`);
      await txEvents(net.rest, sent.hash);
      return sent.hash;
    });
}
