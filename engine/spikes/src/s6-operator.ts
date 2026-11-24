// S6: can an operator act with ONLY its classical private key, inside a scoped
// window that only the owner (holding the ML-DSA-87 recovery code) can open?
//   bun src/s6-operator.ts open      owner side: hybrid tx, window scoped to PROBE_ADDRESS
//   bun src/s6-operator.ts run       runtime side: reads only OPERATOR_PRIVATE_KEY
import { openEvmWindowMsg } from "@qorechain/sdk";
import { MAX_EVM_WINDOW_BLOCKS } from "@qorechain/evm";
import { encodeFunctionData, parseAbi } from "viem";
import { broadcast, loadAccount, pass, publicClient, walletFor } from "./lib.ts";

const probeAbi = parseAbi(["function ping(uint256)", "function lastSender() view returns (address)"]);
const erc20Abi = parseAbi(["function transfer(address,uint256) returns (bool)"]);
const PROBE = process.env.PROBE_ADDRESS as `0x${string}`;
const FUSD = "0x97143B771D34ddb9130b807b135Ae675A5a963CA" as const;
if (!PROBE) throw new Error("set PROBE_ADDRESS in engine/spikes/.env");

const cmd = process.argv[2];

if (cmd === "open") {
  const op = await loadAccount("operator");
  // Try the longest window first, to learn the real limit.
  const msg = openEvmWindowMsg({ sender: op.cosmos, blocks: MAX_EVM_WINDOW_BLOCKS, maxTxs: 20n, maxValue: "50000000", allowedTargets: [PROBE.toLowerCase()] });
  const res = await broadcast(op, [msg], "hybrid", "S6 scoped window");
  pass(`open a ${MAX_EVM_WINDOW_BLOCKS}-block window scoped to the probe`, res.code === 0, res.code === 0 ? res.hash : res.rawLog);
} else if (cmd === "run") {
  const key = process.env.OPERATOR_PRIVATE_KEY as `0x${string}` | undefined;
  if (!key) throw new Error("set OPERATOR_PRIVATE_KEY (only the classical key) in engine/spikes/.env");
  const w = walletFor(key);
  const hash = await w.sendTransaction({ to: PROBE, data: encodeFunctionData({ abi: probeAbi, functionName: "ping", args: [6n] }) });
  const rcpt = await publicClient.waitForTransactionReceipt({ hash });
  const sender = await publicClient.readContract({ address: PROBE, abi: probeAbi, functionName: "lastSender" });
  pass("classical key alone calls the allowed target", rcpt.status === "success", hash);
  pass("msg.sender is the operator's 0x address", sender.toLowerCase() === w.account.address.toLowerCase(), sender);
  try {
    const bad = await w.sendTransaction({ to: FUSD, data: encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [w.account.address, 0n] }) });
    pass("call to a target outside the window is refused", false, `was accepted: ${bad}`);
  } catch (e) {
    pass("call to a target outside the window is refused", true, String((e as Error).message).slice(0, 160));
  }
} else {
  console.log("usage: open | run");
}
