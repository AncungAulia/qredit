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
    default:
      return "Policy order applied";
  }
}
