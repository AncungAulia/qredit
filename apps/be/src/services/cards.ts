import { isQoreSealError, verifyRecipientCard, type RecipientCard } from "@qorechain/qoreseal";
import { fetchMlkemPublicKey } from "@qorechain/qoreseal/network";
import { fetchPqcStatus } from "@qorechain/sdk";
import type { Net } from "@qredit/qore";
import { memoizeAsync } from "../lib/ttl-cache.ts";

export type CardVerdict = { ok: true } | { ok: false; reason: "mismatch" | "unavailable" };
export type ChainKeys = { mlkem: Uint8Array; pq: Uint8Array };

/** The account has no (usable) keys on chain: a definitive answer, so it is never cached. */
export class KeysNotRegistered extends Error {}
/** The chain could not be asked (network, RPC, REST): says nothing about the card. */
export class ChainUnavailable extends Error {}

export const KEY_CACHE_TTL_MS = 60_000;

const bytes = (k: string | Uint8Array): Uint8Array =>
  typeof k === "string" ? Uint8Array.from(Buffer.from(k.replace(/^0x/, ""), /^(0x)?[0-9a-fA-F]+$/.test(k) ? "hex" : "base64")) : k;

/** Reads the account's on-chain ML-KEM-1024 and ML-DSA-87 keys. Throws KeysNotRegistered or ChainUnavailable. */
export function fetchChainKeys(net: Net): (address: string) => Promise<ChainKeys> {
  return async (address) => {
    let mlkem: Uint8Array;
    try {
      mlkem = await fetchMlkemPublicKey({ rest: net.rest, address });
    } catch (e) {
      if (isQoreSealError(e) && (e.code === "NETWORK_UNAVAILABLE" || e.code === "KEM_REGISTRY_UNAVAILABLE")) throw new ChainUnavailable(e.message);
      throw new KeysNotRegistered(e instanceof Error ? e.message : "no ML-KEM key");
    }
    let pqc: Awaited<ReturnType<typeof fetchPqcStatus>>;
    try {
      pqc = await fetchPqcStatus({ rest: net.rest, address });
    } catch (e) {
      throw new ChainUnavailable(e instanceof Error ? e.message : "PQC status unavailable");
    }
    if (!pqc.registered || !pqc.pubkey) throw new KeysNotRegistered("no ML-DSA key");
    return { mlkem, pq: bytes(pqc.pubkey) };
  };
}

type CardVerifierDeps = {
  chainId: string;
  fetchKeys: (address: string) => Promise<ChainKeys>;
  verify?: (o: { card: RecipientCard; chainId: string; address: string; mlkemPublicKey: Uint8Array; pqPublicKey: Uint8Array }) => unknown;
  now?: () => number;
  ttlMs?: number;
};

/** A card is accepted only if it binds the account's on-chain keys. Keys are cached per address for 60 s. */
export function createCardVerifier(deps: CardVerifierDeps): (address: string, card: unknown) => Promise<CardVerdict> {
  const verify = deps.verify ?? verifyRecipientCard;
  const keys = memoizeAsync(deps.fetchKeys, { ttlMs: deps.ttlMs ?? KEY_CACHE_TTL_MS, now: deps.now });
  return async (address, card) => {
    let k: ChainKeys;
    try {
      k = await keys(address);
    } catch (e) {
      return { ok: false, reason: e instanceof KeysNotRegistered ? "mismatch" : "unavailable" };
    }
    try {
      verify({ card: card as RecipientCard, chainId: deps.chainId, address, mlkemPublicKey: k.mlkem, pqPublicKey: k.pq });
      return { ok: true };
    } catch {
      return { ok: false, reason: "mismatch" };
    }
  };
}

export const chainCardVerifier = (net: Net) => createCardVerifier({ chainId: net.chainId, fetchKeys: fetchChainKeys(net) });
