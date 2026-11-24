import { randomBytes } from "node:crypto";
import { ed25519 } from "@noble/curves/ed25519";
import { generateMnemonic, generatePqcRecoveryCode, type UnifiedAccount } from "@qorechain/sdk";
import { accountFrom, parseKeySpec } from "@qredit/qore";
import type { Keystore } from "../keystore.ts";
import type { BusinessParams } from "./businesses.ts";

export const SUPPLIER_ACCOUNTS = {
  dataIndexer: "supplier-data-indexer",
  listOracle: "supplier-list-oracle",
  computeBasic: "supplier-compute-basic",
  computeDeep: "supplier-compute-deep",
} as const;

export function accountNames(businesses: BusinessParams[]): string[] {
  return [
    "relayer", "treasury", ...Object.values(SUPPLIER_ACCOUNTS),
    ...businesses.flatMap((b) => [`${b.slug}-spender`, `${b.slug}-operator`, `${b.slug}-agent`]),
  ];
}

function freshKey(name: string): Record<string, string> {
  if (name.endsWith("-agent")) return { ed25519: Buffer.from(ed25519.utils.randomPrivateKey()).toString("hex") };
  if (name.endsWith("-operator")) return { privateKey: `0x${randomBytes(32).toString("hex")}`, recoveryCode: generatePqcRecoveryCode() };
  return { mnemonic: generateMnemonic(256) };
}

export function ensureAccounts(ks: Keystore, names: string[]): { created: string[]; existing: string[] } {
  const created: string[] = [];
  const existing: string[] = [];
  for (const name of names) {
    if (ks.has(name)) existing.push(name);
    else {
      ks.write(name, freshKey(name));
      created.push(name);
    }
  }
  return { created, existing };
}

export const loadAccount = (ks: Keystore, name: string): Promise<UnifiedAccount> => accountFrom(parseKeySpec(JSON.stringify(ks.read(name))));

export function agentKey(ks: Keystore, slug: string): { secret: Uint8Array; publicKey: Uint8Array } {
  const secret = Uint8Array.from(Buffer.from(ks.read(`${slug}-agent`).ed25519, "hex"));
  return { secret, publicKey: ed25519.getPublicKey(secret) };
}
