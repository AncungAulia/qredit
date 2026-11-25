import { ERC20_ABI, FUSD_ADDRESS } from "@qredit/qore";
import { publicClient } from "@/lib/chain";

type Hex = `0x${string}`;

const readFusd = (functionName: "balanceOf" | "allowance", args: [Hex] | [Hex, Hex]) =>
  publicClient.readContract({ address: FUSD_ADDRESS, abi: ERC20_ABI, functionName, args } as never) as Promise<bigint>;

/** The fUSD balance of an address on the EVM side (the part a vault can take). */
export const readFusdBalance = (evm: Hex): Promise<bigint> => readFusd("balanceOf", [evm]);

/** How much fUSD `spender` may take from `owner`. */
export const readFusdAllowance = (owner: Hex, spender: Hex): Promise<bigint> => readFusd("allowance", [owner, spender]);
