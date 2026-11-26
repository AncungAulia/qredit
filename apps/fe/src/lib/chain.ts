import { LOAN_VAULT_ABI } from "@qredit/qore/abis";
import { publicClientFor } from "@qredit/qore/net";
import type { Abi, Address, ContractFunctionArgs, ContractFunctionName, ReadContractReturnType } from "viem";
import { env } from "./env";

export const publicClient = publicClientFor(env.evmUrl);

/** The loose shape of a readContract call: the vault ABI is wide enough that viem's generic inference over it is too deep for tsc. */
type ReadParams = { address: Address; abi: Abi; functionName: string; args?: readonly unknown[] };

type VaultReader = ContractFunctionName<typeof LOAN_VAULT_ABI, "view" | "pure">;

/**
 * Reads one view function of a loan vault. The result type follows the function name from the ABI.
 * The single cast sits here: viem cannot narrow a generic function name through readContract itself.
 */
export const readVault = <F extends VaultReader>(
  address: Address,
  functionName: F,
  args?: ContractFunctionArgs<typeof LOAN_VAULT_ABI, "view" | "pure", F>,
): Promise<ReadContractReturnType<typeof LOAN_VAULT_ABI, F>> =>
  (publicClient.readContract as (p: ReadParams) => Promise<unknown>)({ address, abi: LOAN_VAULT_ABI, functionName, args: args as readonly unknown[] | undefined }) as Promise<
    ReadContractReturnType<typeof LOAN_VAULT_ABI, F>
  >;

/** The Cosmos REST API has no CORS headers, so browser calls go through this app's proxy (app/api/chain/rest). */
export const restUrl = () => `${typeof window === "undefined" ? "" : window.location.origin}/api/chain/rest`;
