import { beforeEach, expect, test, vi } from "vitest";
import { generateSealKeys, recipientCardFields, type SealKeyPair } from "@qorechain/qoreseal";
import type { UnifiedAccount } from "@qorechain/sdk";

const post = vi.fn();
const get = vi.fn();
vi.mock("@/lib/apiClient", async () => {
  const actual = await vi.importActual<typeof import("@/lib/apiClient")>("@/lib/apiClient");
  return { ...actual, api: { post: (...a: unknown[]) => post(...a), get: (...a: unknown[]) => get(...a) } };
});
const readContract = vi.fn();
vi.mock("@/lib/chain", () => ({ publicClient: { readContract: (a: unknown) => readContract(a) }, restUrl: () => "http://t/rest" }));
vi.mock("@/lib/env", () => ({ env: { chainId: "test-chain" } }));
const fetchPqcStatus = vi.fn();
const fetchKemKey = vi.fn();
vi.mock("@qorechain/sdk", () => ({ fetchPqcStatus: (a: unknown) => fetchPqcStatus(a) }));
vi.mock("@qorechain/qoreseal/network", () => ({ fetchKemKey: (a: unknown) => fetchKemKey(a) }));
import { ApiError } from "@/lib/apiClient";
import { claimFaucet, hasCard, readWalletStatus } from "@/modules/wallet/api/wallet.api";

beforeEach(() => vi.resetAllMocks());

test("claimFaucet returns the transaction on success", async () => {
  post.mockResolvedValue({ status: 200, data: { tx: "ABC" } });
  expect(await claimFaucet("qor1v8xz07tyn92d8j5a0uzulhxtgprsnh6sy9n589")).toEqual({ tx: "ABC" });
  expect(post.mock.calls[0][0]).toBe("/v1/faucet");
  expect(post.mock.calls[0][1]).toEqual({ address: "qor1v8xz07tyn92d8j5a0uzulhxtgprsnh6sy9n589" });
});

test("claimFaucet maps a rate limit to retryAt", async () => {
  post.mockResolvedValue({ status: 429, data: { error: "x", retryAt: "2026-11-27T10:00:00.000Z" } });
  expect(await claimFaucet("qor1v8xz07tyn92d8j5a0uzulhxtgprsnh6sy9n589")).toEqual({ retryAt: new Date("2026-11-27T10:00:00.000Z") });
});

test("claimFaucet rejects an unreadable answer", async () => {
  post.mockResolvedValue({ status: 200, data: {} });
  await expect(claimFaucet("qor1v8xz07tyn92d8j5a0uzulhxtgprsnh6sy9n589")).rejects.toBeInstanceOf(ApiError);
});

test("claimFaucet passes a server refusal (daily cap) on as an ApiError", async () => {
  post.mockRejectedValue(new ApiError("server", 503));
  await expect(claimFaucet("qor1v8xz07tyn92d8j5a0uzulhxtgprsnh6sy9n589")).rejects.toMatchObject({ kind: "server", status: 503 });
});

test("hasCard is false for 404 and rethrows any other error", async () => {
  get.mockRejectedValueOnce(new ApiError("notFound", 404));
  expect(await hasCard("qor1v8xz07tyn92d8j5a0uzulhxtgprsnh6sy9n589")).toBe(false);
  get.mockRejectedValueOnce(new ApiError("server", 500));
  await expect(hasCard("qor1v8xz07tyn92d8j5a0uzulhxtgprsnh6sy9n589")).rejects.toMatchObject({ kind: "server" });
  get.mockRejectedValueOnce(new ApiError("network"));
  await expect(hasCard("qor1v8xz07tyn92d8j5a0uzulhxtgprsnh6sy9n589")).rejects.toMatchObject({ kind: "network" });
});

const acc = { cosmos: "qor1v8xz07tyn92d8j5a0uzulhxtgprsnh6sy9n589", evm: "0xabc" } as unknown as UnifiedAccount;
const keys: SealKeyPair = generateSealKeys();
const other: SealKeyPair = generateSealKeys();
const cardFor = (k: SealKeyPair) => recipientCardFields({ chainId: "test-chain", address: "qor1v8xz07tyn92d8j5a0uzulhxtgprsnh6sy9n589", keys: k });
const chainKey = (k: SealKeyPair) => ({ registered: true, publicKey: k.mlkemPublicKey });
const balances = (list: { denom: string; amount: string }[]) =>
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ balances: list }) }));
const BANK = "erc20:0x97143B771D34ddb9130b807b135Ae675A5a963CA";

test("readWalletStatus combines balances, keys, card and ERC-20 balance", async () => {
  balances([{ denom: "uqor", amount: "2000000" }, { denom: BANK, amount: "50000000" }]);
  fetchPqcStatus.mockResolvedValue({ registered: true });
  fetchKemKey.mockResolvedValue(chainKey(keys));
  get.mockResolvedValue({ data: { card: JSON.stringify({ ...cardFor(keys), signature: {} }) } });
  readContract.mockResolvedValue(7n);
  expect(await readWalletStatus(acc, keys)).toEqual({
    qor: 2_000_000n, fusdBank: 50_000_000n, fusd: 7n, pqcRegistered: true, kemRegistered: true, cardPublished: true,
  });
  expect(get).toHaveBeenCalledWith("/v1/cards/qor1v8xz07tyn92d8j5a0uzulhxtgprsnh6sy9n589");
});

test("a chain KEM key that differs from the session keys is not registered", async () => {
  balances([]);
  fetchPqcStatus.mockResolvedValue({ registered: true });
  fetchKemKey.mockResolvedValue(chainKey(other));
  get.mockResolvedValue({ data: { card: { ...cardFor(keys), signature: {} } } });
  readContract.mockResolvedValue(0n);
  expect((await readWalletStatus(acc, keys)).kemRegistered).toBe(false);
});

test("a card for other keys, or an unreadable card, is not a published card", async () => {
  balances([]);
  fetchPqcStatus.mockResolvedValue({ registered: true });
  fetchKemKey.mockResolvedValue(chainKey(keys));
  readContract.mockResolvedValue(0n);
  get.mockResolvedValue({ data: { card: { ...cardFor(other), signature: {} } } });
  expect((await readWalletStatus(acc, keys)).cardPublished).toBe(false);
  get.mockResolvedValue({ data: { card: "not json" } });
  expect((await readWalletStatus(acc, keys)).cardPublished).toBe(false);
});

test("a fresh account (empty answers everywhere) reads as empty and not registered", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 404 }));
  fetchPqcStatus.mockResolvedValue({ registered: false });
  fetchKemKey.mockResolvedValue({ registered: false });
  get.mockRejectedValue(new ApiError("notFound", 404));
  readContract.mockResolvedValue(0n);
  expect(await readWalletStatus(acc, keys)).toEqual({
    qor: 0n, fusdBank: 0n, fusd: 0n, pqcRegistered: false, kemRegistered: false, cardPublished: false,
  });
});

test("any other read failure rejects the status", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500 }));
  fetchPqcStatus.mockResolvedValue({ registered: false });
  fetchKemKey.mockResolvedValue({ registered: false });
  get.mockRejectedValue(new ApiError("notFound", 404));
  readContract.mockResolvedValue(0n);
  await expect(readWalletStatus(acc, keys)).rejects.toBeInstanceOf(ApiError);
  balances([]);
  fetchKemKey.mockRejectedValue(new Error("registry unavailable"));
  await expect(readWalletStatus(acc, keys)).rejects.toThrow("registry unavailable");
});
