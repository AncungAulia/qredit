import { beforeEach, expect, test, vi } from "vitest";

const readVault = vi.fn();
const readContract = vi.fn();
const snapshot = vi.fn();
const send = vi.fn();
const ensureWindowFor = vi.fn();
const signerFor = vi.fn();

vi.mock("@/lib/chain", () => ({
  readVault: (...a: unknown[]) => readVault(...a),
  publicClient: { readContract: (a: unknown) => readContract(a) },
}));
vi.mock("@/modules/market/api/market.api", () => ({ readVaultSnapshot: (v: string) => snapshot(v) }));
vi.mock("@/modules/wallet/signer", async (orig) => ({
  ...(await orig<typeof import("@/modules/wallet/signer")>()),
  evmSignerFor: (s: unknown) => signerFor(s),
  ensureWindowFor: (...a: unknown[]) => ensureWindowFor(...a),
}));

import { encodeFunctionData } from "viem";
import { ERC20_ABI, FUSD_ADDRESS, LOAN_VAULT_ABI } from "@qredit/qore";
import { VAULT_ERROR_SENTENCES, ERC20_ERROR_SENTENCES } from "@/components/shared/vaultErrors";
import type { Business } from "@/lib/schemas";
import {
  RAISE_FULL_SENTENCE,
  claim,
  lend,
  readFusdBalance,
  readPositions,
  refund,
} from "@/modules/lend/api/lend.api";
import type { TestSession } from "@/modules/wallet/session";
import { TxFailed, TxReverted } from "@/modules/wallet/signer";

const EVM = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as const;
const V1 = "0x1111111111111111111111111111111111111111" as const;
const V2 = "0x2222222222222222222222222222222222222222" as const;
const session = { kind: "test", address: "qor1x", evm: EVM } as unknown as TestSession;
const biz = (vault: `0x${string}`, slug: string) => ({ slug, vault, name: slug }) as unknown as Business;
const fusd = (n: number) => BigInt(n) * 1_000_000n;

beforeEach(() => {
  vi.clearAllMocks();
  signerFor.mockReturnValue({ address: EVM, send });
  send.mockResolvedValueOnce("0xaaa").mockResolvedValueOnce("0xbbb");
});

function vaultReads(over: { state?: number; raised?: bigint; target?: bigint } = {}) {
  const { state = 0, raised = fusd(100), target = fusd(1000) } = over;
  readVault.mockImplementation(async (_v: string, fn: string) => {
    if (fn === "state") return state;
    if (fn === "raised") return raised;
    if (fn === "loan") return [target, 0n, 0n, 0n, 0n, 0n];
    throw new Error(`unexpected read ${fn}`);
  });
}
function fusdReads(balance: bigint, allowance: bigint) {
  readContract.mockImplementation(async ({ functionName }: { functionName: string }) =>
    functionName === "balanceOf" ? balance : allowance,
  );
}

test("readPositions keeps only vaults where the lender has a deposit and maps the reads", async () => {
  readVault.mockImplementation(async (v: string, fn: string) => {
    if (fn === "deposits") return v === V1 ? fusd(500) : 0n;
    if (fn === "lenderClaimable") return fusd(18);
    if (fn === "lenderClaimed") return fusd(151);
    throw new Error(`unexpected read ${fn}`);
  });
  snapshot.mockResolvedValue({ state: "Active" });
  const rows = await readPositions(EVM, [biz(V1, "a"), biz(V2, "b")]);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    business: { slug: "a" },
    vault: { state: "Active" },
    deposit: fusd(500),
    claimable: fusd(18),
    claimed: fusd(151),
  });
  expect(snapshot).toHaveBeenCalledTimes(1);
  expect(readVault).toHaveBeenCalledWith(V1, "deposits", [EVM]);
});

test("readPositions is empty when the lender has no deposit anywhere", async () => {
  readVault.mockResolvedValue(0n);
  expect(await readPositions(EVM, [biz(V1, "a")])).toEqual([]);
});

test("readFusdBalance reads the fUSD balance of the address", async () => {
  readContract.mockResolvedValue(fusd(7));
  expect(await readFusdBalance(EVM)).toBe(fusd(7));
  expect(readContract).toHaveBeenCalledWith(expect.objectContaining({ address: FUSD_ADDRESS, functionName: "balanceOf", args: [EVM] }));
});

