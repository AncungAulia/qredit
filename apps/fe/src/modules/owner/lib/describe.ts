import { formatFusd, shortAddress } from "@/lib/format";
import { KIND_INFO, POLICY_KINDS, type PolicyOrder } from "@/modules/owner/schemas/policyOrder.schema";

/** One sentence that says what an order changes, for the confirmation and the result. */
export function orderSentence(order: PolicyOrder): string {
  const kind = POLICY_KINDS[order.kind];
  const amount = formatFusd(order.value);
  const supplier = shortAddress(order.target);
  switch (kind) {
    case "Pause":
      return "Pause the agent";
    case "Unpause":
      return "Resume the agent";
    case "LowerDailyCap":
      return `Lower the daily spending cap to ${amount}`;
    case "RaiseDailyCap":
      return `Raise the daily spending cap to ${amount}`;
    case "RemoveSupplier":
      return `Remove the supplier ${supplier}`;
    case "LowerSupplierCap":
      return `Lower the limit of ${supplier} to ${amount} for each payment`;
    case "RaiseSupplierCap":
      return `Raise the limit of ${supplier} to ${amount} for each payment`;
    case "AddSupplier":
      return `Add the supplier ${supplier} with a limit of ${amount} for each payment`;
    case "Close":
      return "Close the loan and move the operating funds, the owner share and the bond to lenders";
    case "RotateAgent":
      return `Replace the agent keys with spending key ${supplier} and operator key ${shortAddress(`0x${order.value.toString(16).padStart(40, "0")}`)}`;
    default:
      return KIND_INFO.Pause.label;
  }
}

/** The headline of a finished order. */
export function appliedTitle(order: PolicyOrder): string {
  const kind = POLICY_KINDS[order.kind];
  const amount = formatFusd(order.value);
  switch (kind) {
    case "Pause":
      return "The agent is paused";
    case "Unpause":
      return "The agent is active again";
    case "LowerDailyCap":
      return `Daily cap lowered to ${amount}`;
    case "RaiseDailyCap":
      return `Daily cap raised to ${amount}`;
    case "RemoveSupplier":
      return "Supplier removed";
    case "LowerSupplierCap":
      return `Supplier limit lowered to ${amount}`;
    case "RaiseSupplierCap":
      return `Supplier limit raised to ${amount}`;
    case "AddSupplier":
      return `Supplier added with a limit of ${amount}`;
    case "Close":
      return "The loan is closed";
    case "RotateAgent":
      return "The agent keys are replaced";
    default:
      return "Policy order applied";
  }
}

/** True for an order that cannot be undone once applied. */
export const isIrreversible = (order: PolicyOrder): boolean => KIND_INFO[POLICY_KINDS[order.kind]]?.irreversible === true;

/** What the Apply confirmation says. An irreversible order says so before anything is sent. */
export function applyBody(order: PolicyOrder): string {
  const base =
    "The vault checks your signature and then changes its rules. This sends one transaction from your test wallet, and the network fee is paid in QOR by that wallet.";
  return isIrreversible(order)
    ? `${base} Closing ends the loan for good: the business stops selling and its operating funds, owner share and bond go to lenders. This cannot be undone.`
    : base;
}
