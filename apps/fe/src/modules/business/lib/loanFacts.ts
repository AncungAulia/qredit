import { formatBps, formatDuration } from "@/lib/format";

const BPS = 10_000n;

/** What lenders earn on top of the amount lent, in basis points. Zero when nothing was set as the target. */
export function lenderReturnBps(target: bigint, totalOwed: bigint): number {
  if (target <= 0n || totalOwed <= target) return 0;
  return Number(((totalOwed - target) * BPS) / target);
}

/** The share of each sale kept for operating costs, which the vault does not store but derives. */
export const opexBps = (lenderBps: number, ownerBps: number) => 10_000 - lenderBps - ownerBps;

export const splitText = (lenderBps: number, ownerBps: number) =>
  `${formatBps(lenderBps)} to lenders, ${formatBps(ownerBps)} to the owner, ${formatBps(opexBps(lenderBps, ownerBps))} for operating costs`;

/** "Every hour", "Every 2 days". */
export function everyPeriod(seconds: number): string {
  const text = formatDuration(seconds);
  return `Every ${text.startsWith("1 ") ? text.slice(2) : text}`;
}

/** "dataIndexer" becomes "data indexer", for the supplier roles the agent records in its decisions. */
export const roleLabel = (role: string) => role.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
