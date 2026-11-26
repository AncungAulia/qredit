import { ERC20_ABI, FUSD_ADDRESS, VAULT_EVENTS } from "@qredit/qore/abi";
import { LOAN_VAULT_ABI } from "@qredit/qore/abis";
import { envelopeHash } from "@qredit/qore/hash";
import { decodeEventLog, encodeFunctionData, type TransactionReceipt } from "viem";
import { ERC20_ERROR_SENTENCES } from "@/components/shared/vaultErrors";
import { api, ApiError, parseResponse } from "@/lib/apiClient";
import { readVault, restUrl } from "@/lib/chain";
import { env } from "@/lib/env";
import { readFusdAllowance, readFusdBalance } from "@/lib/fusd";
import type { Business } from "@/lib/schemas";
import { envelopeResponseSchema } from "@/modules/orders/schemas/envelope.schema";
import type { WalletSession } from "@/modules/wallet/session";
import { act, beforePayment as beforePaymentWith, requireSigner } from "@/modules/wallet/act";
import { TxFailed, TxReverted } from "@/modules/wallet/signer";

type Hex = `0x${string}`;

/** Where an order is: each value is the step that is running, "placed" is the end. */
export type PlaceOrderProgress = "sealing" | "posting" | "window" | "approving" | "buying" | "placed";

export const NOT_SEALABLE_SENTENCE = "This business cannot receive sealed requests right now.";
export const NOT_STORED_SENTENCE = "The sealed request could not be stored. Nothing was paid; please try again.";
export const HASH_MISMATCH_SENTENCE = "The stored request does not match the sealed one. Nothing was paid; please try again.";
export const NOT_PAID_SENTENCE = "The order could not be prepared. Nothing was paid; please try again.";
export const NO_ORDER_SENTENCE =
  "The payment was sent, but the order number could not be read. Check your inbox before trying again.";

/** Runs a step that comes before any payment: a failure that is not already a decoded transaction failure says that nothing was paid. */
const beforePayment = <T>(step: () => Promise<T>): Promise<T> => beforePaymentWith(step, NOT_PAID_SENTENCE);

/** What one service costs and how long a buyer waits before a refund can be taken; both are read from the vault. */
export async function readQuote(vault: Hex, serviceId: number): Promise<{ price: bigint; ttlSeconds: number }> {
  const [price, ttl] = await Promise.all([readVault(vault, "servicePrice", [BigInt(serviceId)]), readVault(vault, "orderTtl")]);
  return { price, ttlSeconds: Number(ttl) };
}

/** The published recipient card of an address, or null when none exists. Any other failure is thrown. */
export async function fetchCard(qor: string): Promise<unknown | null> {
  try {
    const res = await api.get<{ card?: unknown }>(`/v1/cards/${qor}`);
    return res.data?.card ?? null;
  } catch (e) {
    if (e instanceof ApiError && e.kind === "notFound") return null;
    throw e;
  }
}

async function postRequest(text: string): Promise<Hex> {
  try {
    const res = await api.post<unknown>("/v1/envelopes", { kind: "request", body: text });
    return parseResponse(envelopeResponseSchema, res.data).hash;
  } catch {
    throw new TxFailed(null, NOT_STORED_SENTENCE);
  }
}

/** The order id the vault announced in the receipt of the buy. The payment is made, so a missing event keeps the hash. */
function orderIdOf(vault: Hex, hash: Hex, receipt: TransactionReceipt): string {
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== vault.toLowerCase()) continue;
    try {
      const event = decodeEventLog({ abi: VAULT_EVENTS, data: log.data, topics: log.topics });
      if (event.eventName === "OrderPlaced") return event.args.orderId.toString();
    } catch {
      // another event of the vault
    }
  }
  throw new TxFailed(hash, NO_ORDER_SENTENCE);
}

/**
 * Places one order: the request is sealed here, in the browser, to the key of the business spender; the sealed text
 * is stored and its hash compared with the local one; only then the wallet opens its window, approves the price when
 * the allowance is short, and buys. Every refusal before the payment says that nothing was paid.
 */
export async function placeOrder(
  session: WalletSession,
  business: Business,
  serviceId: number,
  input: string,
  onProgress: (step: PlaceOrderProgress) => void,
): Promise<{ orderId: string; buyTx: Hex }> {
  const signer = requireSigner(session);
  const vault = business.vault;
  const [{ price }, balance] = await beforePayment(() => Promise.all([readQuote(vault, serviceId), readFusdBalance(signer.address)]));
  if (balance < price) throw new TxReverted(null, ERC20_ERROR_SENTENCES.ERC20InsufficientBalance);

  onProgress("sealing");
  // The seal code is large; it loads when an order is placed, not with the page.
  const { createRecipientResolver, sealRequest } = await beforePayment(() => import("@qredit/qore/seal"));
  const resolve = createRecipientResolver({ rest: restUrl(), chainId: env.chainId, card: fetchCard });
  const recipient = await beforePayment(() => resolve(business.spender));
  if (!recipient) throw new TxFailed(null, NOT_SEALABLE_SENTENCE);
  const text = sealRequest({ body: { v: 1, serviceId, input }, vault, recipient, chainId: env.chainId });

  onProgress("posting");
  const hash = await postRequest(text);
  if (hash.toLowerCase() !== envelopeHash(text).toLowerCase()) throw new TxFailed(null, HASH_MISMATCH_SENTENCE);

  onProgress("window");
  // The window, the approval and the buy run under one lock of the account, so no other action slips between them.
  const { hash: buyTx, receipt } = await act(session, [FUSD_ADDRESS, vault], async (locked) => {
    // Read again right before the approval: the allowance may have changed since the form was opened.
    const allowance = await beforePayment(() => readFusdAllowance(locked.address, vault));
    if (allowance < price) {
      onProgress("approving");
      await locked.send(FUSD_ADDRESS, encodeFunctionData({ abi: ERC20_ABI, functionName: "approve", args: [vault, price] }));
    }
    onProgress("buying");
    return locked.sendForReceipt(vault, encodeFunctionData({ abi: LOAN_VAULT_ABI, functionName: "buy", args: [BigInt(serviceId), hash] }));
  });
  const orderId = orderIdOf(vault, buyTx, receipt);
  onProgress("placed");
  return { orderId, buyTx };
}