test("lend opens the window for fUSD and the vault, approves when the allowance is short, then deposits", async () => {
  vaultReads();
  fusdReads(fusd(1000), 0n);
  const onSent = vi.fn();
  const result = await lend(session, V1, fusd(500), onSent);
  expect(ensureWindowFor).toHaveBeenCalledWith(session, [FUSD_ADDRESS, V1]);
  expect(send).toHaveBeenNthCalledWith(1, FUSD_ADDRESS, encodeFunctionData({ abi: ERC20_ABI, functionName: "approve", args: [V1, fusd(500)] }));
  expect(send).toHaveBeenNthCalledWith(2, V1, encodeFunctionData({ abi: LOAN_VAULT_ABI, functionName: "deposit", args: [fusd(500)] }));
  expect(result).toEqual({ approveTx: "0xaaa", depositTx: "0xbbb" });
  expect(onSent).toHaveBeenCalledTimes(1);
  expect(ensureWindowFor.mock.invocationCallOrder[0]).toBeLessThan(send.mock.invocationCallOrder[0]);
});

test("lend skips the approval when the allowance already covers the amount", async () => {
  vaultReads();
  fusdReads(fusd(1000), fusd(500));
  send.mockReset();
  send.mockResolvedValueOnce("0xbbb");
  const result = await lend(session, V1, fusd(500));
  expect(send).toHaveBeenCalledTimes(1);
  expect(result).toEqual({ depositTx: "0xbbb" });
});

test("lend refuses with the raise-is-full sentence when the vault is not raising", async () => {
  vaultReads({ state: 1 });
  fusdReads(fusd(1000), 0n);
  await expect(lend(session, V1, fusd(5))).rejects.toMatchObject({ name: "TxReverted", reason: RAISE_FULL_SENTENCE });
  expect(send).not.toHaveBeenCalled();
  expect(ensureWindowFor).not.toHaveBeenCalled();
});

test("lend refuses an amount above the room left instead of lending less", async () => {
  vaultReads({ raised: fusd(990), target: fusd(1000) });
  fusdReads(fusd(1000), 0n);
  await expect(lend(session, V1, fusd(50))).rejects.toMatchObject({ reason: VAULT_ERROR_SENTENCES.OverTarget });
  expect(send).not.toHaveBeenCalled();
});

test("lend refuses when the balance is too low", async () => {
  vaultReads();
  fusdReads(fusd(1), 0n);
  const error = await lend(session, V1, fusd(50)).catch((e) => e);
  expect(error).toBeInstanceOf(TxReverted);
  expect(error.reason).toBe(ERC20_ERROR_SENTENCES.ERC20InsufficientBalance);
  expect(send).not.toHaveBeenCalled();
});

test("lend without a test wallet says so and sends nothing", async () => {
  signerFor.mockReturnValue(null);
  const error = await lend(session, V1, fusd(5)).catch((e) => e);
  expect(error).toBeInstanceOf(TxFailed);
  expect(error.reason).toMatch(/test wallet/i);
});

test("claim and refund send the vault call after the window", async () => {
  send.mockReset();
  send.mockResolvedValue("0xccc");
  expect(await claim(session, V1)).toBe("0xccc");
  expect(send).toHaveBeenLastCalledWith(V1, encodeFunctionData({ abi: LOAN_VAULT_ABI, functionName: "claimLender" }));
  expect(await refund(session, V1)).toBe("0xccc");
  expect(send).toHaveBeenLastCalledWith(V1, encodeFunctionData({ abi: LOAN_VAULT_ABI, functionName: "refund" }));
  expect(ensureWindowFor).toHaveBeenCalledWith(session, [V1]);
});

test("a claim and a refund on one wallet do not interleave: each takes its window and sends before the next starts", async () => {
  const seen: string[] = [];
  const wait = () => new Promise((r) => setTimeout(r, 5));
  ensureWindowFor.mockImplementation(async (_s: unknown, targets: string[]) => {
    seen.push(`window ${targets[0] === V1 ? "v1" : "v2"}`);
    await wait();
    return null;
  });
  send.mockReset();
  send.mockImplementation(async (to: string) => {
    seen.push(`send ${to === V1 ? "v1" : "v2"}`);
    await wait();
    return "0xccc";
  });
  await Promise.all([claim(session, V1), refund(session, V2)]);
  expect(seen).toEqual(["window v1", "send v1", "window v2", "send v2"]);
});

test("a failed claim releases the lock for the next action", async () => {
  send.mockReset();
  send.mockRejectedValueOnce(new TxReverted(null, "no")).mockResolvedValueOnce("0xddd");
  const results = await Promise.allSettled([claim(session, V1), refund(session, V1)]);
  expect(results.map((r) => r.status)).toEqual(["rejected", "fulfilled"]);
});
