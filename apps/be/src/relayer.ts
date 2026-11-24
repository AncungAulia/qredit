import type { EncodeObject } from "@cosmjs/proto-signing";
import { executionFailure, type RestEvent, type Sent, serial } from "./chain/tx.ts";
import { PAY_SUPPLIER_SELECTOR } from "./chain/vault.ts";

export const EXECUTE_EVM_TYPE_URL = "/qorechain.abstractaccount.v1.MsgExecuteEVM";

export type RelayRequest = {
  typeUrl: string;
  value: {
    relayer: string; account: string; scheme: string;
    pubkey: string; signature: string; // base64
    to: string; value: string;
    data: string; // base64 calldata
    gasLimit: string; nonce: string;
  };
};
export type RelayResult = { txHash: string; success: boolean; reason?: string };

export class RelayRejected extends Error {}

const b64 = (s: string) => Uint8Array.from(Buffer.from(s, "base64"));

export function validateRelay(req: RelayRequest, ctx: { relayer: string; vaults: Set<string>; maxGas: number }): string | null {
  if (req.typeUrl !== EXECUTE_EVM_TYPE_URL) return `wrong message type: only ${EXECUTE_EVM_TYPE_URL} is relayed`;
  const v = req.value;
  if (v.relayer !== ctx.relayer) return "the message must name this relayer";
  if (!/^0x[0-9a-fA-F]{40}$/.test(v.to) || !ctx.vaults.has(v.to.toLowerCase())) return "the target is not a Qredit vault";
  if (v.value !== "0") return "value must be 0";
  if (!/^[0-9]+$/.test(v.gasLimit) || Number(v.gasLimit) > ctx.maxGas || Number(v.gasLimit) === 0) return `gas limit must be 1..${ctx.maxGas}`;
  if (!/^[0-9]+$/.test(v.nonce)) return "nonce must be a decimal integer";
  const data = b64(v.data);
  const selector = `0x${Buffer.from(data.subarray(0, 4)).toString("hex")}`;
  if (selector !== PAY_SUPPLIER_SELECTOR) return "only vault.paySupplier is relayed";
  return null;
}

export function createRelayer(deps: {
  relayerAddress: string;
  vaults: () => Promise<Set<string>>;
  send: (msg: EncodeObject) => Promise<Sent>;
  events: (hash: string) => Promise<RestEvent[]>;
  maxGas?: number;
}): (req: RelayRequest) => Promise<RelayResult> {
  const run = serial();
  return async (req) => {
    const error = validateRelay(req, { relayer: deps.relayerAddress, vaults: await deps.vaults(), maxGas: deps.maxGas ?? 1_000_000 });
    if (error) throw new RelayRejected(error);
    const v = req.value;
    const msg: EncodeObject = {
      typeUrl: EXECUTE_EVM_TYPE_URL,
      value: {
        relayer: v.relayer, account: v.account, scheme: v.scheme,
        pubkey: b64(v.pubkey), signature: b64(v.signature),
        to: v.to, value: v.value, data: b64(v.data), gasLimit: v.gasLimit, nonce: v.nonce,
      },
    };
    return run(async () => {
      const sent = await deps.send(msg);
      if (sent.code !== 0) return { txHash: sent.hash, success: false, reason: `code ${sent.code}: ${sent.rawLog ?? ""}` };
      const failure = executionFailure(await deps.events(sent.hash));
      return failure ? { txHash: sent.hash, success: false, reason: failure } : { txHash: sent.hash, success: true };
    });
  };
}
