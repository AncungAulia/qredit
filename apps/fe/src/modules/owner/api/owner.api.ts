import { LOAN_VAULT_ABI } from "@qredit/qore";
import { encodeFunctionData, hexToString, toHex } from "viem";
import { revertSentence, VAULT_ERROR_SENTENCES } from "@/components/shared/vaultErrors";
import { publicClient, readVault } from "@/lib/chain";
import type { Business } from "@/lib/schemas";
import type { VaultStateName } from "@/lib/vaultState";
import { readVaultSnapshot } from "@/modules/market/api/market.api";
import type { OrderInput, PolicyOrder } from "@/modules/owner/schemas/policyOrder.schema";
import type { WalletSession } from "@/modules/wallet/session";
import { act } from "@/modules/wallet/act";
import { TxReverted } from "@/modules/wallet/signer";

type Hex = `0x${string}`;

/** The rules of one vault as the owner console shows them. Amounts are fUSD units (6 decimals). */
export type Rules = {
  state: VaultStateName;
  paused: boolean;
  repaid: bigint;
  totalOwed: bigint;
  dailyCap: bigint;
  spentToday: bigint;
};

/** The vaults of `businesses` whose owner key address is `ownerEvm`. Fails as a whole when one vault cannot be read. */
export async function ownedVaults(ownerEvm: Hex, businesses: Business[]): Promise<Business[]> {
  const owners = await Promise.all(businesses.map((b) => readVault(b.vault, "ownerPq")));
  const me = ownerEvm.toLowerCase();
  return businesses.filter((_, i) => owners[i].toLowerCase() === me);
}

/** The rules the owner is about to change, read from the vault. */
export async function readRules(vault: Hex): Promise<Rules> {
  const [snapshot, dailyCap, spentToday] = await Promise.all([
    readVaultSnapshot(vault),
    readVault(vault, "dailyCap"),
    readVault(vault, "spentToday"),
  ]);
  return {
    state: snapshot.state,
    paused: snapshot.paused,
    repaid: snapshot.repaid,
    totalOwed: snapshot.totalOwed,
    dailyCap,
    spentToday,
  };
}

/**
 * Turns the owner's choice into an order: the nonce is the vault's own `policyNonce` and the text to sign is the one the
 * vault returns for exactly this order, so what is signed is what the vault will check. The expiry counts from the
 * timestamp of the latest block, the clock the vault compares it with, not from the clock of the browser.
 */
export async function buildOrder(vault: Hex, input: OrderInput): Promise<{ order: PolicyOrder; text: string }> {
  const [nonce, block] = await Promise.all([readVault(vault, "policyNonce"), publicClient.getBlock()]);
  const order: PolicyOrder = {
    kind: input.kind,
    target: input.target,
    value: input.value,
    nonce,
    expiry: block.timestamp + BigInt(input.expiryMinutes * 60),
  };
  const text = hexToString(await readVault(vault, "orderText", [order]));
  return { order, text };
}

export const REBUILD_HINT = "Go back and sign a new order.";

/** A stale nonce or an expired order cannot be fixed by trying again: the owner has to sign a new one. */
const withHint = (reason: string): string =>
  reason === VAULT_ERROR_SENTENCES.BadNonce || reason === VAULT_ERROR_SENTENCES.OrderExpiredSig
    ? `${reason} ${REBUILD_HINT}`
    : reason;

const applyData = (order: PolicyOrder, sig: Uint8Array): Hex =>
  encodeFunctionData({ abi: LOAN_VAULT_ABI, functionName: "applyOrder", args: [order, toHex(sig)] });

/** A dry run of `applyOrder`: no transaction is sent. A refusal comes back as the sentence of the vault's error. */
export async function simulateApply(
  vault: Hex,
  order: PolicyOrder,
  sig: Uint8Array,
  from?: Hex,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  try {
    await publicClient.call({ account: from, to: vault, data: applyData(order, sig) });
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: withHint(revertSentence(e)) };
  }
}

/** Submits the signed order. Anyone may submit it; the vault checks the owner's signature, so the test wallet pays the fee. */
export async function applyOrder(session: WalletSession, vault: Hex, order: PolicyOrder, sig: Uint8Array): Promise<Hex> {
  try {
    return await act(session, [vault], (signer) => signer.send(vault, applyData(order, sig)));
  } catch (e) {
    if (e instanceof TxReverted) throw new TxReverted(e.hash, withHint(e.reason));
    throw e;
  }
}
