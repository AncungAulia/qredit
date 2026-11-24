import { verifyRecipientCard, type RecipientCard } from "@qorechain/qoreseal";
import { fetchMlkemPublicKey } from "@qorechain/qoreseal/network";
import { fetchPqcStatus } from "@qorechain/sdk";
import type { Net } from "./chain/tx.ts";

const bytes = (k: string | Uint8Array): Uint8Array =>
  typeof k === "string" ? Uint8Array.from(Buffer.from(k.replace(/^0x/, ""), /^(0x)?[0-9a-fA-F]+$/.test(k) ? "hex" : "base64")) : k;

/** A card is accepted only if it binds the account's on-chain ML-KEM-1024 and ML-DSA-87 keys. */
export function chainCardVerifier(net: Net): (address: string, card: unknown) => Promise<boolean> {
  return async (address, card) => {
    try {
      const mlkemPublicKey = await fetchMlkemPublicKey({ rest: net.rest, address });
      const pqc = await fetchPqcStatus({ rest: net.rest, address });
      if (!pqc.registered || !pqc.pubkey) return false;
      verifyRecipientCard({ card: card as RecipientCard, chainId: net.chainId, address, mlkemPublicKey, pqPublicKey: bytes(pqc.pubkey) });
      return true;
    } catch {
      return false;
    }
  };
}
