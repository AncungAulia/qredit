import { ERC20_ABI, FUSD_ADDRESS, VAULT_STATE } from "@qredit/qore/abi";
import { LOAN_VAULT_ABI } from "@qredit/qore/abis";
import { planLend } from "@qredit/qore/lend";
import { encodeFunctionData } from "viem";
import { ERC20_ERROR_SENTENCES, VAULT_ERROR_SENTENCES } from "@/components/shared/vaultErrors";
import { readVault } from "@/lib/chain";
import { readFusdAllowance, readFusdBalance } from "@/lib/fusd";
import type { Business } from "@/lib/schemas";
import { readVaultSnapshot } from "@/modules/market/api/market.api";
import type { VaultSnapshot } from "@/modules/market/schemas/vault.schema";
import type { WalletSession } from "@/modules/wallet/session";
import { act, requireSigner } from "@/modules/wallet/act";
import { TxFailed, TxReverted } from "@/modules/wallet/signer";

export { readFusdBalance };

type Hex = `0x${string}`;

/** What a lender holds in one vault. Amounts are fUSD units (6 decimals). */
export type Position = {
  business: Business;
  vault: VaultSnapshot;
  deposit: bigint;
  claimable: bigint;
  claimed: bigint;
};

export const RAISE_FULL_SENTENCE =
  "The vault refused this loan, and your fUSD has not moved. Please choose a business that is still raising.";
export const LEND_NOT_PREPARED_SENTENCE = "The loan could not be prepared. Please try again.";

/** The positions of one lender: only vaults where the lender still holds a deposit. */
export async function readPositions(evm: Hex, businesses: Business[]): Promise<Position[]> {
  const deposits = await Promise.all(businesses.map((b) => readVault(b.vault, "deposits", [evm])));
  const held = businesses.flatMap((business, i) => (deposits[i] > 0n ? [{ business, deposit: deposits[i] }] : []));
  return Promise.all(
    held.map(async ({ business, deposit }) => {
      const [vault, claimable, claimed] = await Promise.all([
        readVaultSnapshot(business.vault),
        readVault(business.vault, "lenderClaimable", [evm]),
        readVault(business.vault, "lenderClaimed", [evm]),
      ]);
      return { business, vault, deposit, claimable, claimed };
    }),
  );
}

/** The steps of a loan, in order. "window" and "approving" are reported only when they really happen. */
export type LendProgress = "window" | "approving" | "depositing";

/**
 * Lends `amount` to a raising vault: checks the vault and the wallet, opens the scoped window for fUSD and the vault,
 * approves when the allowance is short, then deposits. `onProgress` names each step as it starts.
 * An amount above the room left is refused, never lent in part.
 */
export async function lend(
  session: WalletSession,
  vault: Hex,
  amount: bigint,
  onProgress?: (step: LendProgress) => void,
): Promise<{ approveTx?: Hex; depositTx: Hex }> {
  requireSigner(session);
  const [state, raised, loan] = await Promise.all([readVault(vault, "state"), readVault(vault, "raised"), readVault(vault, "loan")]);
  const target = loan[0];
  // Every refusal the wallet or the vault can give is checked here, so none depends on the text of a planner error.
  const room = target - raised;
  if (Number(state) !== VAULT_STATE.Raising || room <= 0n) throw new TxReverted(null, RAISE_FULL_SENTENCE);
  if (amount <= 0n) throw new TxReverted(null, VAULT_ERROR_SENTENCES.ZeroAmount);
  if (amount > room) throw new TxReverted(null, VAULT_ERROR_SENTENCES.OverTarget);

  return act(session, [FUSD_ADDRESS, vault], async (locked) => {
    // act has reported the window (when one was opened) before it runs these steps.
    // The wallet's balance and allowance are read under the lock, after the window: nothing else can change them meanwhile.
    const [balance, allowance] = await Promise.all([readFusdBalance(locked.address), readFusdAllowance(locked.address, vault)]);
    if (balance < amount) throw new TxReverted(null, ERC20_ERROR_SENTENCES.ERC20InsufficientBalance);
    let plan;
    try {
      plan = planLend({ state: Number(state), raised, target, balance, allowance }, amount);
    } catch {
      throw new TxFailed(null, LEND_NOT_PREPARED_SENTENCE);
    }
    if (plan.action !== "deposit" || plan.amount !== amount) throw new TxFailed(null, LEND_NOT_PREPARED_SENTENCE);
    const approves = plan.approve;
    let approveTx: Hex | undefined;
    if (approves) {
      onProgress?.("approving");
      approveTx = await locked.send(FUSD_ADDRESS, encodeFunctionData({ abi: ERC20_ABI, functionName: "approve", args: [vault, amount] }));
    }
    onProgress?.("depositing");
    const depositTx = await locked.send(vault, encodeFunctionData({ abi: LOAN_VAULT_ABI, functionName: "deposit", args: [amount] }));
    return approveTx ? { approveTx, depositTx } : { depositTx };
  }, (step) => onProgress?.(step));
}

const callVault = (session: WalletSession, vault: Hex, functionName: "claimLender" | "refund"): Promise<Hex> =>
  act(session, [vault], (signer) => signer.send(vault, encodeFunctionData({ abi: LOAN_VAULT_ABI, functionName })));

/** Pays the lender every repayment that has arrived and is not yet claimed. */
export const claim = (session: WalletSession, vault: Hex) => callVault(session, vault, "claimLender");

/** Returns the whole deposit of a raise that failed. */
export const refund = (session: WalletSession, vault: Hex) => callVault(session, vault, "refund");
