import { describe, expect, test } from "bun:test";
import { encodeFunctionData, parseAbi } from "viem";
import { hexToQor } from "../src/chain/address.ts";
import { createRelayer, EXECUTE_EVM_TYPE_URL, type RelayRequest, RelayRejected, validateRelay } from "../src/relayer.ts";

const VAULT = "0x00000000000000000000000000000000000000aa";
const SPENDER = "0x00000000000000000000000000000000000000dd";
const RELAYER = "qor1relayer";
const abi = parseAbi(["function paySupplier(address,uint256,uint256)", "function deliver(uint256,bytes32)"]);
const b64 = (hex: `0x${string}`) => Buffer.from(hex.slice(2), "hex").toString("base64");

const req = (over: Partial<RelayRequest["value"]> = {}, typeUrl = EXECUTE_EVM_TYPE_URL): RelayRequest => ({
  typeUrl,
  value: {
    relayer: RELAYER, account: hexToQor(SPENDER), scheme: "ed25519",
    pubkey: Buffer.alloc(32, 1).toString("base64"), signature: Buffer.alloc(64, 2).toString("base64"),
    to: VAULT, value: "0",
    data: b64(encodeFunctionData({ abi, functionName: "paySupplier", args: ["0x00000000000000000000000000000000000000cc", 1000n, 1n] })),
    gasLimit: "200000", nonce: "3", ...over,
  },
});
const ctx = { relayer: RELAYER, vaults: new Map([[VAULT, SPENDER]]), maxGas: 1_000_000 };

describe("validateRelay", () => {
  test("accepts a paySupplier call to a known vault", () => {
    expect(validateRelay(req(), ctx)).toBeNull();
    expect(validateRelay(req({ to: VAULT.toUpperCase().replace("0X", "0x") }), ctx)).toBeNull();
  });
  test("strict field rules", () => {
    const calldata = Buffer.from(req().value.data, "base64");
    expect(validateRelay(req({ nonce: 3 as unknown as string }), ctx)).toMatch(/nonce must be a string/);
    expect(validateRelay(req({ data: Buffer.concat([calldata, Buffer.alloc(1)]).toString("base64") }), ctx)).toMatch(/100 bytes/);
    expect(validateRelay(req({ data: calldata.subarray(0, 99).toString("base64") }), ctx)).toMatch(/100 bytes/);
    expect(validateRelay(req({ scheme: "rsa" }), ctx)).toMatch(/scheme/);
    expect(validateRelay(req({ pubkey: Buffer.alloc(33, 1).toString("base64") }), ctx)).toMatch(/pubkey/);
    expect(validateRelay(req({ signature: Buffer.alloc(65, 1).toString("base64") }), ctx)).toMatch(/signature/);
    expect(validateRelay(req({ scheme: "secp256k1", pubkey: Buffer.alloc(33, 1).toString("base64"), signature: Buffer.alloc(65, 1).toString("base64") }), ctx)).toBeNull();
    expect(validateRelay(req({ account: hexToQor("0x00000000000000000000000000000000000000ee") }), ctx)).toMatch(/spender/);
    expect(validateRelay(req({ account: "qor1notbech32" }), ctx)).toMatch(/spender/);
  });
  test("refuses everything else", () => {
    expect(validateRelay(req({}, "/cosmos.bank.v1beta1.MsgSend"), ctx)).toMatch(/type/);
    expect(validateRelay(req({ relayer: "qor1other" }), ctx)).toMatch(/relayer/);
    expect(validateRelay(req({ to: "0x00000000000000000000000000000000000000ff" }), ctx)).toMatch(/vault/);
    expect(validateRelay(req({ value: "1" }), ctx)).toMatch(/value/);
    expect(validateRelay(req({ gasLimit: "5000000" }), ctx)).toMatch(/gas/);
    expect(validateRelay(req({ data: Buffer.concat([Buffer.alloc(4, 0xab), Buffer.from(req().value.data, "base64").subarray(4)]).toString("base64") }), ctx)).toMatch(/paySupplier/);
    expect(validateRelay(req({ nonce: "x" }), ctx)).toMatch(/nonce/);
  });
});

describe("createRelayer", () => {
  const deps = (events: { type: string; attributes: { key: string; value: string }[] }[], code = 0) => {
    const sent: unknown[] = [];
    return {
      sent,
      relay: createRelayer({
        relayerAddress: RELAYER,
        vaults: async () => new Map([[VAULT.toUpperCase().replace("0X", "0x"), SPENDER]]),
        send: async (msg) => { sent.push(msg); return { hash: "ABC", code, rawLog: code ? "out of gas" : undefined }; },
        events: async () => events,
      }),
    };
  };

  test("decodes base64 fields and reports success", async () => {
    const { sent, relay } = deps([{ type: "message", attributes: [] }]);
    expect(await relay(req())).toEqual({ txHash: "ABC", success: true });
    const msg = sent[0] as { typeUrl: string; value: { pubkey: Uint8Array; data: Uint8Array; nonce: string } };
    expect(msg.typeUrl).toBe(EXECUTE_EVM_TYPE_URL);
    expect(msg.value.pubkey).toBeInstanceOf(Uint8Array);
    expect(msg.value.pubkey.length).toBe(32);
    expect(Buffer.from(msg.value.data.slice(0, 4)).toString("hex")).toBe(Buffer.from(req().value.data, "base64").subarray(0, 4).toString("hex"));
  });

  test("a refused execution is reported as failure, not success", async () => {
    const { relay } = deps([{ type: "abstractaccount_execution_failed", attributes: [{ key: "reason", value: "over daily cap" }] }]);
    expect(await relay(req())).toEqual({ txHash: "ABC", success: false, reason: "over daily cap" });
  });

  test("a tx refused at CheckTx is a failure", async () => {
    const { relay } = deps([], 11);
    expect(await relay(req())).toEqual({ txHash: "ABC", success: false, reason: "code 11: out of gas" });
  });

  test("a send that throws is a failure result", async () => {
    const relay = createRelayer({ relayerAddress: RELAYER, vaults: async () => new Map([[VAULT, SPENDER]]), send: async () => { throw new Error("rpc down"); }, events: async () => [] });
    expect(await relay(req())).toEqual({ txHash: "", success: false, reason: "rpc down" });
  });

  test("an events failure keeps the hash", async () => {
    const relay = createRelayer({ relayerAddress: RELAYER, vaults: async () => new Map([[VAULT, SPENDER]]), send: async () => ({ hash: "ABC", code: 0 }), events: async () => { throw new Error("tx not found"); } });
    expect(await relay(req())).toEqual({ txHash: "ABC", success: false, reason: "tx not found" });
  });

  test("invalid requests are rejected before signing", async () => {
    const { sent, relay } = deps([]);
    await expect(relay(req({ value: "5" }))).rejects.toBeInstanceOf(RelayRejected);
    expect(sent.length).toBe(0);
  });
});
