import { fetchAuthenticators, linkAuthenticatorMsgs, revokeAuthenticatorMsg, signAuthenticatorLinkEd25519, type UnifiedAccount } from "@qorechain/sdk";
import {
  bondFor, broadcastHybrid, confirmed as confirmedOn, convertFusd as convertFusdOn, ensureWindow as ensureWindowOn, ERC20_ABI, FACTORY_ABI,
  FACTORY_ADDRESS, FACTORY_START_BLOCK, FUSD_ADDRESS, FUSD_DENOM, openWindow as openWindowOn, PAY_SUPPLIER_SELECTOR, planLend, publicClientFor,
  registerPqcKey, scanChunked, TESTNET, VAULT_ABI, walletFor, type EnsureWindowOptions, type WindowOptions,
} from "@qredit/qore";
import { decodeEventLog, encodeFunctionData, parseAbiItem, type Hex, type PublicClient, type TransactionReceipt } from "viem";
import type { VaultInit } from "./businesses.ts";

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

/** Sends EVM transactions from `acc` and waits for each receipt; a reverted receipt throws with the hash. */
export function evmSender(acc: UnifiedAccount, c: PublicClient = client) {
  const wallet = walletFor(acc.privateKey as Hex, TESTNET.evm);
  return async (to: Hex, data: Hex): Promise<{ hash: Hex; receipt: TransactionReceipt }> => {
    const hash = await wallet.sendTransaction({ account: wallet.account!, chain: wallet.chain, to, data });
    const receipt = await c.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new Error(`reverted: ${hash}`);
    return { hash, receipt };
  };
}

/** The amount to approve for the factory before a create, or null when the allowance already covers the bond. */
export const bondApproval = (allowance: bigint, target: bigint): bigint | null => {
  const bond = bondFor(target);
  return allowance >= bond ? null : bond;
};

/** The vault of the factory's VaultCreated log in a receipt, lowercase; null when there is none. */
export function vaultFromReceipt(logs: readonly { address: string; data: Hex; topics: readonly Hex[] }[]): string | null {
  for (const log of logs) {
    if (log.address.toLowerCase() !== FACTORY_ADDRESS.toLowerCase()) continue;
    try {
      const ev = decodeEventLog({ abi: FACTORY_ABI, data: log.data, topics: log.topics as [Hex, ...Hex[]] });
      if (ev.eventName === "VaultCreated") return (ev.args.vault as string).toLowerCase();
    } catch {
      // not a factory event
    }
  }
  return null;
}

/** Creates a vault through the v2 factory. The factory pulls the owner's bond, so the treasury approves it first when needed. */
export async function createVault(treasury: UnifiedAccount, init: VaultInit, c: PublicClient = client) {
  const send = evmSender(treasury, c);
  const allowance = (await c.readContract({
    address: FUSD_ADDRESS, abi: ERC20_ABI, functionName: "allowance", args: [treasury.evm as Hex, FACTORY_ADDRESS],
  })) as bigint;
  const approve = bondApproval(allowance, init.loan.target);
  const approveTx = approve === null
    ? null
    : (await send(FUSD_ADDRESS, encodeFunctionData({ abi: ERC20_ABI, functionName: "approve", args: [FACTORY_ADDRESS, approve] }))).hash;
  const { hash, receipt } = await send(FACTORY_ADDRESS, encodeFunctionData({ abi: FACTORY_ABI, functionName: "create", args: [init] }));
  const vault = vaultFromReceipt(receipt.logs);
  if (!vault) throw new Error(`no VaultCreated event in ${hash}`);
  return { vault, startBlock: Number(receipt.blockNumber), tx: hash, approveTx };
}

/**
 * The messages that link the agent key to the spender for one vault's paySupplier. With `revokeFirst` the key's
 * earlier link (the v1 vault) is revoked in the same transaction, so the key can be linked again.
 */
export function agentLinkMsgs(o: {
  spenderCosmos: string; agent: { secret: Uint8Array; publicKey: Uint8Array }; vault: string; revokeFirst: boolean; nowSeconds: number;
}) {
  const proof = signAuthenticatorLinkEd25519({ chainId: net.chainId, account: o.spenderCosmos, privateKey: o.agent.secret });
  const link = linkAuthenticatorMsgs({
    owner: o.spenderCosmos, chainId: net.chainId, ...proof,
    permissions: ["evm"],
    expiryUnix: o.nowSeconds + 30 * 24 * 3600,
    label: "qredit agent",
    spendingRule: {
      id: "agent", enabled: true, perTxLimit: "1000000", dailyLimit: "5000000", allowedDenoms: ["uqor"],
      allowedEvmCalls: [`${o.vault.toLowerCase()}/${PAY_SUPPLIER_SELECTOR}`],
    },
  });
  if (!o.revokeFirst) return link;
  return [revokeAuthenticatorMsg({ owner: o.spenderCosmos, scheme: "ed25519", pubkey: o.agent.publicKey }), ...link];
}

/** Whether the key is linked to the account and not revoked, so a link of the same key needs a revoke first. */
export const hasLiveLink = (auths: readonly { pubkeyHex: string; revoked: boolean }[], pubkeyHex: string): boolean =>
  auths.some((a) => !a.revoked && a.pubkeyHex.toLowerCase() === pubkeyHex.toLowerCase());

/** Reads the chain: true when the agent key still has a live link (the v1 vault's) on the spender. */
export async function agentLinkIsLive(spenderCosmos: string, agentPubkey: Uint8Array): Promise<boolean> {
  const auths = await fetchAuthenticators({ rest: net.rest, address: spenderCosmos });
  return hasLiveLink(auths, Buffer.from(agentPubkey).toString("hex"));
}

export async function linkAgent(spender: UnifiedAccount, agent: { secret: Uint8Array; publicKey: Uint8Array }, vault: string, revokeFirst = false): Promise<string> {
  const msgs = agentLinkMsgs({ spenderCosmos: spender.cosmos, agent, vault, revokeFirst, nowSeconds: Math.floor(Date.now() / 1000) });
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
  const send = async (to: Hex, data: Hex) => (await evmSender(lender)(to, data)).hash;
  const approveTx = plan.approve
    ? await send(FUSD_ADDRESS, encodeFunctionData({ abi: ERC20_ABI, functionName: "approve", args: [v, plan.amount] }))
    : undefined;
  const depositTx = await send(v, encodeFunctionData({ abi: VAULT_ABI, functionName: "deposit", args: [plan.amount] }));
  return { amount: plan.amount, approveTx, depositTx, windowTx };
}
