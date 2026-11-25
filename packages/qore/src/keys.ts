import { hex } from "@scure/base";
import { deriveUnifiedAccount, isValidRecoveryCode, unifiedAccountFromSeed, type UnifiedAccount } from "@qorechain/sdk";

export type KeySpec = { mnemonic: string } | { privateKey: `0x${string}`; recoveryCode: string };

function fromValue(v: unknown): KeySpec {
  const o = (v ?? {}) as Record<string, unknown>;
  if (typeof o.mnemonic === "string" && o.mnemonic.trim().split(/\s+/).length >= 12) return { mnemonic: o.mnemonic.trim() };
  if (typeof o.privateKey === "string" && /^0x[0-9a-fA-F]{64}$/.test(o.privateKey) && typeof o.recoveryCode === "string") {
    return { privateKey: o.privateKey as `0x${string}`, recoveryCode: o.recoveryCode };
  }
  throw new Error('a key spec must be {"mnemonic":"<12+ words>"} or {"privateKey":"0x<64 hex>","recoveryCode":"QRC1-..."}');
}

/** JSON.parse that never echoes the input (it may be key material) in its error. */
function parseJson(raw: string, label: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(`${label} is not valid JSON`);
  }
}

export const parseKeySpec = (raw: string, label = "key spec"): KeySpec => fromValue(parseJson(raw, label));

export function parseKeyList(raw: string, label = "key list"): KeySpec[] {
  const v = parseJson(raw, label);
  if (!Array.isArray(v)) throw new Error("expected a JSON array of key specs");
  return v.map(fromValue);
}

export async function accountFrom(spec: KeySpec): Promise<UnifiedAccount> {
  if ("mnemonic" in spec) return deriveUnifiedAccount(spec.mnemonic, 0);
  if (!isValidRecoveryCode(spec.recoveryCode)) throw new Error("invalid QRC1 recovery code");
  return unifiedAccountFromSeed(hex.decode(spec.privateKey.slice(2).toLowerCase()), { recoveryCode: spec.recoveryCode });
}
