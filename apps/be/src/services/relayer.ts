import type { EncodeObject } from "@cosmjs/proto-signing";
import { executionFailure, PAY_SUPPLIER_SELECTOR, qorToHex, type RestEvent, type Sent, serial, TxFailedOnChain } from "@qredit/qore";

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
export type RelayFailureCode = "not_broadcast" | "refused" | "unconfirmed" | "execution_failed";
export type RelayResult = { txHash: string; success: true } | { txHash: string; success: false; code: RelayFailureCode; reason: string };

export class RelayRejected extends Error {}

const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const b64 = (s: string) => Uint8Array.from(Buffer.from(s, "base64"));

const FIELDS = ["relayer", "account", "scheme", "pubkey", "signature", "to", "value", "data", "gasLimit", "nonce"] as const;
const PAY_SUPPLIER_CALLDATA_BYTES = 4 + 3 * 32;
const PUBKEY_LENGTHS: Record<string, number[]> = { ed25519: [32], secp256k1: [20, 33] };
const SIGNATURE_LENGTHS: Record<string, number[]> = { ed25519: [64], secp256k1: [64, 65] };

/** ctx.vaults maps a vault (lowercase 0x) to its registered spender (lowercase 0x). */
export type RelayContext = { relayer: string; vaults: Map<string, string>; maxGas: number };

export function validateRelay(req: RelayRequest, ctx: RelayContext): string | null {
  if (req.typeUrl !== EXECUTE_EVM_TYPE_URL) return `wrong message type: only ${EXECUTE_EVM_TYPE_URL} is relayed`;
  const v = req.value as Record<string, unknown> | undefined;
  if (!v || typeof v !== "object") return "the message value is missing";
  for (const f of FIELDS) if (typeof v[f] !== "string") return `${f} must be a string`;
  const m = req.value;
  for (const f of ["pubkey", "signature", "data"] as const) if (!BASE64.test(m[f])) return `${f} must be strict base64`;
  if (m.relayer !== ctx.relayer) return "the message must name this relayer";
  const spender = /^0x[0-9a-fA-F]{40}$/.test(m.to) ? ctx.vaults.get(m.to.toLowerCase()) : undefined;
  if (spender === undefined) return "the target is not a Qredit vault";
  if (qorToHex(m.account) !== spender) return "the account is not the registered spender of this vault";
  if (m.value !== "0") return "value must be 0";
  if (!/^[0-9]+$/.test(m.gasLimit) || Number(m.gasLimit) > ctx.maxGas || Number(m.gasLimit) === 0) return `gas limit must be 1..${ctx.maxGas}`;
  if (!/^[0-9]+$/.test(m.nonce)) return "nonce must be a decimal integer";
  const pubkeyLengths = PUBKEY_LENGTHS[m.scheme];
  if (!pubkeyLengths) return 'scheme must be "ed25519" or "secp256k1"';
  if (!pubkeyLengths.includes(b64(m.pubkey).length)) return `pubkey must be ${pubkeyLengths.join(" or ")} bytes for ${m.scheme}`;
  if (!SIGNATURE_LENGTHS[m.scheme]!.includes(b64(m.signature).length)) return `signature must be ${SIGNATURE_LENGTHS[m.scheme]!.join(" or ")} bytes for ${m.scheme}`;
  const data = b64(m.data);
  if (data.length !== PAY_SUPPLIER_CALLDATA_BYTES) return `calldata must be ${PAY_SUPPLIER_CALLDATA_BYTES} bytes`;
  const selector = `0x${Buffer.from(data.subarray(0, 4)).toString("hex")}`;
  if (selector !== PAY_SUPPLIER_SELECTOR) return "only vault.paySupplier is relayed";
  return null;
}

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const normalise = (m: Map<string, string>) => new Map([...m].map(([k, s]) => [k.toLowerCase(), s.toLowerCase()]));

export function createRelayer(deps: {
  relayerAddress: string;
  /** vault 0x -> registered spender 0x (keys are lowercased here). */
  vaults: () => Promise<Map<string, string>>;
  send: (msg: EncodeObject) => Promise<Sent>;
  events: (hash: string) => Promise<RestEvent[]>;
  maxGas?: number;
}): (req: RelayRequest) => Promise<RelayResult> {
  const run = serial();
  return async (req) => {
    const error = validateRelay(req, { relayer: deps.relayerAddress, vaults: normalise(await deps.vaults()), maxGas: deps.maxGas ?? 1_000_000 });
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
    return run(async (): Promise<RelayResult> => {
      let sent: Sent;
      try {
        sent = await deps.send(msg);
      } catch (e) {
        return { txHash: "", success: false, code: "not_broadcast", reason: errorText(e) };
      }
      const txHash = sent.hash;
      if (sent.code !== 0) return { txHash, success: false, code: "refused", reason: `code ${sent.code}: ${sent.rawLog ?? ""}` };
      try {
        const failure = executionFailure(await deps.events(txHash));
        return failure ? { txHash, success: false, code: "execution_failed", reason: failure } : { txHash, success: true };
      } catch (e) {
        return { txHash, success: false, code: e instanceof TxFailedOnChain ? "execution_failed" : "unconfirmed", reason: errorText(e) };
      }
    });
  };
}
