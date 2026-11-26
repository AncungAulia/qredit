import { randomBytes } from "node:crypto";
import type { SealKeyPair } from "@qorechain/qoreseal";
import type { UnifiedAccount } from "@qorechain/sdk";
import { registerKemKey, signedCard, TESTNET } from "@qredit/qore";
import type { Keystore } from "../keystore.ts";

export function ensureSealSeed(ks: Keystore, slug: string): boolean {
  if (ks.has(`${slug}-seal`)) return false;
  ks.write(`${slug}-seal`, { seed: randomBytes(32).toString("hex") });
  return true;
}

/** Register the seal ML-KEM key on the spender unless the same key is already registered. Returns the tx hash or null. */
export const registerSealKey = (spender: UnifiedAccount, mlkemPublicKey: Uint8Array): Promise<string | null> => registerKemKey(TESTNET, spender, mlkemPublicKey);

/** Sign the spender's recipient card and upload it. */
export async function publishCard(apiUrl: string, spender: UnifiedAccount, keys: SealKeyPair): Promise<void> {
  const card = signedCard(TESTNET, spender, keys);
  const r = await fetch(`${apiUrl}/v1/cards/${spender.cosmos}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ card }), signal: AbortSignal.timeout(20_000) });
  if (r.status !== 204) throw new Error(`card upload failed: HTTP ${r.status} ${await r.text()}`);
}
