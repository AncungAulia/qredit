// Turns a failed chain call into one formal sentence. Raw revert data never reaches the screen.
import { decodeErrorResult, parseAbi } from "viem";
import { LOAN_VAULT_ABI } from "@qredit/qore/abis";

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
  Ended: "The loan has ended, so the vault refuses this action.",
  OverOrderPrice: "This payment would cost more than the price of the order.",
  NotInReview: "This order is not waiting for a review.",
  ReviewOpen: "The review of this order has not ended yet.",
  ReviewOver: "The review of this order has ended, so it can no longer be rejected.",
  OwnerClaimNotAhead: "The owner can claim only while the loan is one installment ahead of its schedule.",
  NotDefaultable: "The loan is not far enough behind its schedule or past its maturity to be defaulted.",
  BuyerNotAllowed: "The owner, the agent and the suppliers of this business cannot buy from it.",
  NotAgent: "Only the agent of the vault can do this.",
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

/** Standard OpenZeppelin v5 ERC-20 errors; the testnet fUSD reverts with these (captured live, see the fixtures). */
export const ERC20_ERRORS_ABI = parseAbi([
  "error ERC20InsufficientBalance(address sender, uint256 balance, uint256 needed)",
  "error ERC20InsufficientAllowance(address spender, uint256 allowance, uint256 needed)",
  "error ERC20InvalidSender(address sender)",
  "error ERC20InvalidReceiver(address receiver)",
  "error ERC20InvalidApprover(address approver)",
  "error ERC20InvalidSpender(address spender)",
]);

export const ERC20_ERROR_SENTENCES: Record<string, string> = {
  ERC20InsufficientBalance: "The fUSD balance is too low for this transaction.",
  ERC20InsufficientAllowance: "The fUSD allowance for the vault is too low for this transaction.",
  ERC20InvalidSender: "The sender address is not valid for an fUSD transfer.",
  ERC20InvalidReceiver: "The receiver address is not valid for an fUSD transfer.",
  ERC20InvalidApprover: "The approver address is not valid for an fUSD approval.",
  ERC20InvalidSpender: "The spender address is not valid for an fUSD approval.",
};

const BALANCE_SENTENCE = "The fUSD balance is too low for this transaction.";
const ALLOWANCE_SENTENCE = "The fUSD allowance for the vault is too low for this transaction.";

/** Known revert strings (older ERC-20 implementations); any other text is never shown. */
const REVERT_STRINGS: Record<string, string> = {
  "ERC20: transfer amount exceeds balance": BALANCE_SENTENCE,
  "ERC20: insufficient allowance": ALLOWANCE_SENTENCE,
  "ERC20: transfer amount exceeds allowance": ALLOWANCE_SENTENCE,
};

const DECODE_ABI = [
  ...LOAN_VAULT_ABI.filter((i) => i.type === "error"),
  ...ERC20_ERRORS_ABI,
  { type: "error", name: "Error", inputs: [{ name: "message", type: "string" }] },
] as const;

const HEX_DATA = /^0x[0-9a-fA-F]{8,}$/;

/** Raw hex revert data found anywhere on the error chain (viem nests it under `cause`; live nodes put it on `data`). */
function findRevertData(error: unknown): `0x${string}` | null {
  const seen = new Set<unknown>();
  let node: unknown = error;
  while (node && typeof node === "object" && !seen.has(node)) {
    seen.add(node);
    const data = (node as { data?: unknown }).data;
    if (typeof data === "string" && HEX_DATA.test(data)) return data as `0x${string}`;
    if (data && typeof data === "object") {
      const nested = (data as { data?: unknown }).data;
      if (typeof nested === "string" && HEX_DATA.test(nested)) return nested as `0x${string}`;
    }
    node = (node as { cause?: unknown }).cause;
  }
  return null;
}

export function revertSentence(error: unknown): string {
  const data = findRevertData(error);
  if (data) {
    try {
      const decoded = decodeErrorResult({ abi: DECODE_ABI, data });
      if (decoded.errorName === "Error") return REVERT_STRINGS[String(decoded.args?.[0])] ?? GENERIC_REFUSAL;
      return VAULT_ERROR_SENTENCES[decoded.errorName] ?? ERC20_ERROR_SENTENCES[decoded.errorName] ?? GENERIC_REFUSAL;
    } catch {
      // Not a known error: fall through to the message checks.
    }
  }
  // Last resort for nodes that send no revert data.
  const text = error instanceof Error ? `${error.message} ${(error as { shortMessage?: string }).shortMessage ?? ""}` : "";
  if (/(insufficient|exceeds) balance|balance too low/i.test(text)) return BALANCE_SENTENCE;
  if (/allowance/i.test(text)) return ALLOWANCE_SENTENCE;
  return GENERIC_REFUSAL;
}
