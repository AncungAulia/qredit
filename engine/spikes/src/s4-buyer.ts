// S4: can a buyer approve and move fUSD (6 decimals, ERC-20 form) through a window scoped to [fUSD, probe]?
//   bun --env-file=.env src/s4-buyer.ts open    buyer opens the scoped window (hybrid)
//   bun --env-file=.env src/s4-buyer.ts run     approve + transfer, then a call outside the window targets (must be refused)
import { openEvmWindowMsg } from "@qorechain/sdk";
import { parseAbi } from "viem";
import { broadcast, loadAccount, pass, publicClient, uqorBalance, walletFor } from "./lib.ts";

const FUSD = "0x97143B771D34ddb9130b807b135Ae675A5a963CA" as const;
const FACTORY = "0xAc5324088A7735dda922c277db5A2E906c8f5b3A" as const;
const PROBE = process.env.PROBE_ADDRESS as `0x${string}`;
const ONE = 1_000_000n; // 1 fUSD
const abi = parseAbi(["function approve(address,uint256) returns (bool)", "function transfer(address,uint256) returns (bool)", "function allowance(address,address) view returns (uint256)"]);

const buyer = await loadAccount("buyer");
const cmd = process.argv[2];

if (cmd === "open") {
  const m = openEvmWindowMsg({ sender: buyer.cosmos, blocks: 600n, maxTxs: 4n, maxValue: "20000000", allowedTargets: [FUSD.toLowerCase(), PROBE.toLowerCase()] });
  const res = await broadcast(buyer, [m], "hybrid", "S4 buyer window");
  pass("buyer opens a window scoped to fUSD and the probe", res.code === 0, res.code === 0 ? res.hash : res.rawLog);
} else if (cmd === "run") {
  const w = walletFor(buyer.privateKey as `0x${string}`);
  const q0 = await uqorBalance(buyer.cosmos);
  const a = await w.writeContract({ address: FUSD, abi, functionName: "approve", args: [PROBE, ONE] });
  pass("approve 1 fUSD through the window", (await publicClient.waitForTransactionReceipt({ hash: a })).status === "success", a);
  const t = await w.writeContract({ address: FUSD, abi, functionName: "transfer", args: [PROBE, ONE], gas: 200_000n });
  pass("transfer 1 fUSD through the window", (await publicClient.waitForTransactionReceipt({ hash: t })).status === "success", t);
  const q1 = await uqorBalance(buyer.cosmos);
  console.log(`QOR spent on the EVM txs so far: ${Number(q0 - q1) / 1e6}`);
  try {
    const h = await w.sendTransaction({ to: FACTORY, data: "0x", value: 0n, gas: 100_000n });
    const r = await publicClient.waitForTransactionReceipt({ hash: h });
    pass("call outside the window targets is refused", false, `accepted: ${h} status ${r.status}`);
  } catch (e) {
    pass("call outside the window targets is refused", true, (e as Error).message.split("\n").slice(0, 3).join(" | "));
  }
} else {
  console.log("usage: open | run");
}
