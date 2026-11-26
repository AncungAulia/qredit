import { bytesToHex, hexToBytes, pad, type Hex } from "viem";

/** Forge's `deployedBytecode.immutableReferences`: for each immutable, where its 32-byte word sits in the runtime code. */
export type ImmutableRefs = Record<string, { start: number; length: number }[]>;

/** Writes `value` (left-padded to 32 bytes) into every immutable slot, as the EVM does when the contract is deployed. */
export function fillImmutables(code: Hex, refs: ImmutableRefs, value: Hex): Hex {
  const bytes = hexToBytes(code);
  const word = hexToBytes(pad(value, { size: 32 }));
  for (const slots of Object.values(refs)) {
    for (const { start, length } of slots) {
      if (length !== 32 || start + 32 > bytes.length) throw new Error(`bad immutable slot at ${start} (${length} bytes)`);
      bytes.set(word, start);
    }
  }
  return bytesToHex(bytes);
}
