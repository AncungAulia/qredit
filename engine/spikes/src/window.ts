// Open or inspect an account's EVM window.
//   bun src/window.ts status <name>
//   bun src/window.ts open <name> [blocks] [txs] [maxUqor] [target,target,...]
import { openEvmWindowMsg } from "@qorechain/sdk";
import { evmWindowStatus } from "@qorechain/evm";
import { NET, broadcast, loadAccount } from "./lib.ts";

const [cmd, name, blocks = "600", txs = "5", maxUqor = "20000000", targets = ""] = process.argv.slice(2);
const acc = await loadAccount(name);

if (cmd === "status") {
  const w = await evmWindowStatus({ rest: NET.rest, address: acc.cosmos });
  console.log(w.found ? JSON.stringify(w, (_, v) => (typeof v === "bigint" ? v.toString() : v), 2) : "no window");
} else if (cmd === "open") {
  const allowedTargets = targets ? targets.split(",").map((t) => t.trim().toLowerCase()) : undefined;
  const msg = openEvmWindowMsg({ sender: acc.cosmos, blocks: BigInt(blocks), maxTxs: BigInt(txs), maxValue: maxUqor, allowedTargets });
  const res = await broadcast(acc, [msg], "hybrid", "open EVM window");
  console.log(res.code === 0 ? `window opened ${res.hash} (${blocks} blocks, ${txs} txs, ${maxUqor} uqor, targets: ${targets || "any"})` : `REFUSED code ${res.code}: ${res.rawLog}`);
} else {
  console.log("usage: status <name> | open <name> [blocks] [txs] [maxUqor] [targets]");
}
