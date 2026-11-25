// The one interface pages use to act on chain. It hides which wallet acts: QoreX cannot send EVM
// transactions, so every EVM send comes from the test wallet (also when QoreX is connected).
import { BUYER_WINDOW, ensureWindow, walletFor } from "@qredit/qore";
import { keccak256, type TransactionReceipt } from "viem";
import { revertSentence } from "@/components/shared/vaultErrors";
import { publicClient } from "@/lib/chain";
import { env } from "@/lib/env";
import { browserNet } from "@/lib/net";
import type { TestSession, WalletSession } from "@/modules/wallet/session";

type Hex = `0x${string}`;

/** A confirmed transaction: its hash and the receipt that proved it. */
export type SentTx = { hash: Hex; receipt: TransactionReceipt };

/**
 * Signs and sends from the test wallet. These calls are NOT locked: run them inside `act` or `withAccountLock`, so two
 * actions of one account never read the same nonce.
 */
export type EvmSigner = {
  address: Hex;
  /** Simulates, signs, sends, waits for the receipt. Throws TxReverted with a decoded reason. Returns the hash. */
  send(to: Hex, data: Hex): Promise<Hex>;
  /** Same as `send`, and also returns the receipt (its logs), so the caller needs no second lookup. */
  sendForReceipt(to: Hex, data: Hex): Promise<SentTx>;
};

/** The call or the receipt shows the chain refused the transaction; `reason` is a formal sentence. */
export class TxReverted extends Error {
  constructor(
    readonly hash: `0x${string}` | null,
    readonly reason: string,
  ) {
    super(reason);
    this.name = "TxReverted";
  }
}

/** The transaction could not be sent or confirmed (fee, node, timeout); `hash` is set once it was sent. */
export class TxFailed extends Error {
  constructor(
    readonly hash: `0x${string}` | null,
    readonly reason: string,
  ) {
    super(reason);
    this.name = "TxFailed";
  }
}

const SEND_FAILED = "The transaction could not be sent.";
const SENT_UNKNOWN = "The transaction may have been sent, but the network did not answer in time. Check it before trying again.";

function sendSentence(e: unknown): string {
  const text = e instanceof Error ? `${e.message} ${(e as { shortMessage?: string }).shortMessage ?? ""}` : "";
  if (/insufficient funds/i.test(text)) return "The wallet has too little QOR to pay the network fee.";
  if (/user (rejected|denied)|rejected the request/i.test(text)) return "The transaction was declined in the wallet.";
  return SEND_FAILED;
}

const isTimeout = (e: unknown) => e instanceof Error && /Timeout/i.test(e.name);

// One queue per address: two jobs of the same account never run together, so they never read the same nonce or sequence.
const queues = new Map<string, Promise<unknown>>();

/** Runs `job` once every earlier job of this address has finished, success or failure; the lock is released when `job` settles. */
export function withAccountLock<T>(address: string, job: () => Promise<T>): Promise<T> {
  const key = address.toLowerCase();
  const run = (queues.get(key) ?? Promise.resolve()).catch(() => undefined).then(job);
  queues.set(key, run);
  return run;
}

/** The test wallet behind a session, if any. */
export function testWalletOf(session: WalletSession): TestSession | null {
  if (session.kind === "test") return session;
  if (session.kind === "qorex") return session.testWallet;
  return null;
}

export function evmSignerFor(session: WalletSession): EvmSigner | null {
  const wallet = testWalletOf(session);
  if (!wallet) return null;
  const address = wallet.evm as Hex;
  const sendForReceipt = async (to: Hex, data: Hex): Promise<SentTx> => {
    try {
      // A dry run decodes the refusal without paying for it. It uses the same node as the send below.
      await publicClient.call({ account: address, to, data });
    } catch (e) {
      throw new TxReverted(null, revertSentence(e));
    }
    const client = walletFor(wallet.account.privateKey as Hex, env.evmUrl);
    const account = client.account!;
    // Prepare and sign first: until the signature exists nothing can have left the browser.
    let serialized: Hex;
    try {
      const request = await client.prepareTransactionRequest({ account, chain: client.chain, to, data });
      serialized = await account.signTransaction!(request as never);
    } catch (e) {
      throw new TxFailed(null, sendSentence(e));
    }
    // From here the transaction may reach the chain whatever the answer is, so every failure carries the hash.
    const hash = keccak256(serialized);
    try {
      await client.sendRawTransaction({ serializedTransaction: serialized });
    } catch (e) {
      throw new TxFailed(hash, isTimeout(e) ? SENT_UNKNOWN : sendSentence(e));
    }
    let receipt: TransactionReceipt;
    try {
      receipt = await publicClient.waitForTransactionReceipt({ hash });
    } catch (e) {
      throw new TxFailed(hash, isTimeout(e) ? "The transaction was sent but was not confirmed in time. Check it before trying again." : SEND_FAILED);
    }
    if (receipt.status !== "success") {
      // Replay the call at the block of the receipt to learn why it reverted.
      let reason = revertSentence(null);
      try {
        await publicClient.call({ account: address, to, data, blockNumber: receipt.blockNumber });
      } catch (e) {
        reason = revertSentence(e);
      }
      throw new TxReverted(hash, reason);
    }
    return { hash, receipt };
  };
  return { address, send: async (to, data) => (await sendForReceipt(to, data)).hash, sendForReceipt };
}

/** Opens (or confirms) the scoped window of the test wallet for the given targets; null when none is needed or possible. */
export async function ensureWindowFor(session: WalletSession, targets: string[]): Promise<string | null> {
  const wallet = testWalletOf(session);
  if (!wallet) return null;
  return ensureWindow(browserNet(), wallet.account, targets, BUYER_WINDOW);
}
