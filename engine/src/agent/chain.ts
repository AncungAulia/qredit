import { ed25519 } from "@noble/curves/ed25519";
import { buildPhantomExecuteEvm, fetchAuthNonce, resolveEvmAuthDigestVersion } from "@qorechain/sdk";
import { publicClientFor, VAULT_ABI, walletFor, type Net } from "@qredit/qore";
import { BaseError, ContractFunctionRevertedError, encodeFunctionData, type Hex, type PublicClient } from "viem";
import type { RelayRequest } from "./api.ts";
import type { DeclineCode, VaultFunds } from "./types.ts";

const PAY_GAS_LIMIT = 300_000;

export function paySupplierCalldata(supplier: string, amount: bigint, orderId: bigint): Hex {
  return encodeFunctionData({ abi: VAULT_ABI, functionName: "paySupplier", args: [supplier as Hex, amount, orderId] });
}

/** Turns an SDK message (Uint8Array fields, bigint numbers) into the backend's string form (Uint8Array -> base64). */
export function toRelayRequest(msg: { typeUrl: string; value: Record<string, unknown> }): RelayRequest {
  const value: Record<string, string> = {};
  for (const [k, v] of Object.entries(msg.value)) {
    value[k] = v instanceof Uint8Array ? Buffer.from(v).toString("base64") : typeof v === "string" ? v : String(v);
  }
  return { typeUrl: msg.typeUrl, value: value as RelayRequest["value"] };
}

export function createSpenderSigner(o: { agentSecret: Uint8Array; spenderQor: string; relayer: string; net: Net }) {
  const publicKey = ed25519.getPublicKey(o.agentSecret);
  const wallet = { publicKey, async signMessage(m: Uint8Array) { return { signature: ed25519.sign(m, o.agentSecret) }; } };
  return {
    async payRequest(vault: string, supplier: string, amount: bigint, orderId: bigint): Promise<RelayRequest> {
      const digestVersion = await resolveEvmAuthDigestVersion({ rest: o.net.rest });
      const { nonce } = await fetchAuthNonce({ rest: o.net.rest, address: o.spenderQor, pubkey: publicKey });
      const msg = await buildPhantomExecuteEvm({
        wallet, relayer: o.relayer, chainId: o.net.chainId, account: o.spenderQor, to: vault, value: "0",
        data: Buffer.from(paySupplierCalldata(supplier, amount, orderId).slice(2), "hex"), gasLimit: PAY_GAS_LIMIT, nonce, digestVersion,
      });
      return toRelayRequest(msg as unknown as { typeUrl: string; value: Record<string, unknown> });
    },
  };
}

export type CloseResult = { tx: Hex | null; alreadyClosed: boolean };
export type OperatorClients = {
  pub: { simulateContract: (a: never) => Promise<{ request: unknown }>; waitForTransactionReceipt: (a: { hash: Hex }) => Promise<{ status: string }> };
  wallet: { account: { address: Hex }; writeContract: (req: never) => Promise<Hex> };
};

function revertName(e: unknown): string | undefined {
  if (e instanceof BaseError) {
    const r = e.walk((x) => x instanceof ContractFunctionRevertedError);
    if (r instanceof ContractFunctionRevertedError) return r.data?.errorName;
  }
  return undefined;
}

export function createOperator(o: { privateKey: Hex; evm: string; clients?: OperatorClients }) {
  const clients = o.clients ?? ({ pub: publicClientFor(o.evm), wallet: walletFor(o.privateKey, o.evm) } as unknown as OperatorClients);
  async function close(vault: string, functionName: "deliver" | "decline", args: readonly [bigint, Hex | number]): Promise<CloseResult> {
    try {
      const { request } = await clients.pub.simulateContract({
        address: vault as Hex, abi: VAULT_ABI, functionName, args, account: clients.wallet.account.address,
      } as never);
      // simulateContract returns the account as a bare address, which makes viem ask the node to sign; use the local account.
      const tx = await clients.wallet.writeContract({ ...(request as object), account: clients.wallet.account } as never);
      const receipt = await clients.pub.waitForTransactionReceipt({ hash: tx });
      if (receipt.status !== "success") throw new Error(`${functionName} reverted on chain: ${tx}`);
      return { tx, alreadyClosed: false };
    } catch (e) {
      const name = revertName(e);
      if (name === "OrderNotOpen") return { tx: null, alreadyClosed: true };
      if (name) throw new Error(`${functionName} reverted with ${name}`);
      throw e;
    }
  }
  return {
    deliver: (vault: string, orderId: bigint, envelopeHash: Hex) => close(vault, "deliver", [orderId, envelopeHash]),
    decline: (vault: string, orderId: bigint, code: DeclineCode) => close(vault, "decline", [orderId, code]),
  };
}

export type ReaderClient = {
  readContract: (a: never) => Promise<unknown>;
  getBlock: (a?: { blockTag: "latest" }) => Promise<{ timestamp: bigint }>;
};

export function createVaultReader(client: ReaderClient | PublicClient) {
  const c = client as ReaderClient;
  const read = <T>(vault: string, functionName: string, args: unknown[] = []) =>
    c.readContract({ address: vault, abi: VAULT_ABI, functionName, args } as never) as Promise<T>;
  return {
    async funds(vault: string): Promise<VaultFunds> {
      const [opex, dailyCap, spentToday, dayIndex, paused, block] = await Promise.all([
        read<bigint>(vault, "opexBalance"), read<bigint>(vault, "dailyCap"), read<bigint>(vault, "spentToday"),
        read<bigint | number>(vault, "dayIndex"), read<boolean>(vault, "paused"), c.getBlock({ blockTag: "latest" }),
      ]);
      return { opex, dailyCap, spentToday, dayIndex: BigInt(dayIndex), nowDay: block.timestamp / 86400n, paused };
    },
    async supplierCap(vault: string, supplier: string): Promise<bigint> {
      const [allowed, perTxCap] = await read<readonly [boolean, bigint]>(vault, "suppliers", [supplier]);
      return allowed ? perTxCap : 0n;
    },
  };
}
