import type { Hex } from "viem";

export type BytecodeFacts = {
  address: string; isContract: boolean; codeSize: number; erc20Selectors: string[];
  usesPqcVerify: boolean; usesPqcKeyStatus: boolean; ecrecoverHint: boolean;
};

const PUSH20 = (tail: string) => "73" + "0".repeat(40 - tail.length) + tail;
const ERC20: Record<string, string> = { a9059cbb: "transfer", "095ea7b3": "approve", "23b872dd": "transferFrom", "70a08231": "balanceOf", "18160ddd": "totalSupply" };

/** Static scan of deployed bytecode. `ecrecoverHint` is a heuristic (PUSH1 0x01 GAS STATICCALL), reported as such. */
export function analyzeBytecode(address: string, code: Hex): BytecodeFacts {
  const hex = code.slice(2).toLowerCase();
  const selectors = Object.entries(ERC20).filter(([sel]) => hex.includes(`63${sel}`)).map(([, name]) => name);
  return {
    address: address.toLowerCase(),
    isContract: hex.length > 0,
    codeSize: hex.length / 2,
    erc20Selectors: selectors,
    usesPqcVerify: hex.includes(PUSH20("a01")),
    usesPqcKeyStatus: hex.includes(PUSH20("a02")),
    ecrecoverHint: hex.includes("60015afa"),
  };
}
