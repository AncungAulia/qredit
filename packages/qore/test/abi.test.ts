import { describe, expect, test } from "bun:test";
import { encodeFunctionData } from "viem";
import { convertCoinMsg, FACTORY_ABI, FUSD_DENOM, MsgConvertCoinType, PAY_SUPPLIER_SELECTOR, qoreRegistry, VAULT_ABI } from "../src/index.ts";

describe("abi", () => {
  test("paySupplier calldata starts with the selector and is 100 bytes", () => {
    const data = encodeFunctionData({ abi: VAULT_ABI, functionName: "paySupplier", args: ["0x00000000000000000000000000000000000000cc", 1n, 2n] });
    expect(data.slice(0, 10)).toBe(PAY_SUPPLIER_SELECTOR);
    expect((data.length - 2) / 2).toBe(100);
  });
  test("factory create encodes a v2 Init tuple (no token, maturity terms)", () => {
    const data = encodeFunctionData({ abi: FACTORY_ABI, functionName: "create", args: [{
      spender: "0x0000000000000000000000000000000000000001", operator: "0x0000000000000000000000000000000000000002",
      ownerPq: "0x0000000000000000000000000000000000000003", ownerPayout: "0x0000000000000000000000000000000000000003", cosmosChainId: "qorechain-diana",
      lenderBps: 3000, ownerBps: 2000, dailyCap: 1n, orderTtl: 3600n,
      loan: { target: 10n, totalOwed: 10n, raiseDeadline: 2n, period: 1n, grace: 0n, installment: 10n, maturity: 1n, maturityGrace: 0n, defaultAfterMissed: 3 },
      suppliers: [], supplierCaps: [], servicePrices: [1n],
    }] });
    expect(data.startsWith("0x")).toBe(true);
  });
});

describe("MsgConvertCoin", () => {
  test("round-trips through the registry", () => {
    const msg = convertCoinMsg("qor1sender", "0x00000000000000000000000000000000000000aa", 300_000_000n);
    expect(msg.value.coin.denom).toBe(FUSD_DENOM);
    const bytes = MsgConvertCoinType.encode(MsgConvertCoinType.fromPartial(msg.value)).finish();
    expect(MsgConvertCoinType.decode(bytes)).toEqual({ coin: { denom: FUSD_DENOM, amount: "300000000" }, receiver: "0x00000000000000000000000000000000000000aa", sender: "qor1sender" });
    expect(qoreRegistry().lookupType("/cosmos.evm.erc20.v1.MsgConvertCoin")).toBeDefined();
  });
});
