// S5: fUSD facts. The faucet pays fUSD as a bank coin; contracts use the ERC-20 form.
//   bun src/s5-fusd.ts info <name...>
//   bun src/s5-fusd.ts convert <name> <fusd>       MsgConvertCoin, bank coin -> ERC-20
//   bun src/s5-fusd.ts send <from> <to> <fusd>     ERC-20 transfer (sender needs an open window)
import { formatUnits, parseAbi, parseUnits } from "viem";
import { qorechainRegistry } from "@qorechain/sdk";
import { MSG_CONVERT_COIN, MsgConvertCoinType } from "./erc20.ts";
import { NET, broadcast, loadAccount, pass, publicClient, txEvents, uqorBalance, walletFor } from "./lib.ts";

const FUSD = "0x97143B771D34ddb9130b807b135Ae675A5a963CA" as const;
const DENOM = `erc20:${FUSD}`;
const abi = parseAbi([
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function balanceOf(address) view returns (uint256)",
  "function transfer(address,uint256) returns (bool)",
]);

const [cmd, ...args] = process.argv.slice(2);
const decimals = await publicClient.readContract({ address: FUSD, abi, functionName: "decimals" });
const symbol = await publicClient.readContract({ address: FUSD, abi, functionName: "symbol" });

async function bankFusd(cosmos: string): Promise<bigint> {
  const res = await fetch(`${NET.rest}/cosmos/bank/v1beta1/balances/${cosmos}`);
  const b = (await res.json()) as { balances: { denom: string; amount: string }[] };
  return BigInt(b.balances.find((x) => x.denom === DENOM)?.amount ?? "0");
}
const erc20Fusd = (evm: string) => publicClient.readContract({ address: FUSD, abi, functionName: "balanceOf", args: [evm as `0x${string}`] });

if (cmd === "info") {
  console.log(`token ${symbol} decimals ${decimals}`);
  for (const name of args) {
    const acc = await loadAccount(name);
    console.log(
      `${name}: bank ${formatUnits(await bankFusd(acc.cosmos), decimals)} ${symbol}, ERC-20 ${formatUnits(await erc20Fusd(acc.evm), decimals)} ${symbol}, ${Number(await uqorBalance(acc.cosmos)) / 1e6} QOR`,
    );
  }
} else if (cmd === "convert") {
  const [name, fusd] = args;
  const acc = await loadAccount(name);
  const amount = parseUnits(fusd, decimals).toString();
  const m = { typeUrl: MSG_CONVERT_COIN, value: { coin: { denom: DENOM, amount }, receiver: acc.evm, sender: acc.cosmos } };
  const before = await erc20Fusd(acc.evm);
  const q0 = await uqorBalance(acc.cosmos);
  const res = await broadcast(acc, [m], "hybrid", "S5 convert fUSD", qorechainRegistry([[MSG_CONVERT_COIN, MsgConvertCoinType]]));
  pass("MsgConvertCoin bank fUSD -> ERC-20", res.code === 0, res.code === 0 ? res.hash : res.rawLog);
  if (res.code === 0) {
    await txEvents(res.hash);
    const after = await erc20Fusd(acc.evm);
    pass("ERC-20 balance rose by the amount", after - before === BigInt(amount), `${formatUnits(before, decimals)} -> ${formatUnits(after, decimals)}`);
    console.log(`QOR spent: ${Number(q0 - (await uqorBalance(acc.cosmos))) / 1e6}`);
  }
} else if (cmd === "send") {
  const [from, to, fusd] = args;
  const a = await loadAccount(from);
  const b = await loadAccount(to);
  const w = walletFor(a.privateKey as `0x${string}`);
  const q0 = await uqorBalance(a.cosmos);
  const hash = await w.writeContract({ address: FUSD, abi, functionName: "transfer", args: [b.evm as `0x${string}`, parseUnits(fusd, decimals)] });
  const r = await publicClient.waitForTransactionReceipt({ hash });
  pass(`ERC-20 transfer ${from} -> ${to}`, r.status === "success", hash);
  console.log(`gasUsed ${r.gasUsed}, QOR spent: ${Number(q0 - (await uqorBalance(a.cosmos))) / 1e6}`);
} else {
  console.log("usage: info <name...> | convert <name> <fusd> | send <from> <to> <fusd>");
}
