import { beforeEach, expect, test, vi } from "vitest";
import type { UnifiedAccount } from "@qorechain/sdk";

const post = vi.fn();
const get = vi.fn();
vi.mock("@/lib/apiClient", async () => {
  const actual = await vi.importActual<typeof import("@/lib/apiClient")>("@/lib/apiClient");
  return { ...actual, api: { post: (...a: unknown[]) => post(...a), get: (...a: unknown[]) => get(...a) } };
});
const readContract = vi.fn();
vi.mock("@/lib/chain", () => ({ publicClient: { readContract: (a: unknown) => readContract(a) }, restUrl: () => "http://t/rest" }));
const fetchPqcStatus = vi.fn();
const fetchKemKey = vi.fn();
vi.mock("@qorechain/sdk", () => ({ fetchPqcStatus: (a: unknown) => fetchPqcStatus(a) }));
vi.mock("@qorechain/qoreseal/network", () => ({ fetchKemKey: (a: unknown) => fetchKemKey(a) }));
import { ApiError } from "@/lib/apiClient";
import { claimFaucet, readWalletStatus } from "@/modules/wallet/api/wallet.api";

beforeEach(() => vi.resetAllMocks());

test("claimFaucet returns the transaction on success", async () => {
  post.mockResolvedValue({ status: 200, data: { tx: "ABC" } });
  expect(await claimFaucet("qor1x")).toEqual({ tx: "ABC" });
  expect(post.mock.calls[0][0]).toBe("/v1/faucet");
  expect(post.mock.calls[0][1]).toEqual({ address: "qor1x" });
});

test("claimFaucet maps a rate limit to retryAt", async () => {
  post.mockResolvedValue({ status: 429, data: { error: "x", retryAt: "2026-11-27T10:00:00.000Z" } });
  expect(await claimFaucet("qor1x")).toEqual({ retryAt: new Date("2026-11-27T10:00:00.000Z") });
});

test("claimFaucet rejects an unreadable answer", async () => {
  post.mockResolvedValue({ status: 200, data: {} });
  await expect(claimFaucet("qor1x")).rejects.toBeInstanceOf(ApiError);
});

const acc = { cosmos: "qor1x", evm: "0xabc" } as unknown as UnifiedAccount;

test("readWalletStatus combines balances, keys, card and ERC-20 balance", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ balances: [{ denom: "uqor", amount: "2000000" }, { denom: "erc20:0x97143B771D34ddb9130b807b135Ae675A5a963CA", amount: "50000000" }] }),
  }));
  fetchPqcStatus.mockResolvedValue({ registered: true });
  fetchKemKey.mockResolvedValue({ registered: false });
  get.mockRejectedValue(new ApiError("notFound", 404));
  readContract.mockResolvedValue(7n);
  expect(await readWalletStatus(acc)).toEqual({
    qor: 2_000_000n, fusdBank: 50_000_000n, fusd: 7n, pqcRegistered: true, kemRegistered: false, cardPublished: false,
  });
  expect(get).toHaveBeenCalledWith("/v1/cards/qor1x");
});

test("readWalletStatus treats an unknown account as empty and a card answer as published", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 404 }));
  fetchPqcStatus.mockResolvedValue({ registered: false });
  fetchKemKey.mockResolvedValue({ registered: false });
  get.mockResolvedValue({ data: { card: "{}" } });
  readContract.mockResolvedValue(0n);
  const s = await readWalletStatus(acc);
  expect(s.qor).toBe(0n);
  expect(s.cardPublished).toBe(true);
});
