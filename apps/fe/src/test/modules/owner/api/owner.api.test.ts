import { beforeEach, expect, test, vi } from "vitest";

const readVault = vi.fn();
const call = vi.fn();
const getBlock = vi.fn();
const snapshot = vi.fn();
const send = vi.fn();
const ensureWindowFor = vi.fn();
const signerFor = vi.fn();

vi.mock("@/lib/chain", () => ({
  readVault: (...a: unknown[]) => readVault(...a),
  publicClient: { call: (a: unknown) => call(a), getBlock: () => getBlock() },
}));
vi.mock("@/modules/market/api/market.api", () => ({ readVaultSnapshot: (v: string) => snapshot(v) }));
vi.mock("@/modules/wallet/signer", async (orig) => ({
  ...(await orig<typeof import("@/modules/wallet/signer")>()),
  evmSignerFor: (s: unknown) => signerFor(s),
  ensureWindowFor: (...a: unknown[]) => ensureWindowFor(...a),
}));

import { decodeFunctionData, encodeErrorResult, stringToHex } from "viem";
import { LOAN_VAULT_ABI } from "@qredit/qore";
import { VAULT_ERROR_SENTENCES } from "@/components/shared/vaultErrors";
import type { Business } from "@/lib/schemas";
import { applyOrder, buildOrder, ownedVaults, readRules, simulateApply } from "@/modules/owner/api/owner.api";
import type { PolicyOrder } from "@/modules/owner/schemas/policyOrder.schema";
import type { TestSession } from "@/modules/wallet/session";
import { TxFailed, TxReverted } from "@/modules/wallet/signer";

const OWNER = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as const;
const OTHER = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC" as const;
const V1 = "0x1111111111111111111111111111111111111111" as const;
const V2 = "0x2222222222222222222222222222222222222222" as const;
const ZERO = "0x0000000000000000000000000000000000000000" as const;
const biz = (vault: `0x${string}`, slug: string) => ({ slug, vault, name: slug }) as unknown as Business;
const session = { kind: "test", address: "qor1x", evm: OTHER } as unknown as TestSession;
const order: PolicyOrder = { kind: 2, target: ZERO, value: 40_000_000n, nonce: 3n, expiry: 1_800_000_000n };
const sig = Uint8Array.from([1, 2, 3]);

beforeEach(() => {
  vi.clearAllMocks();
  signerFor.mockReturnValue({ address: OTHER, send });
  send.mockResolvedValue("0xabc");
});

test("ownedVaults keeps the vaults whose owner key address is the connected account, ignoring case", async () => {
  readVault.mockImplementation(async (v: string, fn: string) => {
    expect(fn).toBe("ownerPq");
    return v === V1 ? OWNER.toLowerCase() : OTHER;
  });
  const owned = await ownedVaults(OWNER, [biz(V1, "a"), biz(V2, "b")]);
  expect(owned.map((b) => b.slug)).toEqual(["a"]);
});

test("ownedVaults fails as a whole when one vault cannot be read", async () => {
  readVault.mockImplementation(async (v: string) => {
    if (v === V2) throw new Error("rpc down");
    return OWNER;
  });
  await expect(ownedVaults(OWNER, [biz(V1, "a"), biz(V2, "b")])).rejects.toThrow("rpc down");
});

const READS: Record<string, bigint | string> = {
  dailyCap: 50_000_000n,
  spentToday: 18_000_000n,
  ownerPending: 3_000_000n,
  expectedRepaid: 20_000_000n,
  spender: "0x01",
  operator: "0x02",
  ownerPq: "0x03",
  ownerPayout: "0x04",
};
const setReads = (over: Record<string, bigint | string> = {}) =>
  readVault.mockImplementation(async (_v: string, fn: string) => ({ ...READS, ...over })[fn]);

test("readRules joins the snapshot with the daily cap, the spend of today and the owner share", async () => {
  getBlock.mockResolvedValue({ timestamp: 1_800_000_000n });
  snapshot.mockResolvedValue({ state: "Active", paused: false, repaid: 29n, totalOwed: 100n, period: 86_400n, bondHeld: 7n });
  setReads();
  expect(await readRules(V1)).toEqual({
    state: "Active",
    paused: false,
    repaid: 29n,
    totalOwed: 100n,
    dailyCap: 50_000_000n,
    spentToday: 18_000_000n,
    ownerPending: 3_000_000n,
    bondHeld: 7n,
    claimAhead: false,
    spender: "0x01",
    operator: "0x02",
    vault: V1,
    ownerPq: "0x03",
    ownerPayout: "0x04",
  });
});

