// Vault v2 smoke run on qorechain-diana (vault v2 spec, section 12). It spends testnet QOR and fUSD: run it only after
// the human said yes. Phase a creates and raises a small vault, buys three orders as the demo buyer, delivers them as
// the smoke operator, accepts order 1, rejects order 2 and records read-only refusals. Phase b, once the review of
// order 3 has ended and the loan is three installments behind, settles order 3, triggers the default and claims the
// sweep as the lender. Every hash goes to smoke-v2.json (public data only).
//   bun --env-file=.env scripts/smoke-v2.ts a|b
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { BUYER_WINDOW, ERC20_ABI, FACTORY_ADDRESS, FUSD_ADDRESS, LOAN_VAULT_ABI, publicClientFor, TESTNET, VAULT_ABI } from "@qredit/qore";
import { encodeFunctionData, keccak256, toHex, type Hex } from "viem";
import { revertName } from "../src/agent/chain.ts";
import { keysDir } from "../src/config.ts";
import { keystore } from "../src/keystore.ts";
import { ensureAccounts, loadAccount } from "../src/setup/accounts.ts";
import { createVault, ensureWindow, evmSender, lend, registerKey, sendQor, TREASURY_WINDOW } from "../src/setup/chain.ts";
import { DEMO_BUYER } from "../src/setup/demo-buyer.ts";
import { SMOKE_OPERATOR, SMOKE_PRICE, smokeInit } from "../src/setup/smoke.ts";

type Run = { vault: Hex; startBlock: number; txs: Record<string, string>; refusals: Record<string, string> };
const OUT = join(import.meta.dir, "..", "smoke-v2.json");
const pub = publicClientFor(TESTNET.evm);
const ks = keystore(keysDir());
const save = (r: Run) => writeFileSync(OUT, `${JSON.stringify(r, null, 2)}\n`);
const vaultCall = (functionName: string, args: unknown[] = []) => encodeFunctionData({ abi: VAULT_ABI, functionName, args } as never);

/** A dry run that must be refused; returns the vault error name (no transaction is sent). */
async function refusedWith(vault: Hex, from: Hex, functionName: string, args: unknown[] = []): Promise<string> {
  try {
    await pub.simulateContract({ address: vault, abi: LOAN_VAULT_ABI, functionName, args, account: from } as never);
    return "NOT REFUSED";
  } catch (e) {
    return revertName(e) ?? "refused without a decoded reason";
  }
}

