import { beforeEach, expect, test, vi } from "vitest";

const call = vi.fn();
const waitForTransactionReceipt = vi.fn();
const prepareTransactionRequest = vi.fn();
const sendRawTransaction = vi.fn();
const signTransaction = vi.fn();
const walletFor = vi.fn(
  (...args: [string, string]) => (
    void args,
    {
      prepareTransactionRequest,
      sendRawTransaction,
      account: { address: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8", signTransaction },
      chain: {},
    }
  ),
);
const ensureWindow = vi.fn();

vi.mock("@/lib/chain", () => ({ restUrl: () => "http://localhost/api/chain/rest", publicClient: { call: (a: unknown) => call(a), waitForTransactionReceipt: (a: unknown) => waitForTransactionReceipt(a) } }));
vi.mock("@qredit/qore/net", async (orig) => ({
  ...(await orig<typeof import("@qredit/qore/net")>()),
  walletFor: (pk: string, url: string) => walletFor(pk, url),
}));
vi.mock("@qredit/qore/buyer", async (orig) => ({
  ...(await orig<typeof import("@qredit/qore/buyer")>()),
  ensureWindow: (...a: unknown[]) => ensureWindow(...a),
}));

import { BUYER_WINDOW } from "@qredit/qore";
import { encodeErrorResult, keccak256 } from "viem";
import { LOAN_VAULT_ABI } from "@qredit/qore";
import { mayHaveSpent } from "@/components/shared/ChainAction";
import { ensureWindowFor, evmSignerFor, TxFailed, TxReverted, withAccountLock } from "@/modules/wallet/signer";
import type { TestSession, WalletSession } from "@/modules/wallet/session";

const PK = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as const;
const EVM = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as const;
const ADDR_B = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC" as const;
const TO = "0x1111111111111111111111111111111111111111" as const;
const test_: TestSession = {
  kind: "test",
  address: "qor1x",
  evm: EVM,
  account: { privateKey: PK } as never,
  sealKeys: {} as never,
};

const SIGNED = "0x02f86e01" as const;
const HASH = keccak256(SIGNED);

beforeEach(() => {
  vi.clearAllMocks();
  prepareTransactionRequest.mockImplementation(async (r: object) => ({ ...r, nonce: 1, gas: 21000n }));
  signTransaction.mockResolvedValue(SIGNED);
  sendRawTransaction.mockResolvedValue(HASH);
});

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

test("send simulates, prepares, signs, sends the raw transaction, waits for the receipt and returns the hash", async () => {
  call.mockResolvedValue({ data: "0x" });
  waitForTransactionReceipt.mockResolvedValue({ status: "success" });
  const hash = await evmSignerFor(test_)!.send(TO, "0x1234");
  expect(call).toHaveBeenCalledWith(expect.objectContaining({ account: EVM, to: TO, data: "0x1234" }));
  expect(walletFor).toHaveBeenCalledWith(PK, "https://evm-testnet.qore.host");
  expect(prepareTransactionRequest).toHaveBeenCalledWith(expect.objectContaining({ to: TO, data: "0x1234" }));
  expect(signTransaction).toHaveBeenCalledWith(expect.objectContaining({ nonce: 1 }));
  expect(sendRawTransaction).toHaveBeenCalledWith({ serializedTransaction: SIGNED });
  expect(waitForTransactionReceipt).toHaveBeenCalledWith({ hash: HASH });
  expect(hash).toBe(HASH);
});

test("sendForReceipt returns the hash with the receipt, so callers need no second lookup", async () => {
  call.mockResolvedValue({ data: "0x" });
  const receipt = { status: "success", logs: [{ address: TO }] };
  waitForTransactionReceipt.mockResolvedValue(receipt);
  expect(await evmSignerFor(test_)!.sendForReceipt(TO, "0x1234")).toEqual({ hash: HASH, receipt });
});

test("a simulation revert throws TxReverted(null, sentence) and sends nothing", async () => {
  const data = encodeErrorResult({ abi: LOAN_VAULT_ABI, errorName: "WideningLocked" } as never);
  call.mockRejectedValue(Object.assign(new Error("execution reverted"), { cause: { data } }));
  const err = await evmSignerFor(test_)!.send(TO, "0x1234").catch((e: unknown) => e);
  expect(err).toBeInstanceOf(TxReverted);
  expect((err as TxReverted).hash).toBeNull();
  expect((err as TxReverted).reason).toBe("The vault refuses to widen its rules until the loan is repaid.");
  expect(sendRawTransaction).not.toHaveBeenCalled();
});

test("a reverted receipt throws TxReverted with the hash", async () => {
  call.mockResolvedValue({ data: "0x" });
  waitForTransactionReceipt.mockResolvedValue({ status: "reverted", blockNumber: 77n });
  const err = await evmSignerFor(test_)!.send(TO, "0x1234").catch((e: unknown) => e);
  expect(err).toBeInstanceOf(TxReverted);
  expect((err as TxReverted).hash).toBe(HASH);
  expect((err as TxReverted).reason).toBe("The transaction was refused.");
});

test("a reverted receipt replays the call at its block to decode the reason", async () => {
  const data = encodeErrorResult({ abi: LOAN_VAULT_ABI, errorName: "WrongState" } as never);
  call.mockResolvedValueOnce({ data: "0x" }).mockRejectedValueOnce(Object.assign(new Error("execution reverted"), { data }));
  waitForTransactionReceipt.mockResolvedValue({ status: "reverted", blockNumber: 77n });
  const err = await evmSignerFor(test_)!.send(TO, "0x1234").catch((e: unknown) => e);
  expect((err as TxReverted).reason).toBe("The loan is not in a state that allows this action.");
  expect(call).toHaveBeenLastCalledWith(expect.objectContaining({ blockNumber: 77n }));
});

test("a request that cannot be prepared is TxFailed without a hash and with a formal sentence, never raw text", async () => {
  call.mockResolvedValue({ data: "0x" });
  prepareTransactionRequest.mockRejectedValue(new Error("insufficient funds for gas * price + value: address 0xabc"));
  const err = await evmSignerFor(test_)!.send(TO, "0x1234").catch((e: unknown) => e);
  expect(err).toBeInstanceOf(TxFailed);
  expect((err as TxFailed).hash).toBeNull();
  expect((err as TxFailed).reason).toBe("The wallet has too little QOR to pay the network fee.");
  prepareTransactionRequest.mockRejectedValue(new Error("HTTP request failed. internal 500"));
  const other = await evmSignerFor(test_)!.send(TO, "0x1234").catch((e: unknown) => e);
  expect((other as TxFailed).reason).toBe("The transaction could not be sent.");
  expect(signTransaction).not.toHaveBeenCalled();
});

test("a send that times out after signing keeps the hash, so no second payment is offered", async () => {
  call.mockResolvedValue({ data: "0x" });
  sendRawTransaction.mockRejectedValue(Object.assign(new Error("The request timed out."), { name: "TimeoutError" }));
  const err = await evmSignerFor(test_)!.send(TO, "0x1234").catch((e: unknown) => e);
  expect(err).toBeInstanceOf(TxFailed);
  expect((err as TxFailed).hash).toBe(HASH);
  expect((err as TxFailed).reason).toMatch(/may have been sent/i);
  expect(mayHaveSpent(err)).toBe(true);
  expect(waitForTransactionReceipt).not.toHaveBeenCalled();
});

test("any other failure after signing also keeps the hash", async () => {
  call.mockResolvedValue({ data: "0x" });
  sendRawTransaction.mockRejectedValue(new Error("HTTP request failed. internal 500"));
  const err = await evmSignerFor(test_)!.send(TO, "0x1234").catch((e: unknown) => e);
  expect((err as TxFailed).hash).toBe(HASH);
  expect(mayHaveSpent(err)).toBe(true);
});

const rpcError = (message: string, code = -32000) =>
  Object.assign(new Error(message), { name: "RpcRequestError", code });

test.each([
  ["insufficient funds", "insufficient funds for gas * price + value", "The wallet has too little QOR to pay the network fee."],
  ["nonce too low", "nonce too low", "The transaction could not be sent."],
])("a JSON-RPC answer that rejects the transaction (%s) means nothing entered the mempool: no hash", async (_n, message, reason) => {
  call.mockResolvedValue({ data: "0x" });
  sendRawTransaction.mockRejectedValue(rpcError(message));
  const err = await evmSignerFor(test_)!.send(TO, "0x1234").catch((e: unknown) => e);
  expect(err).toBeInstanceOf(TxFailed);
  expect((err as TxFailed).hash).toBeNull();
  expect((err as TxFailed).reason).toBe(reason);
  expect(mayHaveSpent(err)).toBe(false);
});

test("a rejection that wraps the JSON-RPC error in its cause is still a rejection", async () => {
  call.mockResolvedValue({ data: "0x" });
  sendRawTransaction.mockRejectedValue(Object.assign(new Error("Nonce provided is too low."), { name: "NonceTooLowError", cause: rpcError("nonce too low") }));
  const err = await evmSignerFor(test_)!.send(TO, "0x1234").catch((e: unknown) => e);
  expect((err as TxFailed).hash).toBeNull();
});

test("an answer that says the transaction is already known keeps the hash: it is in the mempool", async () => {
  call.mockResolvedValue({ data: "0x" });
  sendRawTransaction.mockRejectedValue(rpcError("already known"));
  const err = await evmSignerFor(test_)!.send(TO, "0x1234").catch((e: unknown) => e);
  expect((err as TxFailed).hash).toBe(HASH);
});

test("a transport failure after signing keeps the hash", async () => {
  call.mockResolvedValue({ data: "0x" });
  sendRawTransaction.mockRejectedValue(Object.assign(new Error("HTTP request failed."), { name: "HttpRequestError" }));
  const err = await evmSignerFor(test_)!.send(TO, "0x1234").catch((e: unknown) => e);
  expect((err as TxFailed).hash).toBe(HASH);
});

test("a signing failure has no hash: nothing left the browser", async () => {
  call.mockResolvedValue({ data: "0x" });
  signTransaction.mockRejectedValue(new Error("bad key"));
  const err = await evmSignerFor(test_)!.send(TO, "0x1234").catch((e: unknown) => e);
  expect((err as TxFailed).hash).toBeNull();
  expect(sendRawTransaction).not.toHaveBeenCalled();
});

test("a receipt timeout becomes TxFailed that keeps the hash", async () => {
  call.mockResolvedValue({ data: "0x" });
  waitForTransactionReceipt.mockRejectedValue(Object.assign(new Error("Timed out while waiting"), { name: "WaitForTransactionReceiptTimeoutError" }));
  const err = await evmSignerFor(test_)!.send(TO, "0x1234").catch((e: unknown) => e);
  expect(err).toBeInstanceOf(TxFailed);
  expect((err as TxFailed).hash).toBe(HASH);
  expect((err as TxFailed).reason).toMatch(/not confirmed in time/);
});

test("two locked jobs on one address never overlap or interleave, and run in the order they were asked", async () => {
  const events: string[] = [];
  const job = (name: string) => async () => {
    events.push(`${name}:start`);
    await new Promise((r) => setTimeout(r, 10));
    events.push(`${name}:end`);
    return name;
  };
  const out = await Promise.all([withAccountLock(EVM, job("a")), withAccountLock(EVM, job("b")), withAccountLock(EVM, job("c"))]);
  expect(out).toEqual(["a", "b", "c"]);
  expect(events).toEqual(["a:start", "a:end", "b:start", "b:end", "c:start", "c:end"]);
});

test("the lock ignores the case of the address", async () => {
  const events: string[] = [];
  const job = (name: string) => async () => {
    events.push(`${name}:start`);
    await new Promise((r) => setTimeout(r, 5));
    events.push(`${name}:end`);
  };
  await Promise.all([withAccountLock(EVM, job("a")), withAccountLock(EVM.toLowerCase(), job("b"))]);
  expect(events).toEqual(["a:start", "a:end", "b:start", "b:end"]);
});

test("jobs on different addresses run side by side", async () => {
  let active = 0;
  let max = 0;
  const job = async () => {
    active++;
    max = Math.max(max, active);
    await new Promise((r) => setTimeout(r, 10));
    active--;
  };
  await Promise.all([withAccountLock(EVM, job), withAccountLock(ADDR_B, job)]);
  expect(max).toBe(2);
});

test("a failed job releases the lock for the next one", async () => {
  const results = await Promise.allSettled([
    withAccountLock(EVM, async () => "ok"),
    withAccountLock(EVM, async () => {
      throw new Error("x");
    }),
    withAccountLock(EVM, async () => "after"),
  ]);
  expect(results.map((r) => r.status)).toEqual(["fulfilled", "rejected", "fulfilled"]);
  expect((results[2] as PromiseFulfilledResult<string>).value).toBe("after");
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
