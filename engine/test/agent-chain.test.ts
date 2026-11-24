import { describe, expect, test } from "bun:test";
import { ed25519 } from "@noble/curves/ed25519";
import { buildPhantomExecuteEvm } from "@qorechain/sdk";
import { hexToQor, PAY_SUPPLIER_SELECTOR, VAULT_ABI } from "@qredit/qore";
import { ContractFunctionRevertedError, encodeErrorResult } from "viem";
import { validateRelay } from "../../apps/be/src/services/relayer.ts";
import { createOperator, createVaultReader, paySupplierCalldata, toRelayRequest } from "../src/agent/chain.ts";

const VAULT = "0x00000000000000000000000000000000000000aa";
const SPENDER = "0x00000000000000000000000000000000000000bb";
const SUPPLIER = "0x00000000000000000000000000000000000000cc";

describe("paySupplier request", () => {
  test("calldata is 100 bytes starting with the selector", () => {
    const d = paySupplierCalldata(SUPPLIER, 5n, 7n);
    expect((d.length - 2) / 2).toBe(100);
    expect(d.startsWith(PAY_SUPPLIER_SELECTOR)).toBe(true);
  });
  test("toRelayRequest base64-encodes bytes and the result passes validateRelay", async () => {
    const sk = ed25519.utils.randomPrivateKey();
    const pk = ed25519.getPublicKey(sk);
    const wallet = { publicKey: pk, async signMessage(m: Uint8Array) { return { signature: ed25519.sign(m, sk) }; } };
    const account = hexToQor(SPENDER);
    const relayer = hexToQor("0x00000000000000000000000000000000000000dd");
    const msg = await buildPhantomExecuteEvm({
      wallet, relayer, chainId: "qorechain-diana", account, to: VAULT, value: "0",
      data: Buffer.from(paySupplierCalldata(SUPPLIER, 5n, 7n).slice(2), "hex"), gasLimit: 300000, nonce: 3n, digestVersion: "v2",
    });
    const req = toRelayRequest(msg as never);
    expect(req.value.pubkey).toBe(Buffer.from(pk).toString("base64"));
    expect(req.value.relayer).toBe(relayer);
    expect(req.value.gasLimit).toBe("300000");
    expect(req.value.nonce).toBe("3");
    expect(validateRelay(req, { relayer, vaults: new Map([[VAULT, SPENDER]]), maxGas: 1_000_000 })).toBeNull();
  });
});

describe("vault reader", () => {
  const client = {
    readContract: (async (a: { functionName: string }) =>
      ({ opexBalance: 100n, dailyCap: 50n, spentToday: 7n, dayIndex: 20000, paused: false, suppliers: [true, 9n] })[a.functionName as "paused"]) as never,
    getBlock: async () => ({ timestamp: 86400n * 20001n + 5n }),
  };
  test("funds maps reads and derives nowDay", async () => {
    expect(await createVaultReader(client).funds(VAULT)).toEqual({ opex: 100n, dailyCap: 50n, spentToday: 7n, dayIndex: 20000n, nowDay: 20001n, paused: false });
  });
  test("supplierCap is the per-tx cap, or 0 when not allowed", async () => {
    expect(await createVaultReader(client).supplierCap(VAULT, SUPPLIER)).toBe(9n);
    const off = { ...client, readContract: (async () => [false, 9n]) as never };
    expect(await createVaultReader(off).supplierCap(VAULT, SUPPLIER)).toBe(0n);
  });
});

describe("operator", () => {
  const revert = (name: "OrderNotOpen" | "NotOperator") =>
    new ContractFunctionRevertedError({ abi: VAULT_ABI, data: encodeErrorResult({ abi: VAULT_ABI, errorName: name }), functionName: "deliver" });
  const make = (simulate: () => Promise<unknown>, status = "success") => {
    const writes: unknown[] = [];
    const op = createOperator({
      privateKey: "0x01", evm: "x",
      clients: {
        pub: { simulateContract: simulate as never, waitForTransactionReceipt: async () => ({ status }) },
        wallet: { account: { address: SPENDER }, writeContract: (async (r: unknown) => { writes.push(r); return "0xabc"; }) as never },
      },
    });
    return { op, writes };
  };
  test("deliver simulates, writes and returns the tx", async () => {
    const { op, writes } = make(async () => ({ request: { r: 1 } }));
    expect(await op.deliver(VAULT, 1n, `0x${"11".repeat(32)}`)).toEqual({ tx: "0xabc", alreadyClosed: false });
    expect(writes).toEqual([{ r: 1, account: { address: SPENDER } }]); // signed by the local account, not the node
  });
  test("OrderNotOpen is an idempotent no-op; other reverts throw with the name", async () => {
    const closed = make(async () => { throw revert("OrderNotOpen"); });
    expect(await closed.op.decline(VAULT, 1n, 3)).toEqual({ tx: null, alreadyClosed: true });
    expect(closed.writes).toEqual([]);
    const other = make(async () => { throw revert("NotOperator"); });
    await expect(other.op.decline(VAULT, 1n, 3)).rejects.toThrow("NotOperator");
  });
  test("a failed receipt throws", async () => {
    await expect(make(async () => ({ request: {} }), "reverted").op.deliver(VAULT, 1n, `0x${"11".repeat(32)}`)).rejects.toThrow("reverted on chain");
  });
});
