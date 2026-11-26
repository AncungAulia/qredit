import { encodeFunctionData } from "viem";
import { z } from "zod";
import { LOAN_VAULT_ABI } from "@qredit/qore/abis";
import { revertSentence } from "@/components/shared/vaultErrors";
import { api, parseResponse } from "@/lib/apiClient";
import { publicClient, readVault } from "@/lib/chain";
import { readCreationSuppliers } from "@/lib/creationSuppliers";
import { decisionSchema, type Business, type Decision } from "@/lib/schemas";
import { act } from "@/modules/wallet/act";
import type { WalletSession } from "@/modules/wallet/session";

type Hex = `0x${string}`;
type VaultRef = Pick<Business, "vault" | "startBlock">;

export type VaultRules = {
  suppliers: { address: Hex; allowed: boolean; perTxCap: bigint }[];
  dailyCap: bigint;
  spentToday: bigint;
  lenderBps: number;
  ownerBps: number;
  orderTtlSeconds: number;
};

const DAY_SECONDS = 86_400;

export { readCreationSuppliers } from "@/lib/creationSuppliers";

/**
 * The spending rules of a vault as they stand now. Pass the creation suppliers when they are already known;
 * otherwise they are decoded from the creation call.
 */
export async function readVaultRules(b: VaultRef, creationSuppliers?: Hex[]): Promise<VaultRules> {
  const [addresses, dailyCap, spent, dayIndex, lenderBps, ownerBps, orderTtl] = await Promise.all([
    creationSuppliers ?? readCreationSuppliers(b),
    readVault(b.vault, "dailyCap"),
    readVault(b.vault, "spentToday"),
    readVault(b.vault, "dayIndex"),
    readVault(b.vault, "lenderBps"),
    readVault(b.vault, "ownerBps"),
    readVault(b.vault, "orderTtl"),
  ]);
  const suppliers = await Promise.all(
    addresses.map(async (address) => {
      const [allowed, perTxCap] = await readVault(b.vault, "suppliers", [address]);
      return { address, allowed, perTxCap };
    }),
  );
  // The vault resets spentToday lazily on the next payment, so a counter from an earlier day is zero today.
  // The day comes from the browser clock while the vault uses the block time; within a few seconds of UTC
  // midnight the two can disagree, so the figure can be stale (or zero) for that moment only.
  const today = BigInt(Math.floor(Date.now() / 1000 / DAY_SECONDS));
  return {
    suppliers,
    dailyCap,
    spentToday: dayIndex === today ? spent : 0n,
    lenderBps: Number(lenderBps),
    ownerBps: Number(ownerBps),
    orderTtlSeconds: Number(orderTtl),
  };
}

export async function getDecisions(vault: Hex, limit = 50): Promise<Decision[]> {
  const { data } = await api.get("/v1/decisions", { params: { vault, limit } });
  return parseResponse(z.array(decisionSchema), data);
}

const TRIGGER_DEFAULT = encodeFunctionData({ abi: LOAN_VAULT_ABI, functionName: "triggerDefault" });

/** A dry run of `triggerDefault`: no transaction is sent. The vault decides, so the page never guesses from the schedule. */
export async function simulateTriggerDefault(vault: Hex, from?: Hex): Promise<{ ok: true } | { ok: false; reason: string }> {
  try {
    await publicClient.call({ account: from, to: vault, data: TRIGGER_DEFAULT });
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: revertSentence(e) };
  }
}

/** Ends a loan that is far enough behind or past maturity. Anyone may send it; the test wallet pays the fee. */
export const triggerDefault = (session: WalletSession, vault: Hex): Promise<Hex> =>
  act(session, [vault], (signer) => signer.send(vault, TRIGGER_DEFAULT));

export type DefaultBooks = { opex: bigint; ownerOwed: bigint; bond: bigint };

/** What a default moves to lenders besides the sale proceeds: the vault's cash, the owner's unclaimed share and the bond. */
export async function readDefaultBooks(vault: Hex): Promise<DefaultBooks> {
  const [, , ownerOwed, opex, , bond] = await readVault(vault, "books");
  return { opex, ownerOwed, bond };
}
