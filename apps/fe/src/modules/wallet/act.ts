// How every page signs: one account lock around the scoped window and the sends that follow it, so two actions of the
// same test wallet never interleave (they would read the same nonce and the same window sequence).
import { ensureWindowFor, evmSignerFor, TxFailed, TxReverted, withAccountLock, type EvmSigner } from "@/modules/wallet/signer";
import type { WalletSession } from "@/modules/wallet/session";

export const NO_TEST_WALLET_SENTENCE = "A test wallet is needed to send this transaction. Create or unlock one first.";
export const WINDOW_FAILED_SENTENCE = "The wallet could not be prepared to send. Nothing was paid; please try again.";

/** The signer of the test wallet behind the session; a session without one is refused with one shared sentence. */
export function requireSigner(session: WalletSession): EvmSigner {
  const signer = evmSignerFor(session);
  if (!signer) throw new TxFailed(null, NO_TEST_WALLET_SENTENCE);
  return signer;
}

/** Runs a step that comes before any payment: a failure that is not already a decoded chain failure says nothing was paid. */
export async function beforePayment<T>(step: () => Promise<T>, sentence = WINDOW_FAILED_SENTENCE): Promise<T> {
  try {
    return await step();
  } catch (e) {
    if (e instanceof TxFailed || e instanceof TxReverted) throw e;
    throw new TxFailed(null, sentence);
  }
}

/**
 * Takes the lock of the account, opens (or confirms) the scoped window for `targets`, then runs `steps` with the signer.
 * The lock is released when `steps` settles, whatever the outcome. A second action waits for the first.
 */
export async function act<T>(session: WalletSession, targets: string[], steps: (signer: EvmSigner) => Promise<T>): Promise<T> {
  const signer = requireSigner(session);
  return await withAccountLock(signer.address, async () => {
    await beforePayment(() => ensureWindowFor(session, targets));
    return steps(signer);
  });
}
