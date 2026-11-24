import { deriveSealKeys, envelopeFromText, open, type SealKeyPair } from "@qorechain/qoreseal";
import { generateMnemonic } from "@qorechain/sdk";
import { ERC20_ABI, envelopeHash, FUSD_ADDRESS, publicClientFor, TESTNET, VAULT_ABI, VAULT_EVENTS, walletFor } from "@qredit/qore";
import { decodeEventLog, encodeFunctionData, type Hex } from "viem";
import { createRecipientResolver } from "../agent/recipient.ts";
import { REPORT_PURPOSE, sealRequest } from "../agent/seal.ts";
import type { Order } from "../agent/types.ts";
import type { Keystore } from "../keystore.ts";
import { loadAccount } from "./accounts.ts";
import { convertFusd, ensureWindow, registerKey, sendQor } from "./chain.ts";
import { publishCard, registerSealKey } from "./seal.ts";

export const DEMO_BUYER = "demo-buyer";
const INIT_UQOR = 3_000_000n;
const INIT_FUSD = 10_000_000n;
const BUYER_WINDOW = { blocks: 3600, maxTxs: 40, maxValue: 60_000_000n };
const utf8 = (s: string) => new TextEncoder().encode(s);

/** The buyer seal keys come from its mnemonic, so they are reproducible and need no seed file. */
export function buyerSealKeys(ks: Keystore): SealKeyPair {
  return deriveSealKeys({ mnemonic: ks.read(DEMO_BUYER).mnemonic! });
}

const bankBalance = async (address: string, denomPrefix: string): Promise<bigint> => {
  const r = await fetch(`${TESTNET.rest}/cosmos/bank/v1beta1/balances/${address}`);
  const b = r.ok ? ((await r.json()) as { balances: { denom: string; amount: string }[] }).balances : [];
  return BigInt(b.find((x) => x.denom.startsWith(denomPrefix))?.amount ?? 0);
};

/** Creates the buyer key, funds it from the treasury, registers its keys and publishes its card. Re-running skips finished steps. */
export async function initDemoBuyer(ks: Keystore, apiUrl: string, log: (line: string) => void): Promise<void> {
  if (!ks.has(DEMO_BUYER)) {
    ks.write(DEMO_BUYER, { mnemonic: generateMnemonic(256) });
    log("created keystore entry demo-buyer");
  }
  const buyer = await loadAccount(ks, DEMO_BUYER);
  const pub = publicClientFor(TESTNET.evm);
  const haveErc20 = (await pub.readContract({ address: FUSD_ADDRESS, abi: ERC20_ABI, functionName: "balanceOf", args: [buyer.evm as Hex] })) as bigint;
  const haveBank = await bankBalance(buyer.cosmos, "erc20:0x97143");
  const haveQor = await bankBalance(buyer.cosmos, "uqor");
  log(`buyer ${buyer.cosmos} (${buyer.evm})`);
  if (haveQor === 0n && haveBank === 0n && haveErc20 === 0n) {
    log(`funding tx ${await sendQor(await loadAccount(ks, "treasury"), [buyer.cosmos], INIT_UQOR, INIT_FUSD)}`);
  }
  log(`ML-DSA key: ${(await registerKey(buyer)) ?? "already registered"}`);
  const bank = await bankBalance(buyer.cosmos, "erc20:0x97143");
  if (bank > 0n) log(`convert tx ${await convertFusd(buyer, bank)}`);
  const keys = buyerSealKeys(ks);
  const kemTx = await registerSealKey(buyer, keys.mlkemPublicKey);
  log(`KEM key: ${kemTx ?? "already registered"}`);
  if (kemTx) await Bun.sleep(10_000);
  await publishCard(apiUrl, buyer, keys);
  log("recipient card uploaded");
}

async function fetchCard(apiUrl: string, qor: string): Promise<unknown | null> {
  const r = await fetch(`${apiUrl}/v1/cards/${qor}`, { signal: AbortSignal.timeout(20_000) });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`card lookup failed: HTTP ${r.status}`);
  return ((await r.json()) as { card: unknown }).card;
}

