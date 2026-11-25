import { beforeEach, expect, test, vi } from "vitest";

const calls: string[] = [];
const readVault = vi.fn();
const readBalance = vi.fn();
const readAllowance = vi.fn();
const getReceipt = vi.fn();
const send = vi.fn();
const ensureWindowFor = vi.fn();
const signerFor = vi.fn();
const post = vi.fn();
const get = vi.fn();
const resolve = vi.fn();
const seal = vi.fn();

vi.mock("@/lib/chain", () => ({
  readVault: (...a: unknown[]) => readVault(...a),
  publicClient: { getTransactionReceipt: (a: unknown) => getReceipt(a) },
  restUrl: () => "http://app/api/chain/rest",
}));
vi.mock("@/lib/fusd", () => ({
  readFusdBalance: (...a: unknown[]) => readBalance(...a),
  readFusdAllowance: (...a: unknown[]) => readAllowance(...a),
}));
vi.mock("@/lib/env", () => ({ env: { chainId: "qorechain-diana", apiUrl: "http://api" } }));
vi.mock("@/lib/apiClient", async (orig) => ({
  ...(await orig<typeof import("@/lib/apiClient")>()),
  api: { post: (...a: unknown[]) => post(...a), get: (...a: unknown[]) => get(...a) },
}));
vi.mock("@/modules/wallet/signer", async (orig) => ({
  ...(await orig<typeof import("@/modules/wallet/signer")>()),
  evmSignerFor: (s: unknown) => signerFor(s),
  ensureWindowFor: (...a: unknown[]) => ensureWindowFor(...a),
}));
vi.mock("@qredit/qore", async (orig) => ({
  ...(await orig<typeof import("@qredit/qore")>()),
  createRecipientResolver: () => (a: string) => resolve(a),
  sealRequest: (...a: unknown[]) => seal(...a),
}));

import { encodeAbiParameters, encodeEventTopics, encodeFunctionData } from "viem";
import { ERC20_ABI, FUSD_ADDRESS, LOAN_VAULT_ABI, VAULT_EVENTS, envelopeHash } from "@qredit/qore";
import { ApiError } from "@/lib/apiClient";
import type { Business } from "@/lib/schemas";
import { NOT_SEALABLE_SENTENCE, fetchCard, placeOrder, readQuote, type PlaceOrderProgress } from "@/modules/orders/api/orders.api";
import type { TestSession } from "@/modules/wallet/session";
import { TxFailed, TxReverted } from "@/modules/wallet/signer";

const EVM = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as const;
const VAULT = "0x1111111111111111111111111111111111111111" as const;
const SPENDER = "0x2222222222222222222222222222222222222222" as const;
const session = { kind: "test", address: "qor1x", evm: EVM } as unknown as TestSession;
const business = { slug: "counterparty-check", vault: VAULT, spender: SPENDER } as unknown as Business;
const PRICE = 250_000n;
const TEXT = "-----BEGIN QORESEAL-----sealed";
const HASH = envelopeHash(TEXT);

function placedLog(orderId: bigint) {
  const topics = encodeEventTopics({ abi: VAULT_EVENTS, eventName: "OrderPlaced", args: { orderId, buyer: EVM } });
  const data = encodeAbiParameters(
    [{ type: "uint256" }, { type: "uint256" }, { type: "bytes32" }, { type: "uint256" }],
    [0n, PRICE, HASH, 1_800_000_000n],
  );
  return { address: VAULT, data, topics };
}

beforeEach(() => {
  vi.clearAllMocks();
  calls.length = 0;
  signerFor.mockReturnValue({ address: EVM, send });
  readVault.mockImplementation(async (_v: string, fn: string) => {
    if (fn === "servicePrice") return PRICE;
    if (fn === "orderTtl") return 3600n;
    throw new Error(`unexpected read ${fn}`);
  });
  readBalance.mockResolvedValue(10_000_000n);
  readAllowance.mockResolvedValue(0n);
  get.mockRejectedValue(new ApiError("notFound", 404));
  resolve.mockResolvedValue({ recipient: true });
  seal.mockReturnValue(TEXT);
  post.mockImplementation(async () => {
    calls.push("post");
    return { data: { hash: HASH } };
  });
  ensureWindowFor.mockImplementation(async () => {
    calls.push("window");
    return null;
  });
  send.mockImplementation(async (to: string) => {
    calls.push(to === FUSD_ADDRESS ? "approve" : "buy");
    return to === FUSD_ADDRESS ? "0xapprove" : "0xbuy";
  });
  getReceipt.mockResolvedValue({ logs: [placedLog(7n)] });
});