test("the owner claim is allowed only one installment ahead", async () => {
  getBlock.mockResolvedValue({ timestamp: 1_800_000_000n });
  snapshot.mockResolvedValue({ state: "Active", paused: false, repaid: 20_000_000n, totalOwed: 100_000_000n, period: 86_400n });
  setReads();
  expect((await readRules(V1)).claimAhead).toBe(true);
  expect(readVault).toHaveBeenCalledWith(V1, "expectedRepaid", [1_800_086_400n]);
  snapshot.mockResolvedValue({ state: "Active", paused: false, repaid: 19_000_000n, totalOwed: 100_000_000n, period: 86_400n });
  expect((await readRules(V1)).claimAhead).toBe(false);
  snapshot.mockResolvedValue({ state: "Repaid", paused: false, repaid: 1n, totalOwed: 100_000_000n, period: 86_400n });
  expect((await readRules(V1)).claimAhead).toBe(true);
});

test("buildOrder reads the nonce and the text the vault wants signed", async () => {
  readVault.mockImplementation(async (_v: string, fn: string, args?: unknown[]) => {
    if (fn === "policyNonce") return 7n;
    expect(fn).toBe("orderText");
    expect((args?.[0] as PolicyOrder).nonce).toBe(7n);
    return stringToHex("qredit-order-v1:0xabc");
  });
  // the clock of the chain, not the one of the browser
  getBlock.mockResolvedValue({ timestamp: BigInt(Date.UTC(2026, 10, 26, 12, 0, 0) / 1000) });
  const built = await buildOrder(V1, { kind: 2, target: ZERO, value: 40_000_000n, expiryMinutes: 30 });
  expect(built.text).toBe("qredit-order-v1:0xabc");
  expect(built.order).toEqual({
    kind: 2,
    target: ZERO,
    value: 40_000_000n,
    nonce: 7n,
    expiry: BigInt(Date.UTC(2026, 10, 26, 12, 30, 0) / 1000),
  });
});

test("simulateApply is ok when the call goes through and sends the encoded order", async () => {
  call.mockResolvedValue({ data: "0x" });
  expect(await simulateApply(V1, order, sig, OTHER)).toEqual({ ok: true });
  const sent = call.mock.calls[0][0] as { to: string; data: `0x${string}`; account: string };
  expect(sent.to).toBe(V1);
  expect(sent.account).toBe(OTHER);
  const decoded = decodeFunctionData({ abi: LOAN_VAULT_ABI, data: sent.data });
  expect(decoded.functionName).toBe("applyOrder");
  expect(decoded.args?.[1]).toBe("0x010203");
});

test("simulateApply decodes a vault refusal into its sentence", async () => {
  const data = encodeErrorResult({ abi: LOAN_VAULT_ABI, errorName: "WideningLocked" });
  call.mockRejectedValue(Object.assign(new Error("execution reverted"), { data }));
  expect(await simulateApply(V1, order, sig)).toEqual({ ok: false, reason: VAULT_ERROR_SENTENCES.WideningLocked });
});

test("simulateApply never shows raw data for an error it cannot decode", async () => {
  call.mockRejectedValue(new Error("0xdeadbeef boom"));
  const result = await simulateApply(V1, order, sig);
  expect(result).toEqual({ ok: false, reason: "The transaction was refused." });
});

test("applyOrder opens the window for the vault and sends from the test wallet", async () => {
  expect(await applyOrder(session, V1, order, sig)).toBe("0xabc");
  expect(ensureWindowFor).toHaveBeenCalledWith(session, [V1]);
  const [to, data] = send.mock.calls[0] as [string, `0x${string}`];
  expect(to).toBe(V1);
  expect(decodeFunctionData({ abi: LOAN_VAULT_ABI, data }).functionName).toBe("applyOrder");
});

test("applyOrder without a test wallet sends nothing", async () => {
  signerFor.mockReturnValue(null);
  await expect(applyOrder({ kind: "none" }, V1, order, sig)).rejects.toBeInstanceOf(TxFailed);
  expect(send).not.toHaveBeenCalled();
});

test("applyOrder passes a refusal of the send on as TxReverted", async () => {
  send.mockRejectedValue(new TxReverted(null, "no"));
  await expect(applyOrder(session, V1, order, sig)).rejects.toBeInstanceOf(TxReverted);
});

test("a stale nonce or an expired order tells the owner to sign a new one", async () => {
  for (const name of ["BadNonce", "OrderExpiredSig"] as const) {
    const data = encodeErrorResult({ abi: LOAN_VAULT_ABI, errorName: name });
    call.mockRejectedValue(Object.assign(new Error("execution reverted"), { data }));
    expect(await simulateApply(V1, order, sig)).toEqual({
      ok: false,
      reason: `${VAULT_ERROR_SENTENCES[name]} Go back and sign a new order.`,
    });
  }
});

test("a send that reverts with a stale nonce carries the same hint", async () => {
  send.mockRejectedValue(new TxReverted("0xdead", VAULT_ERROR_SENTENCES.BadNonce));
  const error = await applyOrder(session, V1, order, sig).catch((e) => e);
  expect(error).toBeInstanceOf(TxReverted);
  expect(error.reason).toBe(`${VAULT_ERROR_SENTENCES.BadNonce} Go back and sign a new order.`);
  expect(error.hash).toBe("0xdead");
});
