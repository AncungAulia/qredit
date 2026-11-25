// The one interface pages use to act on chain. It hides which wallet acts: QoreX cannot send EVM
// transactions, so every EVM send comes from the test wallet (also when QoreX is connected).
import { BUYER_WINDOW, ensureWindow, walletFor } from "@qredit/qore";
import { revertSentence } from "@/components/shared/vaultErrors";
import { publicClient } from "@/lib/chain";
import { env } from "@/lib/env";
import { browserNet } from "@/lib/net";
import type { TestSession, WalletSession } from "@/modules/wallet/session";

export type EvmSigner = {
  address: `0x${string}`;
  /** Simulates, sends, waits for the receipt. Throws TxReverted with a decoded reason. */
  send(to: `0x${string}`, data: `0x${string}`): Promise<`0x${string}`>;
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

function sendSentence(e: unknown): string {
  const text = e instanceof Error ? `${e.message} ${(e as { shortMessage?: string }).shortMessage ?? ""}` : "";
  if (/insufficient funds/i.test(text)) return "The wallet has too little QOR to pay the network fee.";
  if (/user (rejected|denied)|rejected the request/i.test(text)) return "The transaction was declined in the wallet.";
  return SEND_FAILED;
}

const isTimeout = (e: unknown) => e instanceof Error && /Timeout/i.test(e.name);

// One queue per address: two sends from the same address never run together, so they never read the same nonce.
const queues = new Map<string, Promise<unknown>>();
function enqueue<T>(address: string, job: () => Promise<T>): Promise<T> {
  const run = (queues.get(address) ?? Promise.resolve()).catch(() => undefined).then(job);
  queues.set(address, run);
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
  const address = wallet.evm;
  const send = async (to: `0x${string}`, data: `0x${string}`): Promise<`0x${string}`> => {
    try {
      // A dry run decodes the refusal without paying for it. It uses the same node as the send below.
      await publicClient.call({ account: address, to, data });
    } catch (e) {
      throw new TxReverted(null, revertSentence(e));
    }
    const client = walletFor(wallet.account.privateKey as `0x${string}`, env.evmUrl);
    let hash: `0x${string}`;
    try {
      hash = await client.sendTransaction({ account: client.account!, chain: client.chain, to, data });
    } catch (e) {
      throw new TxFailed(null, sendSentence(e));
    }
    let receipt;
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
    return hash;
  };
  return { address, send: (to, data) => enqueue(address, () => send(to, data)) };
}

/** Opens (or confirms) the scoped window of the test wallet for the given targets; null when none is needed or possible. */
export async function ensureWindowFor(session: WalletSession, targets: string[]): Promise<string | null> {
  const wallet = testWalletOf(session);
  if (!wallet) return null;
  return ensureWindow(browserNet(), wallet.account, targets, BUYER_WINDOW);
}
