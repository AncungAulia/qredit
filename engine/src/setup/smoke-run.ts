/** The record of a smoke run: public hashes and dry-run refusals only. */
export type Run = { vault: `0x${string}`; startBlock: number; txs: Record<string, string>; refusals: Record<string, string> };

/** `OrderStatus.InReview` of the v2 vault. */
export const IN_REVIEW = 2;
/** The EVM chain id of qorechain-diana. */
export const EVM_CHAIN_ID = 9800;

/**
 * Runs `fn` for a step unless its key is already recorded, and saves the record right after, so a rerun resumes
 * where the last run stopped and no hash is lost.
 */
export async function recordStep(
  txs: Record<string, string>, key: string, fn: () => Promise<string | null | undefined>, save: () => void,
): Promise<string | undefined> {
  if (txs[key]) return txs[key];
  const hash = await fn();
  if (!hash) return undefined;
  txs[key] = hash;
  save();
  return hash;
}

/** The same for a dry-run refusal: computed once, kept in the record. */
export async function recordRefusal(run: Run, key: string, fn: () => Promise<string>, save: () => void): Promise<string> {
  if (run.refusals[key]) return run.refusals[key]!;
  const name = await fn();
  run.refusals[key] = name;
  save();
  return name;
}

/** Why phase b cannot start, or null when phase a finished and order 3 is still in review or past it. */
export function phaseBBlocker(run: Run, order3Status: number): string | null {
  const missing = [
    ...["deliver3", "reject2"].filter((k) => !run.txs[k]).map((k) => `txs.${k}`),
    ...(run.refusals.closeByNonOwner ? [] : ["refusals.closeByNonOwner"]),
  ];
  if (missing.length > 0) return `phase a did not finish (missing ${missing.join(", ")}); rerun phase a`;
  if (order3Status !== IN_REVIEW && !run.txs.settle3) return `order 3 is not in review (status ${order3Status})`;
  return null;
}
