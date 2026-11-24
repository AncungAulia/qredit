import { buildRegisterPqcKeyMsg, fetchPqcStatus, signProofOfPossession, type UnifiedAccount } from "@qorechain/sdk";
import { broadcastHybrid, convertCoinMsg, FUSD_DENOM, qoreRegistry, TESTNET, txEvents } from "@qredit/qore";

const net = TESTNET;

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
