import { LOAN_VAULT_ABI, VAULT_EVENTS, envelopeHash, openReport } from "@qredit/qore";
import { encodeFunctionData, getAbiItem } from "viem";
import { z } from "zod";
import { api, ApiError, parseResponse } from "@/lib/apiClient";
import { publicClient } from "@/lib/chain";
import { env } from "@/lib/env";
import type { Business, Order } from "@/lib/schemas";
import { getBlockTimes, getBusinesses, getOrders } from "@/modules/market/api/market.api";
import { testWalletOf, ensureWindowFor, evmSignerFor, TxFailed, type EvmSigner } from "@/modules/wallet/signer";
import type { WalletSession } from "@/modules/wallet/session";

type Hex = `0x${string}`;

/** One order of the buyer with the business it was placed with. */
export type InboxOrder = Order & { business: Business };

export type Delivery = {
  /** The hash the vault emitted for this order, read from the chain. */
  envelopeHash: Hex;
  deliveredTx: Hex;
  blockNumber: number;
  /** The time of the delivery block, or null when it could not be read. */
  deliveredAt: Date | null;
  /** The sealed text of the report, already checked against `envelopeHash`. */
  text: string;
};

export type OpenedReport = { report: unknown; envelopeHash: Hex; deliveredTx: Hex };

/** The stored envelope is not the one the vault recorded as delivered. It is never opened. */
export class ReportDoesNotMatch extends Error {
  constructor(
    readonly expected: Hex,
    readonly actual: Hex,
  ) {
    super("The stored report does not match the delivery recorded on chain.");
    this.name = "ReportDoesNotMatch";
  }
}

/** The chain holds no Delivered record for the order. */
export class DeliveryNotFound extends Error {
  constructor() {
    super("No delivery was found on chain for this order.");
    this.name = "DeliveryNotFound";
  }
}

/** The session holds no seal keys: only the test wallet has them. */
export class NoSealKeys extends Error {
  constructor() {
    super("A test wallet is needed to open reports.");
    this.name = "NoSealKeys";
  }
}

export const NO_TEST_WALLET_SENTENCE = "A test wallet is needed to send this transaction. Create or unlock one first.";

const envelopeSchema = z.object({ kind: z.string(), body: z.string() });

/** Orders placed by one buyer in every listed business, newest first. A vault that cannot be read fails the whole read. */
export async function readMyOrders(evm: Hex, businesses: Business[]): Promise<InboxOrder[]> {
  const me = evm.toLowerCase();
  const perBusiness = await Promise.all(
    businesses.map(async (business) => {
      const orders = await getOrders(business.vault);
      return orders.filter((o) => o.buyer.toLowerCase() === me).map((o): InboxOrder => ({ ...o, business }));
    }),
  );
  return perBusiness.flat().sort((a, b) => b.placedBlock - a.placedBlock);
}

export { getBlockTimes };

const DELIVERED = getAbiItem({ abi: VAULT_EVENTS, name: "Delivered" });

// The node answers a log search over at most 10,000 blocks, so the search walks forward in windows of that size.
const LOG_WINDOW = 10_000n;
const MAX_WINDOWS = 30;

// The agent delivers before the deadline, so the search may stop a margin of blocks after the estimated deadline block.
const DEADLINE_MARGIN = 1_000n;

/**
 * Where the log search ends: the newest block, or earlier when the block of the deadline can be estimated from the
 * block times of the start and of the newest block. When the times cannot be read, the newest block is kept.
 */
async function searchEnd(latest: bigint, from: bigint, deadline: Date | undefined): Promise<bigint> {
  if (!deadline || latest <= from) return latest;
  try {
    const [start, head] = await Promise.all([publicClient.getBlock({ blockNumber: from }), publicClient.getBlock({ blockNumber: latest })]);
    const seconds = Number(head.timestamp - start.timestamp);
    if (seconds <= 0) return latest;
    const perBlock = seconds / Number(latest - from);
    const ahead = Math.max(0, deadline.getTime() / 1000 - Number(start.timestamp));
    const end = from + BigInt(Math.ceil(ahead / perBlock)) + DEADLINE_MARGIN;
    return end < latest ? end : latest;
  } catch {
    return latest;
  }
}

