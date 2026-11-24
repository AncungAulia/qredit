// Shared helpers for the Qredit spikes: network presets, key files, hybrid broadcast, viem clients.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { StargateClient } from "@cosmjs/stargate";
import type { EncodeObject, Registry } from "@cosmjs/proto-signing";
import {
  EthNativeSigner,
  deriveUnifiedAccount,
  getNetwork,
  isValidRecoveryCode,
  unifiedAccountFromSeed,
  type UnifiedAccount,
} from "@qorechain/sdk";
import { createPublicClient, createWalletClient, defineChain, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const preset = getNetwork("testnet");
export const NET = {
  chainId: preset.chainId,
  rest: process.env.QORE_REST_URL?.trim() || preset.endpoints.rest,
  rpc: process.env.QORE_RPC_URL?.trim() || preset.endpoints.rpc,
  evm: process.env.QORE_EVM_URL?.trim() || preset.endpoints.evmRpc,
};

export const qoreTestnet = defineChain({
  id: 9800,
  name: "QoreChain testnet (diana)",
  nativeCurrency: { name: "QOR", symbol: "QOR", decimals: 18 },
  rpcUrls: { default: { http: [NET.evm] } },
});

export const publicClient = createPublicClient({ chain: qoreTestnet, transport: http(NET.evm) });

export const walletFor = (privateKey: `0x${string}`) =>
  createWalletClient({ account: privateKeyToAccount(privateKey), chain: qoreTestnet, transport: http(NET.evm) });

const KEYS_DIR = join(import.meta.dir, "..", ".keys");

export function saveKeyFile(name: string, data: Record<string, string>): void {
  if (!existsSync(KEYS_DIR)) mkdirSync(KEYS_DIR, { recursive: true });
  const file = join(KEYS_DIR, `${name}.json`);
  if (existsSync(file)) throw new Error(`${file} already exists; refusing to overwrite a key`);
  writeFileSync(file, JSON.stringify(data, null, 2), { mode: 0o600 });
}

export async function loadAccount(name: string): Promise<UnifiedAccount> {
  const file = join(KEYS_DIR, `${name}.json`);
  if (!existsSync(file)) throw new Error(`no key file for "${name}": run bun src/accounts.ts new ${name}`);
  const k = JSON.parse(readFileSync(file, "utf8")) as { mnemonic?: string; privateKey?: string; recoveryCode?: string };
  if (k.mnemonic) return deriveUnifiedAccount(k.mnemonic, 0);
  if (!k.privateKey || !k.recoveryCode || !isValidRecoveryCode(k.recoveryCode)) {
    throw new Error(`${file} needs a mnemonic, or a privateKey with a valid QRC1 recoveryCode`);
  }
  return unifiedAccountFromSeed(Uint8Array.from(Buffer.from(k.privateKey.slice(2), "hex")), { recoveryCode: k.recoveryCode });
}

async function getJson<T>(path: string): Promise<T | undefined> {
  const res = await fetch(`${NET.rest}${path}`);
  if (res.status === 404) return undefined;
  if (!res.ok) throw new Error(`GET ${path}: HTTP ${res.status}`);
  return (await res.json()) as T;
}

export async function uqorBalance(address: string): Promise<bigint> {
  const b = await getJson<{ balances: { denom: string; amount: string }[] }>(`/cosmos/bank/v1beta1/balances/${address}`);
  return BigInt(b?.balances.find((x) => x.denom === "uqor")?.amount ?? "0");
}

export async function broadcast(
  acc: UnifiedAccount,
  messages: EncodeObject[],
  mode: "hybrid" | "classical" = "hybrid",
  memo = "",
  registry?: Registry,
): Promise<{ hash: string; code: number; rawLog?: string }> {
  const a = await getJson<{ account: Record<string, unknown> }>(`/cosmos/auth/v1beta1/accounts/${acc.cosmos}`);
  if (!a) throw new Error(`${acc.cosmos} does not exist on chain yet: fund it from the faucet first`);
  const base = (a.account.base_account ?? a.account) as Record<string, string>;
  const signer = new EthNativeSigner(acc, { signMode: mode, rest: NET.rest, registry });
  const transport = await StargateClient.connect(NET.rpc);
  try {
    const res = await signer.signAndBroadcast(transport, {
      chainId: NET.chainId,
      accountNumber: BigInt(base.account_number ?? "0"),
      sequence: BigInt(base.sequence ?? "0"),
      memo,
      messages,
      fee: { amount: [{ denom: "uqor", amount: "150000" }], gas: "1000000" },
    });
    return { hash: res.transactionHash, code: res.code, rawLog: res.rawLog };
  } finally {
    transport.disconnect();
  }
}

export async function txEvents(hash: string): Promise<unknown[]> {
  for (let i = 0; i < 20; i++) {
    const t = await getJson<{ tx_response: { events: unknown[] } }>(`/cosmos/tx/v1beta1/txs/${hash}`);
    if (t) return t.tx_response.events;
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error(`tx ${hash} not found after 30 s`);
}

export function pass(label: string, ok: boolean, detail = ""): boolean {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  (${detail})` : ""}`);
  if (!ok) process.exitCode = 1;
  return ok;
}
