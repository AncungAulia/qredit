import { beforeEach, expect, test, vi } from "vitest";
import type { Net } from "@qredit/qore";
import type { UnifiedAccount } from "@qorechain/sdk";
import type { SealKeyPair } from "@qorechain/qoreseal";

const registerPqcKey = vi.fn();
const convertFusd = vi.fn();
const registerKemKey = vi.fn();
const signedCard = vi.fn();
vi.mock("@qredit/qore/buyer", () => ({
  registerPqcKey: (...a: unknown[]) => registerPqcKey(...a),
  convertFusd: (...a: unknown[]) => convertFusd(...a),
  registerKemKey: (...a: unknown[]) => registerKemKey(...a),
  signedCard: (...a: unknown[]) => signedCard(...a),
  defaultSleep: vi.fn(),
}));
const putCard = vi.fn();
const readBankFusd = vi.fn();
vi.mock("@/modules/wallet/api/wallet.api", () => ({
  putCard: (...a: unknown[]) => putCard(...a),
  readBankFusd: (...a: unknown[]) => readBankFusd(...a),
}));
import { needsQorForFees, nextStep, runStep, setupStatus, type WalletChainStatus } from "@/modules/wallet/setup/steps";

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

test("convert is done when the bank balance is empty, whatever the ERC-20 balance", () => {
  expect(next({ qor: 1n, pqcRegistered: true })).toBe("registerKem");
});

test("fees: bank fUSD without QOR stays at fund and asks for QOR", () => {
  const s: WalletChainStatus = { ...base, fusdBank: 50_000_000n };
  expect(nextStep(setupStatus(s))).toBe("fund");
  expect(needsQorForFees(s)).toBe(true);
  expect(needsQorForFees({ ...s, qor: 1n })).toBe(false);
  expect(needsQorForFees(base)).toBe(false);
});

test("runStep fund sends nothing", async () => {
  expect(await runStep("fund", { acc, sealKeys, net, status })).toBeNull();
  expect(registerPqcKey).not.toHaveBeenCalled();
});

test("fund is done only with QOR; convert needs the bank balance moved", () => {
  expect(setupStatus({ ...base, fusd: 1n }).fund).not.toBe("done");
  expect(setupStatus({ ...base, qor: 1n }).fund).toBe("done");
  expect(setupStatus({ ...base, qor: 1n, fusdBank: 5n, fusd: 5n }).convert).not.toBe("done");
  expect(setupStatus({ ...base, qor: 1n, fusd: 5n }).convert).toBe("done");
});

test("later steps wait while an earlier one is still to do", () => {
  const s = setupStatus(base);
  expect(s).toEqual({ fund: "todo", registerKey: "waiting", convert: "done", registerKem: "waiting", publishCard: "waiting" });
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

test("convert moves the bank balance read right before sending", async () => {
  readBankFusd.mockResolvedValue(40_000_000n);
  convertFusd.mockResolvedValue("H2");
  expect(await runStep("convert", { acc, sealKeys, net, status })).toBe("H2");
  expect(readBankFusd).toHaveBeenCalledWith("qor1abc");
  expect(convertFusd).toHaveBeenCalledWith(net, acc, 40_000_000n);
});

test("convert sends nothing when the bank balance is already empty", async () => {
  readBankFusd.mockResolvedValue(0n);
  expect(await runStep("convert", { acc, sealKeys, net, status })).toBeNull();
  expect(convertFusd).not.toHaveBeenCalled();
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
  putCard.mockResolvedValue(undefined);
  expect(await runStep("publishCard", { acc, sealKeys, net, status })).toBeNull();
  expect(signedCard).toHaveBeenCalledWith(net, acc, sealKeys);
  expect(putCard).toHaveBeenCalledWith("qor1abc", { signed: true });
});