/** The Delivered log of one order, searched from `fromBlock` (default: the newest window) to the deadline block or the newest block. */
async function findDeliveredLog(vault: Hex, orderId: string, fromBlock?: number, deadline?: Date) {
  const head = await publicClient.getBlockNumber();
  let from = fromBlock === undefined ? (head >= LOG_WINDOW ? head - LOG_WINDOW + 1n : 0n) : BigInt(fromBlock);
  const latest = fromBlock === undefined ? head : await searchEnd(head, from, deadline);
  for (let i = 0; i < MAX_WINDOWS && from <= latest; i++) {
    const to = from + LOG_WINDOW - 1n < latest ? from + LOG_WINDOW - 1n : latest;
    const logs = await publicClient.getLogs({ address: vault, event: DELIVERED, args: { orderId: BigInt(orderId) }, fromBlock: from, toBlock: to });
    if (logs[0]) return logs[0];
    from = to + 1n;
  }
  return null;
}

/**
 * Reads what the vault recorded as delivered for one order, fetches the envelope under that hash and checks
 * that the text hashes to it. The hash comes from the chain log, never from the backend. `fromBlock` is the
 * block the order was placed in and `deadline` its deadline, so the log search stays short.
 */
export async function readDelivery(vault: Hex, orderId: string, fromBlock?: number, deadline?: Date): Promise<Delivery> {
  const log = await findDeliveredLog(vault, orderId, fromBlock, deadline);
  if (!log) throw new DeliveryNotFound();
  const recorded = (log.args as { envelopeHash: Hex }).envelopeHash;

  const res = await api.get<unknown>(`/v1/envelopes/${recorded}`);
  const { body } = parseResponse(envelopeSchema, res.data);
  const actual = envelopeHash(body);
  if (actual.toLowerCase() !== recorded.toLowerCase()) throw new ReportDoesNotMatch(recorded, actual);

  let deliveredAt: Date | null = null;
  try {
    const block = await publicClient.getBlock({ blockNumber: log.blockNumber });
    deliveredAt = new Date(Number(block.timestamp) * 1000);
  } catch {
    // The time is only a label; the delivery itself is already proven.
  }
  return { envelopeHash: recorded, deliveredTx: log.transactionHash as Hex, blockNumber: Number(log.blockNumber), deliveredAt, text: body };
}

/** Opens a checked delivery with the seal keys of the test wallet. Throws ReportUnreadable for a report sealed to another key. */
export function openDelivery(session: WalletSession, vault: Hex, orderId: string, delivery: Delivery): OpenedReport {
  const wallet = testWalletOf(session);
  if (!wallet) throw new NoSealKeys();
  const report = openReport({ text: delivery.text, vault, orderId, keys: wallet.sealKeys, chainId: env.chainId });
  return { report, envelopeHash: delivery.envelopeHash, deliveredTx: delivery.deliveredTx };
}

/** The whole path in one call: read the Delivered log, fetch and check the envelope, open it with the session keys. */
export async function openMyReport(session: WalletSession, vault: Hex, orderId: string, fromBlock?: number): Promise<OpenedReport> {
  const delivery = await readDelivery(vault, orderId, fromBlock);
  return openDelivery(session, vault, orderId, delivery);
}

/** The order and its business for the report page; an order that is not in the latest list is not found. */
export async function readReportContext(vault: Hex, orderId: string): Promise<{ business: Business; order: Order }> {
  const business = (await getBusinesses()).find((b) => b.vault.toLowerCase() === vault.toLowerCase());
  if (!business) throw new ApiError("notFound", 404);
  const orders = await getOrders(business.vault);
  const order = orders.find((o) => o.orderId === orderId);
  if (!order) throw new ApiError("notFound", 404);
  return { business, order };
}

/** Takes the price of a late open order back. Opens the scoped window for the vault first. */
export async function reclaim(session: WalletSession, vault: Hex, orderId: string): Promise<Hex> {
  const signer: EvmSigner | null = evmSignerFor(session);
  if (!signer) throw new TxFailed(null, NO_TEST_WALLET_SENTENCE);
  await ensureWindowFor(session, [vault]);
  return signer.send(vault, encodeFunctionData({ abi: LOAN_VAULT_ABI, functionName: "reclaim", args: [BigInt(orderId)] }));
}
