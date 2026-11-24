import { bech32 } from "@scure/base";

export const QOR_PREFIX = "qor";

/**
 * Address form used for comparisons: lowercase 0x (20 bytes). The businesses table stores spenders as 0x,
 * so a request's `account` (qor1...) is converted to 0x here, in this one helper. Returns null when invalid.
 */
export function qorToHex(address: string): string | null {
  try {
    const { prefix, words } = bech32.decode(address as `${string}1${string}`);
    if (prefix !== QOR_PREFIX) return null;
    const bytes = bech32.fromWords(words);
    return bytes.length === 20 ? `0x${Buffer.from(bytes).toString("hex")}` : null;
  } catch {
    return null;
  }
}

export function hexToQor(hex: string): string {
  return bech32.encode(QOR_PREFIX, bech32.toWords(Uint8Array.from(Buffer.from(hex.slice(2), "hex"))));
}
