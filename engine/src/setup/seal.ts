import { randomBytes } from "node:crypto";
import { signRecipientCard, toHex, type SealKeyPair } from "@qorechain/qoreseal";
import { fetchKemKey } from "@qorechain/qoreseal/network";
import { pqcMsg, type UnifiedAccount } from "@qorechain/sdk";
import { broadcastHybrid, TESTNET, txEvents } from "@qredit/qore";
import type { Keystore } from "../keystore.ts";

export function ensureSealSeed(ks: Keystore, slug: string): boolean {
  if (ks.has(`${slug}-seal`)) return false;
  ks.write(`${slug}-seal`, { seed: randomBytes(32).toString("hex") });
  return true;
}

const bytesOf = (hex: string): Uint8Array => Uint8Array.from(Buffer.from(hex.replace(/^0x/, ""), "hex"));

/** MsgRegisterKEMKey as a cosmjs message the SDK registry already encodes (qoreseal's own builder returns raw Any bytes, which broadcastHybrid cannot sign). */
export const registerKemKeyMsg = (sender: string, mlkemPublicKey: Uint8Array): ReturnType<typeof pqcMsg.registerKemKey> => pqcMsg.registerKemKey({ sender, publicKey: mlkemPublicKey });

/** Register the seal ML-KEM key on the spender unless the same key is already registered. Returns the tx hash or null. */
export async function registerSealKey(spender: UnifiedAccount, mlkemPublicKey: Uint8Array): Promise<string | null> {
  const current = await fetchKemKey({ rest: TESTNET.rest, address: spender.cosmos });
  if (current.registered && current.publicKey && toHex(current.publicKey) === toHex(mlkemPublicKey)) return null;
  const sent = await broadcastHybrid(TESTNET, spender, [registerKemKeyMsg(spender.cosmos, mlkemPublicKey)], { memo: "qredit seal key" });
  if (sent.code !== 0) throw new Error(`KEM registration refused: code ${sent.code} ${sent.rawLog ?? ""}`);
  await txEvents(TESTNET.rest, sent.hash);
  return sent.hash;
}

/** Sign the spender's recipient card (binds the on-chain ML-KEM key to an X25519 key) and upload it. */
export async function publishCard(apiUrl: string, spender: UnifiedAccount, keys: SealKeyPair): Promise<void> {
  const card = signRecipientCard({
    chainId: TESTNET.chainId,
    address: spender.cosmos,
    keys,
    classicalKey: { type: "eth_secp256k1", privateKey: bytesOf(spender.privateKey), publicKey: bytesOf(spender.publicKey) },
    pqKey: spender.pqc,
  });
  const r = await fetch(`${apiUrl}/v1/cards/${spender.cosmos}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ card }), signal: AbortSignal.timeout(20_000) });
  if (r.status !== 204) throw new Error(`card upload failed: HTTP ${r.status} ${await r.text()}`);
}
