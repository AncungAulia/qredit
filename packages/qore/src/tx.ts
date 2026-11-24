import { StargateClient } from "@cosmjs/stargate";
import type { EncodeObject, Registry } from "@cosmjs/proto-signing";
import { EthNativeSigner, type UnifiedAccount } from "@qorechain/sdk";
import type { Net } from "./net.ts";

export type RestEvent = { type: string; attributes: { key: string; value: string }[] };
export type Sent = { hash: string; code: number; rawLog?: string };

/** Nothing was broadcast: CheckTx refused it, or connecting/preparing failed before any hash existed. Safe to retry. */
export class BroadcastRefused extends Error {}
/** A hash exists, so the coins may have moved; the outcome is unknown. */
export class BroadcastUnconfirmed extends Error {
  constructor(readonly hash: string, message: string) {
    super(message);
  }
}
/** The tx was included but failed in execution (code != 0 on chain). */
export class TxFailedOnChain extends Error {
  constructor(readonly hash: string, message: string) {
    super(message);
  }
}

const REST_TIMEOUT_MS = 15_000;
const restGet = (url: string) => fetch(url, { signal: AbortSignal.timeout(REST_TIMEOUT_MS) });

const CONNECT_TIMEOUT_MS = 15_000;
async function connectRpc(rpc: string): Promise<StargateClient> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`RPC connect timed out after ${CONNECT_TIMEOUT_MS / 1000} s`)), CONNECT_TIMEOUT_MS);
  });
  try {
    return await Promise.race([StargateClient.connect(rpc), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

async function accountNumbers(rest: string, address: string): Promise<{ accountNumber: bigint; sequence: bigint }> {
  const res = await restGet(`${rest}/cosmos/auth/v1beta1/accounts/${address}`);
  if (res.status === 404) throw new Error(`${address} does not exist on chain yet`);
  if (!res.ok) throw new Error(`account query failed: HTTP ${res.status}`);
  const body = (await res.json()) as { account: Record<string, unknown> };
  const base = (body.account.base_account ?? body.account) as Record<string, string>;
  return { accountNumber: BigInt(base.account_number ?? "0"), sequence: BigInt(base.sequence ?? "0") };
}

/**
 * Sign hybrid (secp256k1 + ML-DSA-87) and broadcast. Returns after CheckTx; use txEvents for the result.
 * The sequence is read from REST, so callers MUST await txEvents (inclusion) before the next send from the
 * same account; serial() only orders the calls, it does not wait for blocks.
 */
export async function broadcastHybrid(
  net: Net,
  acc: UnifiedAccount,
  messages: EncodeObject[],
  opts: { memo?: string; gas?: string; feeUqor?: string; registry?: Registry } = {},
): Promise<Sent> {
  let accountNumber: bigint, sequence: bigint, signer: EthNativeSigner, transport: StargateClient;
  try {
    ({ accountNumber, sequence } = await accountNumbers(net.rest, acc.cosmos));
    signer = new EthNativeSigner(acc, { signMode: "hybrid", rest: net.rest, registry: opts.registry });
    transport = await connectRpc(net.rpc);
  } catch (e) {
    throw new BroadcastRefused(e instanceof Error ? e.message : String(e), { cause: e });
  }
  try {
    const res = await signer.signAndBroadcast(transport, {
      chainId: net.chainId,
      accountNumber,
      sequence,
      memo: opts.memo ?? "",
      messages,
      fee: { amount: [{ denom: "uqor", amount: opts.feeUqor ?? "150000" }], gas: opts.gas ?? "1000000" },
    });
    return { hash: res.transactionHash, code: res.code, rawLog: res.rawLog };
  } finally {
    transport.disconnect();
  }
}

export async function txEvents(rest: string, hash: string, tries = 20, delayMs = 1500): Promise<RestEvent[]> {
  for (let i = 0; i < tries; i++) {
    if (i > 0) await Bun.sleep(delayMs);
    const res = await restGet(`${rest}/cosmos/tx/v1beta1/txs/${hash}`);
    if (!res.ok) continue;
    const body = (await res.json()) as { tx_response?: { code: number; raw_log?: string; events: RestEvent[] } };
    const tx = body.tx_response;
    if (!tx) continue; // not indexed yet: treat like not found and retry
    if (tx.code !== 0) throw new TxFailedOnChain(hash, `tx ${hash} failed with code ${tx.code}: ${tx.raw_log ?? ""}`);
    return tx.events ?? [];
  }
  throw new Error(`tx ${hash} not found (or no tx_response) after ${tries} tries over ${((tries - 1) * delayMs) / 1000} s`);
}

/** A refused MsgExecuteEVM still has tx code 0; the failure shows only as this event. */
export function executionFailure(events: RestEvent[]): string | null {
  const ev = events.find((e) => e.type === "abstractaccount_execution_failed");
  if (!ev) return null;
  return ev.attributes.find((a) => a.key === "reason" || a.key === "error")?.value || "execution failed";
}

/** Run async tasks one at a time (one signing account = one sequence). */
export function serial(): <T>(fn: () => Promise<T>) => Promise<T> {
  let tail: Promise<unknown> = Promise.resolve();
  return <T>(fn: () => Promise<T>) => {
    const run = tail.then(fn, fn);
    tail = run.then(() => undefined, () => undefined);
    return run;
  };
}
