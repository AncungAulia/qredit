import { evmWindowStatus, type EvmWindow } from "@qorechain/evm";
import { signRecipientCard, toHex, type RecipientCard, type SealKeyPair } from "@qorechain/qoreseal";
import { fetchKemKey } from "@qorechain/qoreseal/network";
import {
  buildRegisterPqcKeyMsg, fetchPqcStatus, openEvmWindowMsg, pqcMsg, signProofOfPossession, type UnifiedAccount,
} from "@qorechain/sdk";
import { hex } from "@scure/base";
import { qorToHex } from "./address.ts";
import { convertCoinMsg, qoreRegistry } from "./erc20.ts";
import type { Net } from "./net.ts";
import { broadcastHybrid, txEvents, type Sent } from "./tx.ts";

export type Sleep = (ms: number) => Promise<void>;
export const defaultSleep: Sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Throws when the chain refused the tx, then waits until it is in a block. Returns the hash. */
export async function confirmed(net: Net, sent: Sent, what: string): Promise<string> {
  if (sent.code !== 0) throw new Error(`${what} refused: code ${sent.code} ${sent.rawLog ?? ""}`);
  await txEvents(net.rest, sent.hash);
  return sent.hash;
}

/** Register the account's ML-DSA-87 key (classical tx, once). Returns null if already registered. */
export async function registerPqcKey(net: Net, acc: UnifiedAccount): Promise<string | null> {
  if ((await fetchPqcStatus({ rest: net.rest, address: acc.cosmos })).registered) return null;
  const pop = signProofOfPossession({ chainId: net.chainId, account: acc.cosmos, keypair: acc.pqc });
  const msg = buildRegisterPqcKeyMsg(acc.cosmos, { pqcKeypair: acc.pqc, proofOfPossession: pop });
  return confirmed(net, await broadcastHybrid(net, acc, [msg], { memo: "register ML-DSA-87", signMode: "classical" }), "key registration");
}

/** Faucet fUSD (bank coin) to ERC-20 fUSD on the same account. */
export async function convertFusd(net: Net, acc: UnifiedAccount, units: bigint): Promise<string> {
  return confirmed(
    net,
    await broadcastHybrid(net, acc, [convertCoinMsg(acc.cosmos, acc.evm, units)], { memo: "convert fUSD", registry: qoreRegistry() }),
    "conversion",
  );
}

/** MsgRegisterKEMKey as a cosmjs message the SDK registry already encodes (qoreseal's own builder returns raw Any bytes, which broadcastHybrid cannot sign). */
export const registerKemKeyMsg = (sender: string, mlkemPublicKey: Uint8Array): ReturnType<typeof pqcMsg.registerKemKey> =>
  pqcMsg.registerKemKey({ sender, publicKey: mlkemPublicKey });

/** Register the ML-KEM key on the account unless the same key is already registered. Returns the tx hash or null. */
export async function registerKemKey(net: Net, acc: UnifiedAccount, mlkemPublicKey: Uint8Array): Promise<string | null> {
  const current = await fetchKemKey({ rest: net.rest, address: acc.cosmos });
  if (current.registered && current.publicKey && toHex(current.publicKey) === toHex(mlkemPublicKey)) return null;
  const sent = await broadcastHybrid(net, acc, [registerKemKeyMsg(acc.cosmos, mlkemPublicKey)], { memo: "qredit seal key" });
  if (sent.code !== 0) throw new Error(`KEM registration refused: code ${sent.code} ${sent.rawLog ?? ""}`);
  await txEvents(net.rest, sent.hash);
  return sent.hash;
}

const bytesOf = (value: string): Uint8Array => hex.decode(value.replace(/^0x/i, "").toLowerCase());

/** Sign the account's recipient card (binds the on-chain ML-KEM key to an X25519 key). */
export function signedCard(net: Net, acc: UnifiedAccount, keys: SealKeyPair): RecipientCard {
  return signRecipientCard({
    chainId: net.chainId,
    address: acc.cosmos,
    keys,
    classicalKey: { type: "eth_secp256k1", privateKey: bytesOf(acc.privateKey), publicKey: bytesOf(acc.publicKey) },
    pqKey: acc.pqc,
  });
}