test("readQuote reads the price and the refund time from the vault", async () => {
  expect(await readQuote(VAULT, 0)).toEqual({ price: PRICE, ttlSeconds: 3600 });
  expect(readVault).toHaveBeenCalledWith(VAULT, "servicePrice", [0n]);
});

test("placeOrder seals, posts, opens the window, approves and buys, in that order, and decodes the order id", async () => {
  const seen: PlaceOrderProgress[] = [];
  const result = await placeOrder(session, business, 0, "0xabc", (p) => seen.push(p));
  expect(result).toEqual({ orderId: "7", buyTx: "0xbuy" });
  expect(calls).toEqual(["post", "window", "approve", "buy"]);
  expect(seen).toEqual(["sealing", "posting", "window", "approving", "buying", "placed"]);
  expect(resolve).toHaveBeenCalledWith(SPENDER);
  expect(seal.mock.calls[0]![0]).toMatchObject({ body: { v: 1, serviceId: 0, input: "0xabc" }, vault: VAULT, chainId: "qorechain-diana" });
  expect(post).toHaveBeenCalledWith("/v1/envelopes", { kind: "request", body: TEXT });
  expect(ensureWindowFor).toHaveBeenCalledWith(session, [FUSD_ADDRESS, VAULT]);
  expect(send).toHaveBeenNthCalledWith(1, FUSD_ADDRESS, encodeFunctionData({ abi: ERC20_ABI, functionName: "approve", args: [VAULT, PRICE] }));
  expect(send).toHaveBeenNthCalledWith(2, VAULT, encodeFunctionData({ abi: LOAN_VAULT_ABI, functionName: "buy", args: [0n, HASH] }));
});

test("the approval is skipped when the allowance already covers the price", async () => {
  readAllowance.mockResolvedValue(PRICE);
  const seen: PlaceOrderProgress[] = [];
  await placeOrder(session, business, 0, "0xabc", (p) => seen.push(p));
  expect(calls).toEqual(["post", "window", "buy"]);
  expect(seen).not.toContain("approving");
});

test("a hash that differs from the local one aborts before anything is paid", async () => {
  post.mockResolvedValue({ data: { hash: `0x${"1".repeat(64)}` } });
  await expect(placeOrder(session, business, 0, "0xabc", () => {})).rejects.toBeInstanceOf(TxFailed);
  expect(ensureWindowFor).not.toHaveBeenCalled();
  expect(send).not.toHaveBeenCalled();
});

test("a spender without an inbox key ends in a sentence and nothing is posted", async () => {
  resolve.mockResolvedValue(null);
  await expect(placeOrder(session, business, 0, "0xabc", () => {})).rejects.toMatchObject({ reason: NOT_SEALABLE_SENTENCE });
  expect(post).not.toHaveBeenCalled();
  expect(send).not.toHaveBeenCalled();
});

test("a wallet that holds too little fUSD is refused before sealing", async () => {
  readBalance.mockResolvedValue(PRICE - 1n);
  await expect(placeOrder(session, business, 0, "0xabc", () => {})).rejects.toBeInstanceOf(TxReverted);
  expect(resolve).not.toHaveBeenCalled();
});

test("a failed post is a sentence that says nothing was paid", async () => {
  post.mockRejectedValue(new ApiError("server", 500));
  await expect(placeOrder(session, business, 0, "0xabc", () => {})).rejects.toMatchObject({
    name: "TxFailed",
    reason: expect.stringContaining("Nothing was paid"),
  });
  expect(send).not.toHaveBeenCalled();
});

test("a payment without an OrderPlaced event is reported with its hash", async () => {
  getReceipt.mockResolvedValue({ logs: [] });
  await expect(placeOrder(session, business, 0, "0xabc", () => {})).rejects.toMatchObject({ name: "TxFailed", hash: "0xbuy" });
});

test("a session without a test wallet cannot place an order", async () => {
  signerFor.mockReturnValue(null);
  await expect(placeOrder({ kind: "none" } as never, business, 0, "0xabc", () => {})).rejects.toBeInstanceOf(TxFailed);
});

test("fetchCard returns the stored card, null for an unknown address, and rethrows other failures", async () => {
  get.mockResolvedValueOnce({ data: { card: "{\"a\":1}" } });
  expect(await fetchCard("qor1x")).toBe("{\"a\":1}");
  expect(get).toHaveBeenCalledWith("/v1/cards/qor1x");
  get.mockRejectedValueOnce(new ApiError("notFound", 404));
  expect(await fetchCard("qor1x")).toBeNull();
  get.mockRejectedValueOnce(new ApiError("server", 500));
  await expect(fetchCard("qor1x")).rejects.toBeInstanceOf(ApiError);
});