async function phaseA(): Promise<void> {
  if (existsSync(OUT)) throw new Error("smoke-v2.json exists: phase a already ran; run phase b");
  ensureAccounts(ks, [SMOKE_OPERATOR]);
  const [treasury, buyer, operator] = await Promise.all([loadAccount(ks, "treasury"), loadAccount(ks, DEMO_BUYER), loadAccount(ks, SMOKE_OPERATOR)]);
  const txs: Record<string, string> = {};
  txs.fundOperator = await sendQor(treasury, [operator.cosmos], 2_000_000n);
  const registered = await registerKey(operator);
  if (registered) txs.registerOperator = registered;
  const treasuryWindow = await ensureWindow(treasury, [FACTORY_ADDRESS, FUSD_ADDRESS], TREASURY_WINDOW);
  if (treasuryWindow) txs.treasuryWindow = treasuryWindow;

  const init = smokeInit({ operator: operator.evm as Hex, ownerPq: treasury.evm as Hex }, Math.floor(Date.now() / 1000));
  const created = await createVault(treasury, init);
  if (created.approveTx) txs.approveBond = created.approveTx;
  txs.create = created.tx;
  const vault = created.vault as Hex;
  const run: Run = { vault, startBlock: created.startBlock, txs, refusals: {} };
  save(run);

  const raised = await lend(treasury, vault, init.loan.target);
  if (!raised.depositTx) throw new Error(`the raise was skipped: ${raised.skipped}`);
  txs.deposit = raised.depositTx;

  const buyerWindow = await ensureWindow(buyer, [FUSD_ADDRESS, vault], BUYER_WINDOW);
  if (buyerWindow) txs.buyerWindow = buyerWindow;
  const asBuyer = evmSender(buyer);
  txs.approvePrice = (await asBuyer(FUSD_ADDRESS, encodeFunctionData({ abi: ERC20_ABI, functionName: "approve", args: [vault, 3n * SMOKE_PRICE] }))).hash;
  for (const id of [1, 2, 3]) txs[`buy${id}`] = (await asBuyer(vault, vaultCall("buy", [0n, keccak256(toHex(`smoke-request-${id}`))]))).hash;

  const operatorWindow = await ensureWindow(operator, [vault]);
  if (operatorWindow) txs.operatorWindow = operatorWindow;
  const asOperator = evmSender(operator);
  for (const id of [1, 2, 3]) txs[`deliver${id}`] = (await asOperator(vault, vaultCall("deliver", [BigInt(id), keccak256(toHex(`smoke-report-${id}`))]))).hash;

  txs.accept1 = (await asBuyer(vault, vaultCall("accept", [1n]))).hash;
  txs.reject2 = (await asBuyer(vault, vaultCall("reject", [2n]))).hash;

  run.refusals.buyFromOwner = await refusedWith(vault, treasury.evm as Hex, "buy", [0n, keccak256(toHex("smoke-owner-buy"))]);
  run.refusals.settleBeforeReviewEnds = await refusedWith(vault, treasury.evm as Hex, "settle", [3n]);
  run.refusals.ownerClaimNotAhead = await refusedWith(vault, treasury.evm as Hex, "claimOwner");
  const nonce = (await pub.readContract({ address: vault, abi: LOAN_VAULT_ABI, functionName: "policyNonce" })) as bigint;
  const block = await pub.getBlock();
  run.refusals.closeByNonOwner = await refusedWith(vault, buyer.evm as Hex, "applyOrder", [
    { kind: 8, target: "0x0000000000000000000000000000000000000000", value: 0n, nonce, expiry: block.timestamp + 600n }, "0xdeadbeef",
  ]);
  save(run);
  const order3 = (await pub.readContract({ address: vault, abi: VAULT_ABI, functionName: "orders", args: [3n] })) as readonly unknown[];
  console.log(JSON.stringify(run, null, 2));
  console.log(`phase b can run once the review of order 3 ends: ${new Date(Number(order3[6]) * 1000).toISOString()}`);
}

async function phaseB(): Promise<void> {
  const run = JSON.parse(readFileSync(OUT, "utf8")) as Run;
  const treasury = await loadAccount(ks, "treasury");
  const order3 = (await pub.readContract({ address: run.vault, abi: VAULT_ABI, functionName: "orders", args: [3n] })) as readonly unknown[];
  const now = (await pub.getBlock()).timestamp;
  if (now <= (order3[6] as bigint)) throw new Error("the review of order 3 has not ended yet");
  if (!(await pub.readContract({ address: run.vault, abi: VAULT_ABI, functionName: "defaultable" }))) throw new Error("the loan is not defaultable yet");
  const w = await ensureWindow(treasury, [run.vault, FUSD_ADDRESS, FACTORY_ADDRESS], TREASURY_WINDOW);
  if (w) run.txs.treasuryWindowB = w;
  const asTreasury = evmSender(treasury);
  run.txs.settle3 = (await asTreasury(run.vault, vaultCall("settle", [3n]))).hash;
  run.txs.triggerDefault = (await asTreasury(run.vault, vaultCall("triggerDefault"))).hash;
  run.txs.claimSweep = (await asTreasury(run.vault, vaultCall("claimLender"))).hash;
  run.refusals.buyAfterDefault = await refusedWith(run.vault, treasury.evm as Hex, "buy", [0n, keccak256(toHex("smoke-late-buy"))]);
  save(run);
  console.log(JSON.stringify(run, null, 2));
  console.log("swept", String(await pub.readContract({ address: run.vault, abi: VAULT_ABI, functionName: "swept" })));
}

const phase = process.argv[2];
if (phase === "a") await phaseA();
else if (phase === "b") await phaseB();
else console.log("usage: bun --env-file=.env scripts/smoke-v2.ts a|b");
