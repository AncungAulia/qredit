// Vault v2 smoke run on qorechain-diana (vault v2 spec, section 12). It spends testnet QOR and fUSD: run it only after
// the human said yes. Both phases are resumable: a rerun skips the steps whose hash is in smoke-v2.json. Phase a creates and raises a small vault, buys three orders as the demo buyer, delivers them as
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

import { EVM_CHAIN_ID, phaseBBlocker, recordRefusal, recordStep, type Run } from "../src/setup/smoke-run.ts";
const OUT = join(import.meta.dir, "..", "smoke-v2.json");
const pub = publicClientFor(TESTNET.evm);
const ks = keystore(keysDir());
const saveRun = (r: Run) => writeFileSync(OUT, `${JSON.stringify(r, null, 2)}\n`);
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

const ZERO = "0x0000000000000000000000000000000000000000" as const;
const load = (): Run => (existsSync(OUT) ? (JSON.parse(readFileSync(OUT, "utf8")) as Run) : { vault: ZERO, startBlock: 0, txs: {}, refusals: {} });

async function assertChain(): Promise<void> {
  const id = await pub.getChainId();
  if (id !== EVM_CHAIN_ID) throw new Error(`wrong chain: EVM chain id ${id}, expected ${EVM_CHAIN_ID} (qorechain-diana)`);
}

/** Phase a, resumable: a rerun skips every step whose hash is already in smoke-v2.json. */
async function phaseA(): Promise<void> {
  await assertChain();
  const run = load();
  const { txs } = run;
  const save = () => saveRun(run);
  const step = (key: string, fn: () => Promise<string | null | undefined>) => recordStep(txs, key, fn, save);
  const refusal = (key: string, fn: () => Promise<string>) => recordRefusal(run, key, fn, save);

  ensureAccounts(ks, [SMOKE_OPERATOR]);
  const [treasury, buyer, operator] = await Promise.all([loadAccount(ks, "treasury"), loadAccount(ks, DEMO_BUYER), loadAccount(ks, SMOKE_OPERATOR)]);
  await step("fundOperator", () => sendQor(treasury, [operator.cosmos], 2_000_000n));
  await step("registerOperator", () => registerKey(operator));
  await step("treasuryWindow", () => ensureWindow(treasury, [FACTORY_ADDRESS, FUSD_ADDRESS], TREASURY_WINDOW));

  const init = smokeInit({ operator: operator.evm as Hex, ownerPq: treasury.evm as Hex }, Math.floor(Date.now() / 1000));
  if (!txs.create) {
    const created = await createVault(treasury, init);
    if (created.approveTx) txs.approveBond = created.approveTx;
    txs.create = created.tx;
    run.vault = created.vault as Hex;
    run.startBlock = created.startBlock;
    save();
  }
  const vault = run.vault;
  await step("deposit", async () => {
    const raised = await lend(treasury, vault, init.loan.target);
    if (!raised.depositTx) throw new Error(`the raise was skipped: ${raised.skipped}`);
    return raised.depositTx;
  });

  await step("buyerWindow", () => ensureWindow(buyer, [FUSD_ADDRESS, vault], BUYER_WINDOW));
  const asBuyer = evmSender(buyer);
  await step("approvePrice", async () => (await asBuyer(FUSD_ADDRESS, encodeFunctionData({ abi: ERC20_ABI, functionName: "approve", args: [vault, 3n * SMOKE_PRICE] }))).hash);
  for (const id of [1, 2, 3]) await step(`buy${id}`, async () => (await asBuyer(vault, vaultCall("buy", [0n, keccak256(toHex(`smoke-request-${id}`))]))).hash);

  await step("operatorWindow", () => ensureWindow(operator, [vault]));
  const asOperator = evmSender(operator);
  for (const id of [1, 2, 3]) await step(`deliver${id}`, async () => (await asOperator(vault, vaultCall("deliver", [BigInt(id), keccak256(toHex(`smoke-report-${id}`))]))).hash);

  await step("accept1", async () => (await asBuyer(vault, vaultCall("accept", [1n]))).hash);
  await step("reject2", async () => (await asBuyer(vault, vaultCall("reject", [2n]))).hash);

  await refusal("buyFromOwner", () => refusedWith(vault, treasury.evm as Hex, "buy", [0n, keccak256(toHex("smoke-owner-buy"))]));
  await refusal("settleBeforeReviewEnds", () => refusedWith(vault, treasury.evm as Hex, "settle", [3n]));
  await refusal("ownerClaimNotAhead", () => refusedWith(vault, treasury.evm as Hex, "claimOwner"));
  await refusal("closeByNonOwner", async () => {
    const nonce = (await pub.readContract({ address: vault, abi: LOAN_VAULT_ABI, functionName: "policyNonce" })) as bigint;
    const block = await pub.getBlock();
    return refusedWith(vault, buyer.evm as Hex, "applyOrder", [
      { kind: 8, target: "0x0000000000000000000000000000000000000000", value: 0n, nonce, expiry: block.timestamp + 600n }, "0xdeadbeef",
    ]);
  });
  const order3 = (await pub.readContract({ address: vault, abi: VAULT_ABI, functionName: "orders", args: [3n] })) as readonly unknown[];
  console.log(JSON.stringify(run, null, 2));
  console.log(`phase b can run once the review of order 3 ends: ${new Date(Number(order3[6]) * 1000).toISOString()}`);
}

/** Phase b, resumable: refuses to start unless phase a finished and order 3 is still in review (or already settled by an earlier phase b run). */
async function phaseB(): Promise<void> {
  await assertChain();
  if (!existsSync(OUT)) throw new Error("smoke-v2.json is missing: run phase a first");
  const run = load();
  const { txs } = run;
  const order3 = (await pub.readContract({ address: run.vault, abi: VAULT_ABI, functionName: "orders", args: [3n] })) as readonly unknown[];
  const blocker = phaseBBlocker(run, Number(order3[3]));
  if (blocker) throw new Error(blocker);
  const save = () => saveRun(run);
  const step = (key: string, fn: () => Promise<string | null | undefined>) => recordStep(txs, key, fn, save);

  const treasury = await loadAccount(ks, "treasury");
  if (!txs.settle3) {
    const now = (await pub.getBlock()).timestamp;
    if (now <= (order3[6] as bigint)) throw new Error("the review of order 3 has not ended yet");
  }
  if (!txs.triggerDefault && !(await pub.readContract({ address: run.vault, abi: VAULT_ABI, functionName: "defaultable" }))) throw new Error("the loan is not defaultable yet");
  await step("treasuryWindowB", () => ensureWindow(treasury, [run.vault, FUSD_ADDRESS, FACTORY_ADDRESS], TREASURY_WINDOW));
  const asTreasury = evmSender(treasury);
  await step("settle3", async () => (await asTreasury(run.vault, vaultCall("settle", [3n]))).hash);
  await step("triggerDefault", async () => (await asTreasury(run.vault, vaultCall("triggerDefault"))).hash);
  await step("claimSweep", async () => (await asTreasury(run.vault, vaultCall("claimLender"))).hash);
  await recordRefusal(run, "buyAfterDefault", () => refusedWith(run.vault, treasury.evm as Hex, "buy", [0n, keccak256(toHex("smoke-late-buy"))]), save);
  console.log(JSON.stringify(run, null, 2));
  console.log("swept", String(await pub.readContract({ address: run.vault, abi: VAULT_ABI, functionName: "swept" })));
}

const phase = process.argv[2];
if (phase === "a") await phaseA();
else if (phase === "b") await phaseB();
else console.log("usage: bun --env-file=.env scripts/smoke-v2.ts a|b");
