import { beforeEach, expect, test, vi } from "vitest";

const call = vi.fn();
const waitForTransactionReceipt = vi.fn();
const sendTransaction = vi.fn();
const walletFor = vi.fn((...args: [string, string]) => (void args, { sendTransaction, account: { address: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" }, chain: {} }));
const ensureWindow = vi.fn();

vi.mock("@/lib/chain", () => ({ restUrl: () => "http://localhost/api/chain/rest", publicClient: { call: (a: unknown) => call(a), waitForTransactionReceipt: (a: unknown) => waitForTransactionReceipt(a) } }));
vi.mock("@qredit/qore", async (orig) => ({
  ...(await orig<typeof import("@qredit/qore")>()),
  walletFor: (pk: string, url: string) => walletFor(pk, url),
  ensureWindow: (...a: unknown[]) => ensureWindow(...a),
}));

import { BUYER_WINDOW } from "@qredit/qore";
import { encodeErrorResult } from "viem";
import { LOAN_VAULT_ABI } from "@qredit/qore";
import { ensureWindowFor, evmSignerFor, TxFailed, TxReverted } from "@/modules/wallet/signer";
import type { TestSession, WalletSession } from "@/modules/wallet/session";

const PK = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as const;
const EVM = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as const;
const TO = "0x1111111111111111111111111111111111111111" as const;
const test_: TestSession = {
  kind: "test",
  address: "qor1x",
  evm: EVM,
  account: { privateKey: PK } as never,
  sealKeys: {} as never,
};

beforeEach(() => vi.clearAllMocks());

test("no signer for none, locked and QoreX without a test wallet", () => {
  const sessions: WalletSession[] = [
    { kind: "none" },
    { kind: "locked", address: "qor1x" },
    { kind: "qorex", address: "qor1y", evm: EVM, testWallet: null },
  ];
  for (const s of sessions) expect(evmSignerFor(s)).toBeNull();
});

test("a test wallet, also under QoreX, gives a signer", () => {
  expect(evmSignerFor(test_)?.address).toBe(EVM);
  expect(evmSignerFor({ kind: "qorex", address: "qor1y", evm: EVM, testWallet: test_ })?.address).toBe(EVM);
});

test("send simulates, sends with the test key, waits for the receipt and returns the hash", async () => {
  call.mockResolvedValue({ data: "0x" });
  sendTransaction.mockResolvedValue("0xabc");
  waitForTransactionReceipt.mockResolvedValue({ status: "success" });
  const hash = await evmSignerFor(test_)!.send(TO, "0x1234");
  expect(call).toHaveBeenCalledWith(expect.objectContaining({ account: EVM, to: TO, data: "0x1234" }));
  expect(walletFor).toHaveBeenCalledWith(PK, "https://evm-testnet.qore.host");
  expect(sendTransaction).toHaveBeenCalled();
  expect(hash).toBe("0xabc");
});

test("a simulation revert throws TxReverted(null, sentence) and sends nothing", async () => {
  const data = encodeErrorResult({ abi: LOAN_VAULT_ABI, errorName: "WideningLocked" } as never);
  call.mockRejectedValue(Object.assign(new Error("execution reverted"), { cause: { data } }));
  const err = await evmSignerFor(test_)!.send(TO, "0x1234").catch((e: unknown) => e);
  expect(err).toBeInstanceOf(TxReverted);
  expect((err as TxReverted).hash).toBeNull();
  expect((err as TxReverted).reason).toBe("The vault refuses to widen its rules until the loan is repaid.");
  expect(sendTransaction).not.toHaveBeenCalled();
});

test("a reverted receipt throws TxReverted with the hash", async () => {
  call.mockResolvedValue({ data: "0x" });
  sendTransaction.mockResolvedValue("0xdef");
  waitForTransactionReceipt.mockResolvedValue({ status: "reverted", blockNumber: 77n });
  const err = await evmSignerFor(test_)!.send(TO, "0x1234").catch((e: unknown) => e);
  expect(err).toBeInstanceOf(TxReverted);
  expect((err as TxReverted).hash).toBe("0xdef");
  expect((err as TxReverted).reason).toBe("The transaction was refused.");
});

test("a reverted receipt replays the call at its block to decode the reason", async () => {
  const data = encodeErrorResult({ abi: LOAN_VAULT_ABI, errorName: "WrongState" } as never);
  call.mockResolvedValueOnce({ data: "0x" }).mockRejectedValueOnce(Object.assign(new Error("execution reverted"), { data }));
  sendTransaction.mockResolvedValue("0xdef");
  waitForTransactionReceipt.mockResolvedValue({ status: "reverted", blockNumber: 77n });
  const err = await evmSignerFor(test_)!.send(TO, "0x1234").catch((e: unknown) => e);
  expect((err as TxReverted).reason).toBe("The loan is not in a state that allows this action.");
  expect(call).toHaveBeenLastCalledWith(expect.objectContaining({ blockNumber: 77n }));
});

test("a rejected sendTransaction becomes TxFailed with a formal sentence, never raw text", async () => {
  call.mockResolvedValue({ data: "0x" });
  sendTransaction.mockRejectedValue(new Error("insufficient funds for gas * price + value: address 0xabc"));
  const err = await evmSignerFor(test_)!.send(TO, "0x1234").catch((e: unknown) => e);
  expect(err).toBeInstanceOf(TxFailed);
  expect((err as TxFailed).hash).toBeNull();
  expect((err as TxFailed).reason).toBe("The wallet has too little QOR to pay the network fee.");
  sendTransaction.mockRejectedValue(new Error("HTTP request failed. internal 500"));
  const other = await evmSignerFor(test_)!.send(TO, "0x1234").catch((e: unknown) => e);
  expect((other as TxFailed).reason).toBe("The transaction could not be sent.");
});

test("a receipt timeout becomes TxFailed that keeps the hash", async () => {
  call.mockResolvedValue({ data: "0x" });
  sendTransaction.mockResolvedValue("0xdef");
  waitForTransactionReceipt.mockRejectedValue(Object.assign(new Error("Timed out while waiting"), { name: "WaitForTransactionReceiptTimeoutError" }));
  const err = await evmSignerFor(test_)!.send(TO, "0x1234").catch((e: unknown) => e);
  expect(err).toBeInstanceOf(TxFailed);
  expect((err as TxFailed).hash).toBe("0xdef");
  expect((err as TxFailed).reason).toMatch(/not confirmed in time/);
});

test("sends from one address never overlap, so two sends never share a nonce", async () => {
  call.mockResolvedValue({ data: "0x" });
  let active = 0;
  let maxActive = 0;
  sendTransaction.mockImplementation(async () => {
    active++;
    maxActive = Math.max(maxActive, active);
    await new Promise((r) => setTimeout(r, 10));
    active--;
    return "0xabc";
  });
  waitForTransactionReceipt.mockResolvedValue({ status: "success" });
  const signer = evmSignerFor(test_)!;
  await Promise.all([signer.send(TO, "0x01"), signer.send(TO, "0x02"), evmSignerFor(test_)!.send(TO, "0x03")]);
  expect(sendTransaction).toHaveBeenCalledTimes(3);
  expect(maxActive).toBe(1);
});

test("a failed send does not block the next one in the queue", async () => {
  call.mockResolvedValueOnce({ data: "0x" }).mockRejectedValueOnce(new Error("x")).mockResolvedValue({ data: "0x" });
  sendTransaction.mockResolvedValue("0xabc");
  waitForTransactionReceipt.mockResolvedValue({ status: "success" });
  const signer = evmSignerFor(test_)!;
  const results = await Promise.allSettled([signer.send(TO, "0x01"), signer.send(TO, "0x02"), signer.send(TO, "0x03")]);
  expect(results.map((r) => r.status)).toEqual(["fulfilled", "rejected", "fulfilled"]);
});

test("ensureWindowFor is null without a test wallet and uses browserNet and BUYER_WINDOW with one", async () => {
  expect(await ensureWindowFor({ kind: "none" }, ["0xaa"])).toBeNull();
  expect(ensureWindow).not.toHaveBeenCalled();
  ensureWindow.mockResolvedValue("TXHASH");
  const out = await ensureWindowFor({ kind: "qorex", address: "q", evm: EVM, testWallet: test_ }, ["0xaa"]);
  expect(out).toBe("TXHASH");
  const [net, acc, targets, opts] = ensureWindow.mock.calls[0] as [{ chainId: string }, unknown, string[], unknown];
  expect(net.chainId).toBe("qorechain-diana");
  expect(acc).toBe(test_.account);
  expect(targets).toEqual(["0xaa"]);
  expect(opts).toEqual(BUYER_WINDOW);
});
