// S1: a linked ed25519 agent key acts for the spender account through MsgExecuteEVM.
//   bun src/s1-authenticator.ts link    spender links the key: permission "evm", rule allows only probe/ping
//   bun src/s1-authenticator.ts run     agent signs, relayer broadcasts: ping (allowed) and other (not allowed)
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ed25519 } from "@noble/curves/ed25519";
import {
  buildPhantomExecuteEvm,
  fetchAuthNonce,
  linkAuthenticatorMsgs,
  resolveEvmAuthDigestVersion,
  signAuthenticatorLinkEd25519,
} from "@qorechain/sdk";
import { encodeFunctionData, parseAbi, toFunctionSelector } from "viem";
import { NET, broadcast, loadAccount, pass, publicClient, saveKeyFile, txEvents } from "./lib.ts";

const PROBE = process.env.PROBE_ADDRESS as `0x${string}`;
if (!PROBE) throw new Error("set PROBE_ADDRESS in engine/spikes/.env");
const probeAbi = parseAbi(["function ping(uint256)", "function other()", "function lastSender() view returns (address)", "function lastValue() view returns (uint256)"]);

const keyFile = join(import.meta.dir, "..", ".keys", "agent-ed25519.json");
if (!existsSync(keyFile)) saveKeyFile("agent-ed25519", { privateKey: Buffer.from(ed25519.utils.randomPrivateKey()).toString("hex") });
const sk = Uint8Array.from(Buffer.from((JSON.parse(readFileSync(keyFile, "utf8")) as { privateKey: string }).privateKey, "hex"));
const pk = ed25519.getPublicKey(sk);
const wallet = { publicKey: pk, async signMessage(m: Uint8Array) { return { signature: ed25519.sign(m, sk) }; } };

const cmd = process.argv[2];
const spender = await loadAccount("spender");

if (cmd === "link") {
  const proof = signAuthenticatorLinkEd25519({ chainId: NET.chainId, account: spender.cosmos, privateKey: sk });
  const pingSel = toFunctionSelector("ping(uint256)");
  const msgs = linkAuthenticatorMsgs({
    owner: spender.cosmos,
    chainId: NET.chainId,
    ...proof,
    permissions: ["evm"],
    expiryUnix: Math.floor(Date.now() / 1000) + 7 * 24 * 3600,
    label: "qredit-s1",
    spendingRule: {
      id: "agent",
      enabled: true,
      perTxLimit: "1000000",
      dailyLimit: "5000000",
      allowedDenoms: ["uqor"],
      allowedEvmCalls: [`${PROBE.toLowerCase()}/${pingSel}`],
    },
  });
  const res = await broadcast(spender, msgs, "hybrid", "S1 link agent key");
  pass("link ed25519 key with permission evm and a selector rule", res.code === 0, res.code === 0 ? res.hash : res.rawLog);
} else if (cmd === "run") {
  const relayer = await loadAccount("relayer");
  const digestVersion = await resolveEvmAuthDigestVersion({ rest: NET.rest });
  const call = async (data: `0x${string}`) => {
    const { nonce } = await fetchAuthNonce({ rest: NET.rest, address: spender.cosmos, pubkey: pk });
    const msg = await buildPhantomExecuteEvm({ wallet, relayer: relayer.cosmos, chainId: NET.chainId, account: spender.cosmos, to: PROBE, value: "0", data: Buffer.from(data.slice(2), "hex"), gasLimit: 200000, nonce, digestVersion });
    const res = await broadcast(relayer, [msg], "hybrid", "S1 execute");
    if (res.code !== 0) return { ok: false, why: res.rawLog ?? `code ${res.code}`, hash: res.hash };
    const events = await txEvents(res.hash);
    // txEvents has no msgResponses, so success is read from the events: a refused call emits abstractaccount_execution_failed.
    const failed = (events as { type: string; attributes: { key: string; value: string }[] }[]).find((e) => e.type === "abstractaccount_execution_failed");
    const reason = failed?.attributes.find((a) => a.key === "reason")?.value ?? "";
    return { ok: !failed, why: failed ? `success=false: ${reason}` : "success (no abstractaccount_execution_failed event)", hash: res.hash };
  };
  const ping = await call(encodeFunctionData({ abi: probeAbi, functionName: "ping", args: [7n] }));
  pass("agent key calls probe.ping through the relayer", ping.ok, `${ping.hash} ${ping.why}`);
  const sender = await publicClient.readContract({ address: PROBE, abi: probeAbi, functionName: "lastSender" });
  pass("msg.sender is the spender's 0x address", sender.toLowerCase() === spender.evm.toLowerCase(), `${sender} vs ${spender.evm}`);
  const other = await call(encodeFunctionData({ abi: probeAbi, functionName: "other" }));
  pass("probe.other is refused by the selector rule", !other.ok, `${other.hash} ${other.why}`);
  const value = await publicClient.readContract({ address: PROBE, abi: probeAbi, functionName: "lastValue" });
  pass("probe state unchanged by the refused call", value === 7n, `lastValue ${value}`);
} else {
  console.log("usage: link | run");
}