export type WindowOptions = { blocks?: number; maxTxs?: number; maxValue?: bigint };
export type EnsureWindowOptions = WindowOptions & { minBlocks?: number; minTxs?: number };

/** Opens an EVM window, then waits one block (through `sleep`) so the next EVM tx lands after it. */
export async function openWindow(net: Net, acc: UnifiedAccount, targets: string[], o: WindowOptions = {}, sleep: Sleep = defaultSleep): Promise<string> {
  const msg = openEvmWindowMsg({
    sender: acc.cosmos,
    blocks: BigInt(o.blocks ?? 17_280),
    maxTxs: BigInt(o.maxTxs ?? 500),
    maxValue: (o.maxValue ?? 25_000_000n).toString(),
    allowedTargets: targets.map((t) => t.toLowerCase()),
  });
  const tx = await confirmed(net, await broadcastHybrid(net, acc, [msg], { memo: "qredit window" }), "window");
  await sleep(10_000); // the next EVM tx must land after the window's block
  return tx;
}

type WindowDeps = {
  status: (acc: UnifiedAccount) => Promise<EvmWindow>;
  open: (net: Net, acc: UnifiedAccount, targets: string[], o: WindowOptions, sleep: Sleep) => Promise<string>;
  sleep: Sleep;
};

/** Targets of windows this process opened: used only if the chain does not report a window's allowed targets. */
const openedHere = new Map<string, Set<string>>();

const targetKey = (t: string): string => (t.startsWith("qor1") ? qorToHex(t) ?? t : t).toLowerCase();

/** True when the window is live, allows every target and has at least `min.blocks` blocks and `min.txs` txs left. */
export function windowCovers(w: EvmWindow, targets: string[], min: { blocks: number; txs: number }, openedByUs?: Set<string>): boolean {
  if (!w.found || !w.live || w.nativeOnly) return false;
  if (w.remainingBlocks < BigInt(min.blocks) || w.remainingTxs < BigInt(min.txs)) return false;
  const wanted = targets.map(targetKey);
  // an empty reported list means "any target"; an unreported list is trusted only for windows this run opened
  const allowed = Array.isArray(w.allowedTargets)
    ? (w.allowedTargets.length ? new Set(w.allowedTargets.map(targetKey)) : null)
    : (openedByUs ?? new Set<string>());
  return allowed === null || wanted.every((t) => allowed.has(t));
}

/**
 * Open an EVM window only when the current one cannot carry the upcoming txs (see windowCovers); opening replaces the old one.
 * Returns the open tx hash, or null when the live window was reused.
 */
export async function ensureWindow(
  net: Net, acc: UnifiedAccount, targets: string[], opts: EnsureWindowOptions = {}, deps: Partial<WindowDeps> = {},
): Promise<string | null> {
  const { minBlocks = 600, minTxs = 5, ...open } = opts;
  const status = deps.status ?? ((a: UnifiedAccount) => evmWindowStatus({ rest: net.rest, address: a.cosmos }));
  const opener = deps.open ?? openWindow;
  const sleep = deps.sleep ?? defaultSleep;
  // The chain refuses a window that lists a target twice; callers may pass overlapping lists.
  const unique = [...new Set(targets.map(targetKey))];
  if (windowCovers(await status(acc), unique, { blocks: minBlocks, txs: minTxs }, openedHere.get(acc.cosmos))) return null;
  const tx = await opener(net, acc, unique, open, sleep);
  openedHere.set(acc.cosmos, new Set(unique));
  return tx;
}

/** A short window with few txs and a small value cap: enough for one buyer's or lender's actions. */
export const BUYER_WINDOW: WindowOptions = { blocks: 3600, maxTxs: 40, maxValue: 60_000_000n };
