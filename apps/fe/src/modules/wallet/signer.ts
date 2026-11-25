// The one interface pages use to act on chain. It hides which wallet acts: QoreX cannot send EVM
// transactions, so every EVM send comes from the test wallet (also when QoreX is connected).
import { BUYER_WINDOW, ensureWindow, walletFor, type Net } from "@qredit/qore";
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

export class TxReverted extends Error {
  constructor(
    readonly hash: `0x${string}` | null,
    readonly reason: string,
  ) {
    super(reason);
    this.name = "TxReverted";
  }
}

/** The test wallet behind a session, if any. */
export function testWalletOf(session: WalletSession): TestSession | null {
  if (session.kind === "test") return session;
  if (session.kind === "qorex") return session.testWallet;
  return null;
}

export function evmSignerFor(session: WalletSession, net: Net & { evm?: string }): EvmSigner | null {
  const wallet = testWalletOf(session);
  if (!wallet) return null;
  const evmUrl = net.evm ?? env.evmUrl;
  return {
    address: wallet.evm,
    async send(to, data) {
      try {
        // A dry run decodes the refusal without paying for it.
        await publicClient.call({ account: wallet.evm, to, data });
      } catch (e) {
        throw new TxReverted(null, revertSentence(e));
      }
      const client = walletFor(wallet.account.privateKey as `0x${string}`, evmUrl);
      const hash = await client.sendTransaction({ account: client.account!, chain: client.chain, to, data });
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new TxReverted(hash, revertSentence(null));
      return hash;
    },
  };
}

/** Opens (or confirms) the scoped window of the test wallet for the given targets; null when none is needed or possible. */
export async function ensureWindowFor(session: WalletSession, targets: string[]): Promise<string | null> {
  const wallet = testWalletOf(session);
  if (!wallet) return null;
  return ensureWindow(browserNet(), wallet.account, targets, BUYER_WINDOW);
}
