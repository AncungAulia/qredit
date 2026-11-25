import { linkAuthenticatorMsgs, signAuthenticatorLinkEd25519, type UnifiedAccount } from "@qorechain/sdk";
import {
  broadcastHybrid, confirmed as confirmedOn, convertFusd as convertFusdOn, ensureWindow as ensureWindowOn, ERC20_ABI, FACTORY_ABI,
  FACTORY_ADDRESS, FACTORY_START_BLOCK, FUSD_ADDRESS, FUSD_DENOM, openWindow as openWindowOn, PAY_SUPPLIER_SELECTOR, planLend, publicClientFor,
  registerPqcKey, scanChunked, TESTNET, VAULT_ABI, walletFor, type EnsureWindowOptions, type WindowOptions,
} from "@qredit/qore";
import { decodeEventLog, encodeFunctionData, parseAbiItem, type PublicClient } from "viem";
import type { vaultInit } from "./businesses.ts";

export { planLend, type EnsureWindowOptions, type LendPlan, type WindowOptions } from "@qredit/qore";

const net = TESTNET;
const client = publicClientFor(TESTNET.evm);

const confirmed = (sent: { hash: string; code: number; rawLog?: string }, what: string): Promise<string> => confirmedOn(net, sent, what);

/** Register the account's ML-DSA-87 key (classical tx, once). Returns null if already registered. */
export const registerKey = (acc: UnifiedAccount): Promise<string | null> => registerPqcKey(net, acc);

/** One MsgSend per recipient, in a single tx: uqor and optionally faucet fUSD (bank coin). */
export async function sendQor(from: UnifiedAccount, to: string[], uqor: bigint, fusdUnits = 0n): Promise<string> {
  const amount = [
    ...(fusdUnits > 0n ? [{ denom: FUSD_DENOM, amount: fusdUnits.toString() }] : []),
    ...(uqor > 0n ? [{ denom: "uqor", amount: uqor.toString() }] : []),
  ].sort((a, b) => (a.denom < b.denom ? -1 : 1));
  const messages = to.map((toAddress) => ({ typeUrl: "/cosmos.bank.v1beta1.MsgSend", value: { fromAddress: from.cosmos, toAddress, amount } }));
  return confirmed(await broadcastHybrid(net, from, messages, { memo: "qredit setup funds", gas: String(200_000 + 100_000 * to.length) }), "funding");
}

/** Faucet fUSD (bank coin) to ERC-20 fUSD on the same account. */
export const convertFusd = (acc: UnifiedAccount, units: bigint): Promise<string> => convertFusdOn(net, acc, units);

/** The shared window steps, with the engine's network and `Bun.sleep` bound. */
export const openWindow = (acc: UnifiedAccount, targets: string[], o: WindowOptions = {}): Promise<string> => openWindowOn(net, acc, targets, o, Bun.sleep);
export const ensureWindow = (acc: UnifiedAccount, targets: string[], opts: EnsureWindowOptions = {}): Promise<string | null> =>
  ensureWindowOn(net, acc, targets, opts, { sleep: Bun.sleep });

/** The treasury's window shape: short, few txs, small value cap. */
// Its own values, not an alias of BUYER_WINDOW: changing the buyer window must not silently change the treasury's.
export const TREASURY_WINDOW: WindowOptions = { blocks: 3600, maxTxs: 40, maxValue: 60_000_000n };

export type FoundVault = { vault: string; startBlock: number; tx: string };
type FactoryLog = { address: string; args: { vault?: string; spender?: string }; blockNumber: bigint; transactionHash: string };

/** The first VaultCreated log emitted by the factory whose spender is this business's spender. */
export function matchVaultLog(logs: FactoryLog[], spender: string): FoundVault | null {
  const hit = logs.find(
    (l) => l.address.toLowerCase() === FACTORY_ADDRESS.toLowerCase() && !!l.args.vault && l.args.spender?.toLowerCase() === spender.toLowerCase(),
  );
  return hit ? { vault: hit.args.vault!.toLowerCase(), startBlock: Number(hit.blockNumber), tx: hit.transactionHash } : null;
}

const VAULT_CREATED = parseAbiItem("event VaultCreated(address indexed vault, address indexed ownerPq, address spender, address operator, uint256 index)");

/** A vault this factory already created for this owner and spender (scans VaultCreated from the factory's deploy block). */
export async function findExistingVault(ownerPq: string, spender: string, c: PublicClient = client): Promise<FoundVault | null> {
  const head = Number(await c.getBlockNumber());
  const logs = await scanChunked(FACTORY_START_BLOCK, head, (fromBlock, toBlock) =>
    c.getLogs({ address: FACTORY_ADDRESS, event: VAULT_CREATED, args: { ownerPq: ownerPq as `0x${string}` }, fromBlock, toBlock }),
  );
  return matchVaultLog(logs as unknown as FactoryLog[], spender);
}

