import type { BytecodeFacts } from "../suppliers/data/bytecode.ts";
import type { SupplierData } from "./types.ts";

export type Token = { name: string | null; symbol: string | null; decimals: number | null; totalSupply: string | null };
export type Deep = BytecodeFacts & { token: Token; owner: string | null };

export type BytecodeF = {
  address: string; isContract: boolean; codeSize: number; erc20Selectors: string[];
  usesPqcVerify: boolean; usesPqcKeyStatus: boolean; usesPqcPrecompile: boolean; ecrecoverHint: boolean;
  deep: boolean; token?: Token; owner?: string | null; ownerPresent: boolean;
};

/** Facts from whichever compute role was bought; deep wins when both are present. */
export function bytecodeFacts(data: SupplierData): BytecodeF {
  const deep = data.computeDeep as Deep | undefined;
  const b = (deep ?? data.computeBasic) as BytecodeFacts;
  return {
    address: b.address,
    isContract: b.isContract,
    codeSize: b.codeSize,
    erc20Selectors: b.erc20Selectors,
    usesPqcVerify: b.usesPqcVerify,
    usesPqcKeyStatus: b.usesPqcKeyStatus,
    usesPqcPrecompile: b.usesPqcVerify || b.usesPqcKeyStatus,
    ecrecoverHint: b.ecrecoverHint,
    deep: Boolean(deep),
    ...(deep ? { token: deep.token, owner: deep.owner } : {}),
    ownerPresent: Boolean(deep && deep.owner != null),
  };
}

export function bytecodeFindings(f: BytecodeF): string[] {
  const out = [f.isContract ? `Contract code found, ${f.codeSize} bytes.` : "No contract code at this address."];
  if (!f.isContract) return out;
  const which = f.usesPqcVerify && f.usesPqcKeyStatus ? "pqcVerify and pqcKeyStatus" : f.usesPqcVerify ? "pqcVerify" : "pqcKeyStatus";
  out.push(f.usesPqcPrecompile ? `Calls the PQC precompile ${which}.` : "Does not call a PQC precompile.");
  out.push(f.ecrecoverHint ? "Bytecode contains an ecrecover call pattern (heuristic)." : "No ecrecover call pattern found (heuristic).");
  if (f.erc20Selectors.length) out.push(`ERC-20 functions in code: ${f.erc20Selectors.join(", ")}.`);
  return out;
}
