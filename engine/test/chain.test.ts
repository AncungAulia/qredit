import { describe, expect, test } from "bun:test";
import { ed25519 } from "@noble/curves/ed25519";
import { FACTORY_ABI, FACTORY_ADDRESS, FACTORY_START_BLOCK } from "@qredit/qore";
import { encodeAbiParameters, encodeEventTopics } from "viem";
import { agentLinkMsgs, bondApproval, findExistingVault, matchVaultLog, vaultFromReceipt } from "../src/setup/chain.ts";

const V = "0x00000000000000000000000000000000000000aa";
describe("existing vault lookup", () => {
  const log = (o: { address?: string; spender?: string; vault?: string; block?: bigint }) => ({
    address: o.address ?? FACTORY_ADDRESS, args: { vault: o.vault ?? V, spender: o.spender ?? "0xAB" }, blockNumber: o.block ?? 10n, transactionHash: "0xh",
  });
  test("matches this factory and this spender only", () => {
    expect(matchVaultLog([log({ spender: "0xcd" })], "0xab")).toBeNull();
    expect(matchVaultLog([log({ address: "0x00000000000000000000000000000000000000ff" })], "0xab")).toBeNull();
    expect(matchVaultLog([log({ spender: "0xcd" }), log({ block: 77n })], "0xab")).toEqual({ vault: V, startBlock: 77, tx: "0xh" });
  });
  test("scans from the factory start block in chunks, filtered by ownerPq", async () => {
    const calls: { fromBlock: bigint; toBlock: bigint; args: unknown }[] = [];
    const c = {
      getBlockNumber: async () => BigInt(FACTORY_START_BLOCK + 3224),
      getLogs: async (p: (typeof calls)[number]) => { calls.push(p); return p.fromBlock === BigInt(FACTORY_START_BLOCK + 2000) ? [log({})] : []; },
    };
    const found = await findExistingVault("0xOwner", "0xab", c as never);
    expect(found?.vault).toBe(V);
    expect(calls[0].fromBlock).toBe(BigInt(FACTORY_START_BLOCK));
    expect(calls.every((x) => x.toBlock - x.fromBlock < 2000n)).toBe(true);
    expect(calls[0].args).toEqual({ ownerPq: "0xOwner" });
  });
});

describe("treasury window", () => {
  test("is its own object with its own values, not the buyer window", async () => {
    const { BUYER_WINDOW } = await import("@qredit/qore");
    const { TREASURY_WINDOW } = await import("../src/setup/chain.ts");
    expect(TREASURY_WINDOW).not.toBe(BUYER_WINDOW);
    expect(TREASURY_WINDOW).toEqual({ blocks: 3600, maxTxs: 40, maxValue: 60_000_000n });
  });
});

describe("v2 vault creation", () => {
  test("approves the bond only when the allowance is short", () => {
    expect(bondApproval(0n, 50_000_000n)).toBe(5_000_000n);
    expect(bondApproval(4_999_999n, 50_000_000n)).toBe(5_000_000n);
    expect(bondApproval(5_000_000n, 50_000_000n)).toBeNull();
  });
  test("reads the vault from the factory's VaultCreated log", () => {
    const vault = "0x00000000000000000000000000000000000000aa";
    const topics = encodeEventTopics({ abi: FACTORY_ABI, eventName: "VaultCreated", args: { vault, ownerPq: "0x00000000000000000000000000000000000000bb" } });
    const data = encodeAbiParameters([{ type: "address" }, { type: "address" }, { type: "uint256" }], ["0x00000000000000000000000000000000000000cc", "0x00000000000000000000000000000000000000dd", 0n]);
    expect(vaultFromReceipt([{ address: FACTORY_ADDRESS, data, topics: topics as `0x${string}`[] }])).toBe(vault);
    expect(vaultFromReceipt([{ address: "0x00000000000000000000000000000000000000ff", data, topics: topics as `0x${string}`[] }])).toBeNull();
  });
});

describe("agent link for the v2 vault", () => {
  const secret = ed25519.utils.randomPrivateKey();
  const agent = { secret, publicKey: ed25519.getPublicKey(secret) };
  const base = { spenderCosmos: "qor1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq", agent, vault: "0x00000000000000000000000000000000000000aa", nowSeconds: 1_900_000_000 };
  test("revokes the v1 link first when asked", () => {
    const fresh = agentLinkMsgs({ ...base, revokeFirst: false });
    const relink = agentLinkMsgs({ ...base, revokeFirst: true });
    expect(relink.length).toBe(fresh.length + 1);
    expect(relink[0]!.typeUrl).toBe("/qorechain.abstractaccount.v1.MsgRevokeAuthenticator");
    expect(relink.slice(1).map((m) => m.typeUrl)).toEqual(fresh.map((m) => m.typeUrl));
  });
});
