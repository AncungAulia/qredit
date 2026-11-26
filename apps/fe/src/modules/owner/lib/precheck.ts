import { formatFusd } from "@/lib/format";
import type { Rules } from "@/modules/owner/api/owner.api";
import { isEnded } from "@/lib/vaultState";
import { KIND_INFO, type PolicyKind } from "@/modules/owner/schemas/policyOrder.schema";

export const LOCKED_SENTENCE = "Locked until the loan is repaid. The vault refuses this change until then.";

/**
 * A message when the vault would refuse this change for the rules it has right now, so the owner is stopped before
 * signing. `value` is the amount in units, or null while none is entered. Supplier limits are not judged here: the
 * vault's own check (the dry run) decides those.
 */
export const ENDED_SENTENCE = "The loan has ended, so the vault takes no more policy orders.";

export function precheck(kind: PolicyKind, value: bigint | null, rules: Rules): string | null {
  if (isEnded(rules.state)) return ENDED_SENTENCE;
  if (KIND_INFO[kind].widening && rules.state !== "Repaid") return LOCKED_SENTENCE;
  switch (kind) {
    case "Close":
      if (rules.state === "Repaid") return "A repaid loan cannot be closed.";
      return rules.state === "Active" || rules.state === "Trapped" ? null : "The loan can be closed only once it is funded and running.";
    case "Pause":
      return rules.paused ? "The agent is already paused." : null;
    case "Unpause":
      return rules.paused ? null : "The agent is not paused.";
    case "LowerDailyCap":
      return value !== null && value >= rules.dailyCap
        ? `Enter an amount below the current daily cap of ${formatFusd(rules.dailyCap)}.`
        : null;
    case "RaiseDailyCap":
      return value !== null && value <= rules.dailyCap
        ? `Enter an amount above the current daily cap of ${formatFusd(rules.dailyCap)}.`
        : null;
    default:
      return null;
  }
}
