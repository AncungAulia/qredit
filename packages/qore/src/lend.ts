import { VAULT_STATE } from "./abi.ts";

export type LendPlan =
  | { action: "skip"; reason: string }
  | { action: "deposit"; amount: bigint; approve: boolean };

/** Decide what lending needs: nothing, or a deposit (and whether an approve must precede it). Throws when the lender cannot cover it. */
export function planLend(v: { state: number; raised: bigint; target: bigint; balance: bigint; allowance: bigint }, requested: bigint): LendPlan {
  const closed: LendPlan = { action: "skip", reason: "already funded or closed" };
  if (v.state !== VAULT_STATE.Raising) return closed;
  const room = v.target - v.raised;
  if (room <= 0n) return closed;
  const amount = requested < room ? requested : room;
  if (amount <= 0n) throw new Error("nothing to lend: the amount must be positive");
  if (v.balance < amount) throw new Error(`insufficient fUSD: need ${amount} units, balance ${v.balance}`);
  return { action: "deposit", amount, approve: v.allowance < amount };
}
