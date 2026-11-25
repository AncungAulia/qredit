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
import { ensureWindowFor, evmSignerFor, TxReverted } from "@/modules/wallet/signer";
import type { TestSession, WalletSession } from "@/modules/wallet/session";

const PK = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as const;
const EVM = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as const;
const TO = "0x1111111111111111111111111111111111111111" as const;
const NET = { chainId: "qorechain-diana", rest: "r", rpc: "p", evm: "e" };
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
  for (const s of sessions) expect(evmSignerFor(s, NET)).toBeNull();
});

test("a test wallet, also under QoreX, gives a signer", () => {
  expect(evmSignerFor(test_, NET)?.address).toBe(EVM);
  expect(evmSignerFor({ kind: "qorex", address: "qor1y", evm: EVM, testWallet: test_ }, NET)?.address).toBe(EVM);
});

test("send simulates, sends with the test key, waits for the receipt and returns the hash", async () => {
  call.mockResolvedValue({ data: "0x" });
  sendTransaction.mockResolvedValue("0xabc");
  waitForTransactionReceipt.mockResolvedValue({ status: "success" });
  const hash = await evmSignerFor(test_, NET)!.send(TO, "0x1234");
  expect(call).toHaveBeenCalledWith(expect.objectContaining({ account: EVM, to: TO, data: "0x1234" }));
  expect(walletFor).toHaveBeenCalledWith(PK, "e");
  expect(sendTransaction).toHaveBeenCalled();
  expect(hash).toBe("0xabc");
});

test("a simulation revert throws TxReverted(null, sentence) and sends nothing", async () => {
  const data = encodeErrorResult({ abi: LOAN_VAULT_ABI, errorName: "WideningLocked" } as never);
  call.mockRejectedValue(Object.assign(new Error("execution reverted"), { cause: { data } }));
  const err = await evmSignerFor(test_, NET)!.send(TO, "0x1234").catch((e: unknown) => e);
  expect(err).toBeInstanceOf(TxReverted);
  expect((err as TxReverted).hash).toBeNull();
  expect((err as TxReverted).reason).toBe("The vault refuses to widen its rules until the loan is repaid.");
  expect(sendTransaction).not.toHaveBeenCalled();
});

test("a reverted receipt throws TxReverted with the hash", async () => {
  call.mockResolvedValue({ data: "0x" });
  sendTransaction.mockResolvedValue("0xdef");
  waitForTransactionReceipt.mockResolvedValue({ status: "reverted" });
  const err = await evmSignerFor(test_, NET)!.send(TO, "0x1234").catch((e: unknown) => e);
  expect(err).toBeInstanceOf(TxReverted);
  expect((err as TxReverted).hash).toBe("0xdef");
  expect((err as TxReverted).reason).toBe("The transaction was refused.");
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