export async function createVault(treasury: UnifiedAccount, init: ReturnType<typeof vaultInit>) {
  const wallet = walletFor(treasury.privateKey as `0x${string}`, TESTNET.evm);
  const hash = await wallet.sendTransaction({
    account: wallet.account!, chain: wallet.chain,
    to: FACTORY_ADDRESS, data: encodeFunctionData({ abi: FACTORY_ABI, functionName: "create", args: [init] }),
  });
  const receipt = await client.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`vault creation reverted: ${hash}`);
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== FACTORY_ADDRESS.toLowerCase()) continue;
    try {
      const ev = decodeEventLog({ abi: FACTORY_ABI, data: log.data, topics: log.topics });
      if (ev.eventName === "VaultCreated") return { vault: (ev.args.vault as string).toLowerCase(), startBlock: Number(receipt.blockNumber), tx: hash };
    } catch {
      // not a factory event
    }
  }
  throw new Error(`no VaultCreated event in ${hash}`);
}

export async function linkAgent(spender: UnifiedAccount, agent: { secret: Uint8Array }, vault: string): Promise<string> {
  const proof = signAuthenticatorLinkEd25519({ chainId: net.chainId, account: spender.cosmos, privateKey: agent.secret });
  const msgs = linkAuthenticatorMsgs({
    owner: spender.cosmos, chainId: net.chainId, ...proof,
    permissions: ["evm"],
    expiryUnix: Math.floor(Date.now() / 1000) + 30 * 24 * 3600,
    label: "qredit agent",
    spendingRule: {
      id: "agent", enabled: true, perTxLimit: "1000000", dailyLimit: "5000000", allowedDenoms: ["uqor"],
      allowedEvmCalls: [`${vault.toLowerCase()}/${PAY_SUPPLIER_SELECTOR}`],
    },
  });
  return confirmed(await broadcastHybrid(net, spender, msgs, { memo: "link qredit agent" }), "agent link");
}

export async function registerBusiness(apiUrl: string, token: string, body: unknown): Promise<void> {
  const res = await fetch(`${apiUrl}/v1/businesses`, {
    method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  if (res.status !== 204) throw new Error(`business registration failed: HTTP ${res.status} ${await res.text()}`);
}

export async function lend(
  lender: UnifiedAccount, vault: string, requested: bigint, knownVaults: string[] = [],
): Promise<{ skipped?: string; amount?: bigint; approveTx?: string; depositTx?: string; windowTx?: string | null }> {
  const v = vault as `0x${string}`;
  const [state, raised, loan, balance, allowance] = await Promise.all([
    client.readContract({ address: v, abi: VAULT_ABI, functionName: "state" }),
    client.readContract({ address: v, abi: VAULT_ABI, functionName: "raised" }),
    client.readContract({ address: v, abi: VAULT_ABI, functionName: "loan" }),
    client.readContract({ address: FUSD_ADDRESS, abi: ERC20_ABI, functionName: "balanceOf", args: [lender.evm as `0x${string}`] }),
    client.readContract({ address: FUSD_ADDRESS, abi: ERC20_ABI, functionName: "allowance", args: [lender.evm as `0x${string}`, v] }),
  ]);
  const plan = planLend({ state: Number(state), raised, target: loan[0], balance, allowance }, requested);
  if (plan.action === "skip") return { skipped: plan.reason };

  const windowTx = await ensureWindow(lender, [FUSD_ADDRESS, vault, FACTORY_ADDRESS, ...knownVaults], TREASURY_WINDOW);
  const wallet = walletFor(lender.privateKey as `0x${string}`, TESTNET.evm);
  const send = async (to: `0x${string}`, data: `0x${string}`) => {
    const hash = await wallet.sendTransaction({ account: wallet.account!, chain: wallet.chain, to, data });
    const r = await client.waitForTransactionReceipt({ hash });
    if (r.status !== "success") throw new Error(`reverted: ${hash}`);
    return hash;
  };
  const approveTx = plan.approve
    ? await send(FUSD_ADDRESS, encodeFunctionData({ abi: ERC20_ABI, functionName: "approve", args: [v, plan.amount] }))
    : undefined;
  const depositTx = await send(v, encodeFunctionData({ abi: VAULT_ABI, functionName: "deposit", args: [plan.amount] }));
  return { amount: plan.amount, approveTx, depositTx, windowTx };
}
