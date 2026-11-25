import { ERC20_ABI, FUSD_ADDRESS, LOAN_VAULT_ABI, VAULT_STATE, planLend } from "@qredit/qore";
import { encodeFunctionData } from "viem";
import { ERC20_ERROR_SENTENCES, VAULT_ERROR_SENTENCES } from "@/components/shared/vaultErrors";
import { publicClient, readVault } from "@/lib/chain";
import type { Business } from "@/lib/schemas";
import { readVaultSnapshot } from "@/modules/market/api/market.api";
import type { VaultSnapshot } from "@/modules/market/schemas/vault.schema";
import type { WalletSession } from "@/modules/wallet/session";
import { ensureWindowFor, evmSignerFor, TxFailed, TxReverted, type EvmSigner } from "@/modules/wallet/signer";

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
export const NO_TEST_WALLET_SENTENCE =
  "A test wallet is needed to send this transaction. Create or unlock one first.";

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

const readFusd = (functionName: "balanceOf" | "allowance", args: [Hex] | [Hex, Hex]) =>
  publicClient.readContract({ address: FUSD_ADDRESS, abi: ERC20_ABI, functionName, args } as never) as Promise<bigint>;

/** The fUSD balance of an address on the EVM side (the part a vault can take). */
export const readFusdBalance = (evm: Hex): Promise<bigint> => readFusd("balanceOf", [evm]);

function signerOf(session: WalletSession): EvmSigner {
  const signer = evmSignerFor(session);
  if (!signer) throw new TxFailed(null, NO_TEST_WALLET_SENTENCE);
  return signer;
}

/**
 * Lends `amount` to a raising vault: checks the vault and the wallet, opens the scoped window for fUSD and the vault,
 * approves when the allowance is short, then deposits. `onSent` is called once the checks passed and the sends start.
 * An amount above the room left is refused, never lent in part.
 */
export async function lend(
  session: WalletSession,
  vault: Hex,
  amount: bigint,
  onSent?: () => void,
): Promise<{ approveTx?: Hex; depositTx: Hex }> {
  const signer = signerOf(session);
  const [state, raised, loan, balance, allowance] = await Promise.all([
    readVault(vault, "state"),
    readVault(vault, "raised"),
    readVault(vault, "loan"),
    readFusd("balanceOf", [signer.address]),
    readFusd("allowance", [signer.address, vault]),
  ]);
  const target = loan[0];
  // Every refusal the wallet or the vault can give is checked here, so none depends on the text of a planner error.
  const room = target - raised;
  if (Number(state) !== VAULT_STATE.Raising || room <= 0n) throw new TxReverted(null, RAISE_FULL_SENTENCE);
  if (amount <= 0n) throw new TxReverted(null, VAULT_ERROR_SENTENCES.ZeroAmount);
  if (amount > room) throw new TxReverted(null, VAULT_ERROR_SENTENCES.OverTarget);
  if (balance < amount) throw new TxReverted(null, ERC20_ERROR_SENTENCES.ERC20InsufficientBalance);
  let plan;
  try {
    plan = planLend({ state: Number(state), raised, target, balance, allowance }, amount);
  } catch {
    throw new TxFailed(null, LEND_NOT_PREPARED_SENTENCE);
  }
  if (plan.action !== "deposit" || plan.amount !== amount) throw new TxFailed(null, LEND_NOT_PREPARED_SENTENCE);

  await ensureWindowFor(session, [FUSD_ADDRESS, vault]);
  onSent?.();
  let approveTx: Hex | undefined;
  if (plan.approve) {
    approveTx = await signer.send(FUSD_ADDRESS, encodeFunctionData({ abi: ERC20_ABI, functionName: "approve", args: [vault, amount] }));
  }
  const depositTx = await signer.send(vault, encodeFunctionData({ abi: LOAN_VAULT_ABI, functionName: "deposit", args: [amount] }));
  return approveTx ? { approveTx, depositTx } : { depositTx };
}

async function callVault(session: WalletSession, vault: Hex, functionName: "claimLender" | "refund"): Promise<Hex> {
  const signer = signerOf(session);
  await ensureWindowFor(session, [vault]);
  return signer.send(vault, encodeFunctionData({ abi: LOAN_VAULT_ABI, functionName }));
}

/** Pays the lender every repayment that has arrived and is not yet claimed. */
export const claim = (session: WalletSession, vault: Hex) => callVault(session, vault, "claimLender");

/** Returns the whole deposit of a raise that failed. */
export const refund = (session: WalletSession, vault: Hex) => callVault(session, vault, "refund");
