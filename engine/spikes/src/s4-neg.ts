// S4 negative check: buyer sends to the factory (not a window target) with a live window.
import { loadAccount, publicClient, uqorBalance, walletFor } from "./lib.ts";
const buyer = await loadAccount("buyer");
const w = walletFor(buyer.privateKey as `0x${string}`);
const q0 = await uqorBalance(buyer.cosmos);
try {
  const h = await w.sendTransaction({ to: "0xAc5324088A7735dda922c277db5A2E906c8f5b3A", data: "0x", value: 0n, gas: 100_000n });
  const r = await publicClient.waitForTransactionReceipt({ hash: h });
  console.log(`FAIL accepted ${h} status ${r.status}`);
} catch (e) {
  console.log(`PASS refused: ${JSON.stringify((e as any).details ?? "")} | ${String((e as Error).message).replace(/\s+/g, " ").slice(0, 500)}`);
}
console.log(`QOR spent: ${Number(q0 - (await uqorBalance(buyer.cosmos))) / 1e6}`);
