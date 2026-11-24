// S3 against the real vault: sign a PAUSE order and submit it with applyOrder.
//   bun src/s3-apply-order.ts text <vault>                    print the text to sign (nonce, expiry) for QoreX
//   bun src/s3-apply-order.ts script <vault>                  sign with spikes owner key and submit
//   bun src/s3-apply-order.ts qorex <vault> <file.json> <expiry>   submit a QoreX signature of the printed text
import { readFileSync } from "node:fs";
import { messagePqSignBytes, pqSign } from "@qorechain/qoresign";
import { hexToString, parseAbi, toHex } from "viem";
import { NET, loadAccount, pass, publicClient, walletFor } from "./lib.ts";

const abi = parseAbi([
  "error BadPqcSignature()",
  "struct PolicyOrder { uint8 kind; address target; uint256 value; uint64 nonce; uint64 expiry; }",
  "function orderText(PolicyOrder o) view returns (bytes)",
  "function applyOrder(PolicyOrder o, bytes sig)",
  "function policyNonce() view returns (uint64)",
  "function paused() view returns (bool)",
]);
const PAUSE = 3;
const ZERO = "0x0000000000000000000000000000000000000000" as const;

const [cmd, vaultArg, file, expiryArg] = process.argv.slice(2);
const vault = vaultArg as `0x${string}`;
const nonce = await publicClient.readContract({ address: vault, abi, functionName: "policyNonce" });
const expiry = expiryArg ? BigInt(expiryArg) : BigInt(Math.floor(Date.now() / 1000) + 1800);
const order = { kind: PAUSE, target: ZERO, value: 0n, nonce, expiry };
const text = hexToString(await publicClient.readContract({ address: vault, abi, functionName: "orderText", args: [order] }));
const submitter = walletFor((await loadAccount("deployer")).privateKey as `0x${string}`);

async function submit(sig: Uint8Array, label: string) {
  const bad = Uint8Array.from(sig); bad[50] ^= 1;
  try {
    await publicClient.simulateContract({ account: submitter.account, address: vault, abi, functionName: "applyOrder", args: [order, toHex(bad)] });
    pass("tampered signature refused", false);
  } catch (e) {
    pass("tampered signature refused", String((e as Error).message).includes("BadPqcSignature"));
  }
  const hash = await submitter.writeContract({ address: vault, abi, functionName: "applyOrder", args: [order, toHex(sig)] });
  const ok = (await publicClient.waitForTransactionReceipt({ hash })).status === "success";
  pass(`${label} signature accepted by applyOrder`, ok, hash);
  pass("vault is paused", await publicClient.readContract({ address: vault, abi, functionName: "paused" }));
}

if (cmd === "text") {
  console.log(`text:   ${text}\nexpiry: ${expiry}`);
} else if (cmd === "script") {
  const owner = await loadAccount("owner");
  console.log(`orderText: ${text}`);
  await submit(pqSign(owner.pqc.secretKey, messagePqSignBytes(NET.chainId, text)), "script");
} else if (cmd === "qorex") {
  const j = JSON.parse(readFileSync(file, "utf8")) as { data: string; sig: { pq: { signature: string } } };
  if (j.data !== text) throw new Error(`the QoreX file signed "${j.data}", the vault expects "${text}"`);
  await submit(Uint8Array.from(Buffer.from(j.sig.pq.signature, "base64")), "QoreX");
} else {
  console.log("usage: text <vault> | script <vault> | qorex <vault> <file.json> <expiry>");
}
