// S3: is an ML-DSA-87 message signature (QoreSign format) accepted by pqcVerify?
//   bun src/s3-message-sig.ts script "<text>"       sign with the owner's key here, verify on chain
//   bun src/s3-message-sig.ts qorex <file.json>     verify a QoreX signArbitrary result saved from web/index.html
import { readFileSync } from "node:fs";
import { messagePqSignBytes, pqSign } from "@qorechain/qoresign";
import { bech32 } from "@scure/base";
import { parseAbi, toHex } from "viem";
import { NET, loadAccount, pass, publicClient } from "./lib.ts";

const PQC_VERIFY = "0x0000000000000000000000000000000000000a01" as const;
const PQC_KEYS = "0x0000000000000000000000000000000000000a02" as const;
const abi = parseAbi([
  "function pqcVerify(bytes pubkey, bytes signature, bytes message) view returns (bool)",
  "function pqcKeyStatus(address account) view returns (bool registered, uint8 algorithmId, bytes pubkey, bool possessionProven)",
]);

const evmOf = (qor: string) => toHex(Uint8Array.from(bech32.fromWords(bech32.decode(qor as `${string}1${string}`).words)));

async function check(signerQor: string, text: string, sig: Uint8Array) {
  const [registered, , pubkey, proven] = await publicClient.readContract({ address: PQC_KEYS, abi, functionName: "pqcKeyStatus", args: [evmOf(signerQor)] });
  pass("signer key registered and proven", registered && proven);
  const message = toHex(messagePqSignBytes(NET.chainId, text));
  const ok = await publicClient.readContract({ address: PQC_VERIFY, abi, functionName: "pqcVerify", args: [pubkey, toHex(sig), message] });
  pass("pqcVerify accepts the prefixed message", ok, `${sig.length}-byte signature`);
  const bad = Uint8Array.from(sig); bad[100] ^= 1;
  const okBad = await publicClient.readContract({ address: PQC_VERIFY, abi, functionName: "pqcVerify", args: [pubkey, toHex(bad), message] });
  pass("pqcVerify refuses a flipped signature byte", !okBad);
  const okRaw = await publicClient.readContract({ address: PQC_VERIFY, abi, functionName: "pqcVerify", args: [pubkey, toHex(sig), toHex(new TextEncoder().encode(text))] });
  pass("pqcVerify refuses the unprefixed text", !okRaw);
}

const [cmd, arg] = process.argv.slice(2);
if (cmd === "script") {
  const owner = await loadAccount("owner");
  const text = arg ?? "qredit-order-v1:0x00";
  await check(owner.cosmos, text, pqSign(owner.pqc.secretKey, messagePqSignBytes(NET.chainId, text)));
} else if (cmd === "qorex") {
  const j = JSON.parse(readFileSync(arg, "utf8")) as { signer: string; data: string; sig: { pq?: { signature: string } } };
  console.log("QoreX result keys:", Object.keys(j.sig));
  if (!j.sig.pq) throw new Error("no pq part in the QoreX signature: record the shape in RESULTS.md");
  await check(j.signer, j.data, Uint8Array.from(Buffer.from(j.sig.pq.signature, "base64")));
} else {
  console.log('usage: script "<text>" | qorex <file.json>');
}
