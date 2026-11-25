import { FACTORY_ADDRESS, VAULT_FACTORY_ABI } from "@qredit/qore";
import { decodeFunctionData, getAbiItem } from "viem";
import { z } from "zod";
import { api, parseResponse } from "@/lib/apiClient";
import { publicClient, readVault } from "@/lib/chain";
import { decisionSchema, type Business, type Decision } from "@/lib/schemas";

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

const VAULT_CREATED = getAbiItem({ abi: VAULT_FACTORY_ABI, name: "VaultCreated" });
const DAY_SECONDS = 86_400;

/**
 * The suppliers a vault was created with, decoded from the creation call. The creation never changes, so
 * callers can cache this for good. Later changes (a removed supplier, a lower cap) are read from the vault.
 */
export async function readCreationSuppliers(b: VaultRef): Promise<Hex[]> {
  const block = BigInt(b.startBlock);
  const logs = await publicClient.getLogs({
    address: FACTORY_ADDRESS,
    event: VAULT_CREATED,
    args: { vault: b.vault },
    fromBlock: block,
    toBlock: block,
  });
  const log = logs[0];
  if (!log?.transactionHash) throw new Error("The vault creation could not be found on chain.");
  const tx = await publicClient.getTransaction({ hash: log.transactionHash });
  const call = decodeFunctionData({ abi: VAULT_FACTORY_ABI, data: tx.input });
  if (call.functionName !== "create")
    throw new Error("The vault was not created by a direct factory call.");
  return call.args[0].suppliers.map((s) => s.toLowerCase() as Hex);
}

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
