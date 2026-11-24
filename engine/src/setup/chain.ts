import {
  buildRegisterPqcKeyMsg, fetchPqcStatus, linkAuthenticatorMsgs, openEvmWindowMsg, signAuthenticatorLinkEd25519, signProofOfPossession,
  type UnifiedAccount,
} from "@qorechain/sdk";
import {
  broadcastHybrid, convertCoinMsg, ERC20_ABI, FACTORY_ABI, FACTORY_ADDRESS, FUSD_ADDRESS, FUSD_DENOM, PAY_SUPPLIER_SELECTOR, VAULT_ABI, publicClientFor, qoreRegistry, TESTNET, txEvents, walletFor,
} from "@qredit/qore";
import { decodeEventLog, encodeFunctionData } from "viem";
import type { vaultInit } from "./businesses.ts";

const net = TESTNET;
const client = publicClientFor(TESTNET.evm);

async function confirmed(sent: { hash: string; code: number; rawLog?: string }, what: string): Promise<string> {
  if (sent.code !== 0) throw new Error(`${what} refused: code ${sent.code} ${sent.rawLog ?? ""}`);
  await txEvents(net.rest, sent.hash);
  return sent.hash;
}

/** Register the account's ML-DSA-87 key (classical tx, once). Returns null if already registered. */
export async function registerKey(acc: UnifiedAccount): Promise<string | null> {
  if ((await fetchPqcStatus({ rest: net.rest, address: acc.cosmos })).registered) return null;
  const pop = signProofOfPossession({ chainId: net.chainId, account: acc.cosmos, keypair: acc.pqc });
  const msg = buildRegisterPqcKeyMsg(acc.cosmos, { pqcKeypair: acc.pqc, proofOfPossession: pop });
  return confirmed(await broadcastHybrid(net, acc, [msg], { memo: "register ML-DSA-87", signMode: "classical" }), "key registration");
}

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
export async function convertFusd(acc: UnifiedAccount, units: bigint): Promise<string> {
  return confirmed(
    await broadcastHybrid(net, acc, [convertCoinMsg(acc.cosmos, acc.evm, units)], { memo: "convert fUSD", registry: qoreRegistry() }),
    "conversion",
  );
}

export async function openWindow(acc: UnifiedAccount, targets: string[], o: { blocks?: number; maxTxs?: number; maxValue?: bigint } = {}): Promise<string> {
  const msg = openEvmWindowMsg({
    sender: acc.cosmos,
    blocks: BigInt(o.blocks ?? 17_280),
    maxTxs: BigInt(o.maxTxs ?? 500),
    maxValue: (o.maxValue ?? 25_000_000n).toString(),
    allowedTargets: targets.map((t) => t.toLowerCase()),
  });
  const tx = await confirmed(await broadcastHybrid(net, acc, [msg], { memo: "qredit window" }), "window");
  await Bun.sleep(10_000); // the next EVM tx must land after the window's block
  return tx;
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

export async function lend(lender: UnifiedAccount, vault: string, units: bigint): Promise<{ approveTx: string; depositTx: string }> {
  const wallet = walletFor(lender.privateKey as `0x${string}`, TESTNET.evm);
  const send = async (to: `0x${string}`, data: `0x${string}`) => {
    const hash = await wallet.sendTransaction({ account: wallet.account!, chain: wallet.chain, to, data });
    const r = await client.waitForTransactionReceipt({ hash });
    if (r.status !== "success") throw new Error(`reverted: ${hash}`);
    return hash;
  };
  const approveTx = await send(FUSD_ADDRESS, encodeFunctionData({ abi: ERC20_ABI, functionName: "approve", args: [vault as `0x${string}`, units] }));
  const depositTx = await send(vault as `0x${string}`, encodeFunctionData({ abi: VAULT_ABI, functionName: "deposit", args: [units] }));
  return { approveTx, depositTx };
}
