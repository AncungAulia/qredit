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

/** The new keys typed for a RotateAgent order, as 0x text; null while one is not a valid address yet. */
export type AgentKeys = { spender: string | null; operator: string | null };

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/**
 * The vault's `_canBeAgent` for the roles this page can read: an agent key may not be the vault, the owner key or the
 * payout address. A currently allowed supplier is left to the dry run, because the supplier list is not read here.
 */
function agentKeyRefusal(keys: AgentKeys, rules: Rules): string | null {
  for (const key of [keys.spender, keys.operator]) {
    if (key === null) continue;
    if (same(key, rules.vault)) return "An agent key cannot be the vault itself.";
    if (same(key, rules.ownerPq) || same(key, rules.ownerPayout)) return "An agent key cannot be an owner address.";
  }
  return null;
}

export function precheck(kind: PolicyKind, value: bigint | null, rules: Rules, keys?: AgentKeys): string | null {
  if (isEnded(rules.state)) return ENDED_SENTENCE;
  if (KIND_INFO[kind].widening && rules.state !== "Repaid") return LOCKED_SENTENCE;
  switch (kind) {
    case "RotateAgent":
      return keys ? agentKeyRefusal(keys, rules) : null;
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
