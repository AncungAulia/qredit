// Send test QOR from one spike account to several others in one hybrid transaction.
//   bun src/fund.ts <from> <qor-each> <to...>
// The sender's ML-DSA-87 key must be registered (bun src/accounts.ts register <from>).
import { broadcast, loadAccount, txEvents } from "./lib.ts";

const [from, qorEach, ...to] = process.argv.slice(2);
if (!from || !qorEach || to.length === 0) {
  console.log("usage: bun src/fund.ts <from> <qor-each> <to...>");
  process.exit(1);
}

const sender = await loadAccount(from);
const amount = String(Math.round(Number(qorEach) * 1e6));
const messages = [];
for (const name of to) {
  const acc = await loadAccount(name);
  messages.push({
    typeUrl: "/cosmos.bank.v1beta1.MsgSend",
    value: { fromAddress: sender.cosmos, toAddress: acc.cosmos, amount: [{ denom: "uqor", amount }] },
  });
}
const res = await broadcast(sender, messages, "hybrid", "fund spike accounts");
if (res.code !== 0) {
  console.log(`REFUSED code ${res.code}: ${res.rawLog}`);
  process.exit(1);
}
await txEvents(res.hash);
console.log(`sent ${qorEach} QOR each to ${to.join(", ")}  ${res.hash}`);
