import { beforeEach, expect, test, vi } from "vitest";
import type { Net } from "@qredit/qore";
import type { UnifiedAccount } from "@qorechain/sdk";
import type { SealKeyPair } from "@qorechain/qoreseal";

const registerPqcKey = vi.fn();
const convertFusd = vi.fn();
const registerKemKey = vi.fn();
const signedCard = vi.fn();
vi.mock("@qredit/qore", () => ({
  registerPqcKey: (...a: unknown[]) => registerPqcKey(...a),
  convertFusd: (...a: unknown[]) => convertFusd(...a),
  registerKemKey: (...a: unknown[]) => registerKemKey(...a),
  signedCard: (...a: unknown[]) => signedCard(...a),
  defaultSleep: vi.fn(),
}));
const put = vi.fn();
vi.mock("@/lib/apiClient", () => ({ api: { put: (...a: unknown[]) => put(...a) } }));
vi.mock("@/lib/chain", () => ({ publicClient: {}, restUrl: () => "" }));
vi.mock("@qorechain/sdk", () => ({ fetchPqcStatus: vi.fn() }));
vi.mock("@qorechain/qoreseal/network", () => ({ fetchKemKey: vi.fn() }));
import { nextStep, runStep, setupStatus, type WalletChainStatus } from "@/modules/wallet/setup/steps";

const base: WalletChainStatus = { qor: 0n, fusdBank: 0n, fusd: 0n, pqcRegistered: false, kemRegistered: false, cardPublished: false };
const next = (s: Partial<WalletChainStatus>) => nextStep(setupStatus({ ...base, ...s }));

test("each stage of the setup points at the right next step", () => {
  expect(next({})).toBe("fund");
  expect(next({ qor: 2_000_000n, fusdBank: 50_000_000n })).toBe("registerKey");
  expect(next({ qor: 1n, fusdBank: 50_000_000n, pqcRegistered: true })).toBe("convert");
  expect(next({ qor: 1n, fusd: 50_000_000n, pqcRegistered: true })).toBe("registerKem");
  expect(next({ qor: 1n, fusd: 50_000_000n, pqcRegistered: true, kemRegistered: true })).toBe("publishCard");
  expect(next({ qor: 1n, fusd: 50_000_000n, pqcRegistered: true, kemRegistered: true, cardPublished: true })).toBeNull();
});

test("fund is done with QOR or any fUSD; convert needs the whole bank balance moved", () => {
  expect(setupStatus({ ...base, fusd: 1n }).fund).toBe("done");
  expect(setupStatus({ ...base, qor: 1n }).fund).toBe("done");
  expect(setupStatus({ ...base, qor: 1n, fusdBank: 5n, fusd: 5n }).convert).not.toBe("done");
  expect(setupStatus({ ...base, qor: 1n, fusd: 5n }).convert).toBe("done");
});

test("later steps wait while an earlier one is still to do", () => {
  const s = setupStatus(base);
  expect(s).toEqual({ fund: "todo", registerKey: "waiting", convert: "waiting", registerKem: "waiting", publishCard: "waiting" });
});

const acc = { cosmos: "qor1abc", evm: "0xabc" } as unknown as UnifiedAccount;
const sealKeys = { mlkemPublicKey: new Uint8Array([1, 2]) } as unknown as SealKeyPair;
const net = { chainId: "c", rest: "r", rpc: "p" } as Net;
const status = { ...base, fusdBank: 50_000_000n };
const sleep = vi.fn();

beforeEach(() => vi.resetAllMocks());

test("registerKey registers the ML-DSA key", async () => {
  registerPqcKey.mockResolvedValue("H1");
  expect(await runStep("registerKey", { acc, sealKeys, net, status })).toBe("H1");
  expect(registerPqcKey).toHaveBeenCalledWith(net, acc);
});

test("convert moves the whole bank balance", async () => {
  convertFusd.mockResolvedValue("H2");
  expect(await runStep("convert", { acc, sealKeys, net, status })).toBe("H2");
  expect(convertFusd).toHaveBeenCalledWith(net, acc, 50_000_000n);
});

test("registerKem registers the key and waits a block only when a transaction was sent", async () => {
  registerKemKey.mockResolvedValueOnce("H3").mockResolvedValueOnce(null);
  expect(await runStep("registerKem", { acc, sealKeys, net, status, sleep })).toBe("H3");
  expect(registerKemKey).toHaveBeenCalledWith(net, acc, sealKeys.mlkemPublicKey);
  expect(sleep).toHaveBeenCalledTimes(1);
  expect(await runStep("registerKem", { acc, sealKeys, net, status, sleep })).toBeNull();
  expect(sleep).toHaveBeenCalledTimes(1);
});

test("publishCard PUTs the signed card for the address", async () => {
  signedCard.mockReturnValue({ signed: true });
  put.mockResolvedValue({ status: 204 });
  expect(await runStep("publishCard", { acc, sealKeys, net, status })).toBeNull();
  expect(signedCard).toHaveBeenCalledWith(net, acc, sealKeys);
  expect(put).toHaveBeenCalledWith("/v1/cards/qor1abc", { card: { signed: true } });
});
