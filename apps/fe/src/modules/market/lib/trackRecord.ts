import { formatBps, formatCount } from "@/lib/format";
import type { Business } from "@/lib/schemas";

/** Rejected over delivered reports, in basis points; null before any delivery or when the stats are not known. */
export function rejectionBps(stats: Business["stats"]): number | null {
  if (!stats || stats.delivered === 0) return null;
  return Math.round((stats.rejected * 10_000) / stats.delivered);
}

export function rejectionText(stats: Business["stats"]): string {
  if (!stats) return "Not known yet";
  const bps = rejectionBps(stats);
  return bps === null ? "No reports delivered yet" : `${formatBps(bps)} of ${formatCount(stats.delivered)} delivered reports rejected`;
}

/** First-time buyers as the vault counts them; v1 vaults do not count them. */
export const buyersText = (uniqueBuyers: number | null): string =>
  uniqueBuyers === null ? "Not counted by this vault" : `${formatCount(uniqueBuyers)} ${uniqueBuyers === 1 ? "buyer" : "buyers"}`;

/** The Buyers term of the loan card: different buyers and how many reports they rejected. */
export function buyersTerm(stats: Business["stats"]): string {
  if (!stats) return "Not known yet";
  const buyers = `${formatCount(stats.uniqueBuyers)} ${stats.uniqueBuyers === 1 ? "buyer" : "different buyers"}`;
  const rejected =
    stats.rejected === 0 ? "no report rejected" : `${formatCount(stats.rejected)} ${stats.rejected === 1 ? "report" : "reports"} rejected`;
  return `${buyers}, ${rejected}`;
}