/** Seals the input to the business spender, posts it, opens a window, approves the price and buys. */
export async function placeDemoOrder(
  ks: Keystore, apiUrl: string, o: { vault: string; spender: string; input: string; serviceId?: number }, log: (line: string) => void,
): Promise<{ orderId: string }> {
  const buyer = await loadAccount(ks, DEMO_BUYER);
  const vault = o.vault as Hex;
  const pub = publicClientFor(TESTNET.evm);
  const serviceId = o.serviceId ?? 0;
  const price = (await pub.readContract({ address: vault, abi: VAULT_ABI, functionName: "servicePrice", args: [BigInt(serviceId)] })) as bigint;

  const resolve = createRecipientResolver({ rest: TESTNET.rest, chainId: TESTNET.chainId, card: (qor) => fetchCard(apiUrl, qor) });
  const recipient = await resolve(o.spender);
  if (!recipient) throw new Error("the business spender has no ML-KEM key on chain; run seal-keys first");
  const text = sealRequest({ body: { v: 1, serviceId, input: o.input }, vault: o.vault, recipient, chainId: TESTNET.chainId });
  const res = await fetch(`${apiUrl}/v1/envelopes`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: "request", body: text }), signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`posting the request failed: HTTP ${res.status} ${await res.text()}`);
  const { hash } = (await res.json()) as { hash: string };
  if (hash.toLowerCase() !== envelopeHash(text).toLowerCase()) throw new Error("the backend hash differs from the local envelope hash");

  const windowTx = await ensureWindow(buyer, [FUSD_ADDRESS, o.vault], BUYER_WINDOW);
  if (windowTx) log(`window tx ${windowTx}`);
  const wallet = walletFor(buyer.privateKey as Hex, TESTNET.evm);
  const send = async (to: Hex, data: Hex) => {
    const tx = await wallet.sendTransaction({ account: wallet.account!, chain: wallet.chain, to, data });
    const receipt = await pub.waitForTransactionReceipt({ hash: tx });
    if (receipt.status !== "success") throw new Error(`reverted: ${tx}`);
    return { hash: tx, logs: receipt.logs };
  };
  const allowance = (await pub.readContract({ address: FUSD_ADDRESS, abi: ERC20_ABI, functionName: "allowance", args: [buyer.evm as Hex, vault] })) as bigint;
  if (allowance < price) {
    const approve = await send(FUSD_ADDRESS, encodeFunctionData({ abi: ERC20_ABI, functionName: "approve", args: [vault, price] }));
    log(`approve tx ${approve.hash}`);
  }
  const bought = await send(vault, encodeFunctionData({ abi: VAULT_ABI, functionName: "buy", args: [BigInt(serviceId), hash as Hex] }));
  log(`buy tx ${bought.hash}`);
  for (const l of bought.logs) {
    if (l.address.toLowerCase() !== o.vault.toLowerCase()) continue;
    try {
      const ev = decodeEventLog({ abi: VAULT_EVENTS, data: l.data, topics: l.topics });
      if (ev.eventName === "OrderPlaced") return { orderId: ev.args.orderId.toString() };
    } catch {
      // another event
    }
  }
  throw new Error(`no OrderPlaced event in ${bought.hash}`);
}

/** Reads the order from the backend, fetches the delivered envelope and opens it with the buyer keys. */
export async function readDemoReport(ks: Keystore, apiUrl: string, o: { vault: string; orderId: string }): Promise<unknown> {
  const r = await fetch(`${apiUrl}/v1/orders?vault=${o.vault}`, { signal: AbortSignal.timeout(20_000) });
  if (!r.ok) throw new Error(`order lookup failed: HTTP ${r.status}`);
  const order = ((await r.json()) as (Order & { status: string; envelopeHash: string | null })[]).find((x) => x.orderId === o.orderId);
  if (!order) throw new Error(`order ${o.orderId} not found`);
  if (!order.envelopeHash) throw new Error(`order ${o.orderId} has no report yet (status ${order.status})`);
  const e = await fetch(`${apiUrl}/v1/envelopes/${order.envelopeHash}`, { signal: AbortSignal.timeout(20_000) });
  if (!e.ok) throw new Error(`report fetch failed: HTTP ${e.status}`);
  const { body } = (await e.json()) as { body: string };
  if (envelopeHash(body).toLowerCase() !== order.envelopeHash.toLowerCase()) throw new Error("the report does not match the delivered hash");
  const plain = open({
    chainId: TESTNET.chainId, purpose: REPORT_PURPOSE, envelope: envelopeFromText(body), keys: buyerSealKeys(ks),
    aad: utf8(`${o.vault.toLowerCase()}:${o.orderId}`),
  });
  return JSON.parse(new TextDecoder().decode(plain));
}
