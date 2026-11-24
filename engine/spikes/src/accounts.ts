// Create, show and register spike accounts.
//   bun src/accounts.ts new <name> [--seed]   mnemonic account, or --seed: privateKey + QRC1 recovery code
//   bun src/accounts.ts show <name...>        addresses, QOR balance, ML-DSA-87 key status
//   bun src/accounts.ts register <name>       register the account's ML-DSA-87 key (classical tx, once)
import { randomBytes } from "node:crypto";
import {
  buildRegisterPqcKeyMsg,
  fetchPqcStatus,
  generateMnemonic,
  generatePqcRecoveryCode,
  signProofOfPossession,
} from "@qorechain/sdk";
import { NET, broadcast, loadAccount, saveKeyFile, uqorBalance } from "./lib.ts";

const [cmd, ...args] = process.argv.slice(2);

if (cmd === "new") {
  const [name] = args;
  if (!name) throw new Error("usage: new <name> [--seed]");
  if (args.includes("--seed")) {
    saveKeyFile(name, { privateKey: `0x${randomBytes(32).toString("hex")}`, recoveryCode: generatePqcRecoveryCode() });
  } else {
    saveKeyFile(name, { mnemonic: generateMnemonic() });
  }
  const acc = await loadAccount(name);
  console.log(`${name}: ${acc.cosmos}  ${acc.evm}  (fund the qor1 address from the faucet)`);
} else if (cmd === "show") {
  for (const name of args) {
    const acc = await loadAccount(name);
    const pqc = await fetchPqcStatus({ rest: NET.rest, address: acc.cosmos });
    console.log(`${name}: ${acc.cosmos}  ${acc.evm}  ${Number(await uqorBalance(acc.cosmos)) / 1e6} QOR  ML-DSA-87: ${pqc.registered ? "registered" : "not registered"}`);
  }
} else if (cmd === "register") {
  const acc = await loadAccount(args[0]);
  const pop = signProofOfPossession({ chainId: NET.chainId, account: acc.cosmos, keypair: acc.pqc });
  const res = await broadcast(acc, [buildRegisterPqcKeyMsg(acc.cosmos, { pqcKeypair: acc.pqc, proofOfPossession: pop })], "classical", "register ML-DSA-87");
  console.log(res.code === 0 ? `registered ${res.hash}` : `REFUSED code ${res.code}: ${res.rawLog}`);
} else {
  console.log("usage: bun src/accounts.ts new <name> [--seed] | show <name...> | register <name>");
}
