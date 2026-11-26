import { FACTORY_ADDRESS } from "@qredit/qore/abi";
import { VAULT_FACTORY_ABI } from "@qredit/qore/abis";
import { decodeFunctionData, getAbiItem } from "viem";
import { publicClient } from "@/lib/chain";
import type { Business } from "@/lib/schemas";

type Hex = `0x${string}`;
const VAULT_CREATED = getAbiItem({ abi: VAULT_FACTORY_ABI, name: "VaultCreated" });
// A creation never changes, so a read is kept for good (failures are not kept and are read again).
const known = new Map<string, Hex[]>();

/** The suppliers a vault was created with, decoded from the factory's create call. */
export async function readCreationSuppliers(b: Pick<Business, "vault" | "startBlock">): Promise<Hex[]> {
  const hit = known.get(b.vault.toLowerCase());
  if (hit) return hit;
  const block = BigInt(b.startBlock);
  const logs = await publicClient.getLogs({ address: FACTORY_ADDRESS, event: VAULT_CREATED, args: { vault: b.vault }, fromBlock: block, toBlock: block });
  const log = logs[0];
  if (!log?.transactionHash) throw new Error("The vault creation could not be found on chain.");
  const tx = await publicClient.getTransaction({ hash: log.transactionHash });
  const call = decodeFunctionData({ abi: VAULT_FACTORY_ABI, data: tx.input });
  if (call.functionName !== "create") throw new Error("The vault was not created by a direct factory call.");
  const suppliers = call.args[0].suppliers.map((s) => s.toLowerCase() as Hex);
  known.set(b.vault.toLowerCase(), suppliers);
  return suppliers;
}
