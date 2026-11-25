// Turns a failed chain call into one formal sentence. Raw revert data never reaches the screen.
import { decodeErrorResult } from "viem";
import { LOAN_VAULT_ABI } from "@qredit/qore";

export const GENERIC_REFUSAL = "The transaction was refused.";

export const VAULT_ERROR_SENTENCES: Record<string, string> = {
  WrongState: "The loan is not in a state that allows this action.",
  ZeroAmount: "The amount must be greater than zero.",
  OverTarget: "This amount would raise more than the loan target.",
  Paused: "The vault is paused.",
  UnknownService: "The vault does not offer this service.",
  NotOperator: "Only the operator of the vault can do this.",
  NotSpender: "Only the spending agent of the vault can do this.",
  NotOwner: "Only the owner of the business can do this.",
  NotBuyer: "Only the buyer who placed the order can do this.",
  OrderNotOpen: "This order is no longer open.",
  OrderExpired: "This order has expired.",
  OrderNotExpired: "This order has not expired yet.",
  SupplierNotAllowed: "This supplier is not on the list the vault allows.",
  OverSupplierCap: "This payment is above the limit for this supplier.",
  OverDailyCap: "This payment is above the daily spending limit.",
  InsufficientOpex: "The vault does not hold enough operating funds for this payment.",
  TrappedNoOwnerClaim: "The owner cannot claim while the loan is trapped.",
  OwnerKeyNotRegistered: "The owner has not registered a post-quantum key yet.",
  OwnerKeyNotProven: "The owner key has not been proven yet.",
  BadNonce: "The nonce of this policy order is not the expected one.",
  OrderExpiredSig: "This signed policy order has expired.",
  BadPqcSignature: "The post-quantum signature does not match the policy order.",
  UnknownKind: "This kind of policy order is not known.",
  WideningLocked: "The vault refuses to widen its rules until the loan is repaid.",
  NotNarrowing: "This change would not narrow the rules of the vault.",
  BadOrder: "The policy order is not valid.",
  SafeERC20FailedOperation: "The fUSD transfer was refused, usually because the balance or the allowance is too low.",
  BadConfig: "The configuration of the vault is not valid.",
};

const BALANCE = /(insufficient|exceeds) balance|balance too low/i;
const ALLOWANCE = /allowance/i;

/** Raw hex revert data found anywhere on the error chain (viem nests it under `cause` and `data`). */
function findRevertData(error: unknown): `0x${string}` | null {
  const seen = new Set<unknown>();
  let node: unknown = error;
  while (node && typeof node === "object" && !seen.has(node)) {
    seen.add(node);
    const data = (node as { data?: unknown }).data;
    if (typeof data === "string" && /^0x[0-9a-fA-F]{8,}$/.test(data)) return data as `0x${string}`;
    if (data && typeof data === "object") {
      const nested = (data as { data?: unknown }).data;
      if (typeof nested === "string" && /^0x[0-9a-fA-F]{8,}$/.test(nested)) return nested as `0x${string}`;
    }
    node = (node as { cause?: unknown }).cause;
  }
  return null;
}

export function revertSentence(error: unknown): string {
  const data = findRevertData(error);
  if (data) {
    try {
      const { errorName } = decodeErrorResult({ abi: LOAN_VAULT_ABI, data });
      const sentence = VAULT_ERROR_SENTENCES[errorName];
      if (sentence) return sentence;
    } catch {
      // Not a vault error: fall through to the message checks.
    }
  }
  const text = error instanceof Error ? `${error.message} ${(error as { shortMessage?: string }).shortMessage ?? ""}` : "";
  if (BALANCE.test(text)) return "The balance is too low for this transaction.";
  if (ALLOWANCE.test(text)) return "The allowance for fUSD is too low for this transaction.";
  return GENERIC_REFUSAL;
}
