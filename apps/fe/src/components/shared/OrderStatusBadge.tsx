import { useNow } from "@/hooks/useNow";
import { formatFusd } from "@/lib/format";
import type { Order } from "@/lib/schemas";
import { cn } from "@/lib/utils";

// Badge/Success (Delivered, Accepted), Badge/Info (Pending, In review), Badge/Danger (Declined, Rejected) in the design.
const LOOK: Record<Order["status"], { label: string; className: string }> = {
  open: { label: "Pending", className: "bg-info-soft text-info" },
  claimed: { label: "In progress", className: "bg-info-soft text-info" },
  delivered: { label: "Delivered", className: "bg-success-soft text-success" },
  in_review: { label: "In review", className: "bg-info-soft text-info" },
  settled: { label: "Accepted", className: "bg-success-soft text-success" },
  rejected: { label: "Rejected", className: "bg-danger-soft text-danger" },
  declined: { label: "Declined", className: "bg-danger-soft text-danger" },
  reclaimed: { label: "Reclaimed", className: "bg-warning-soft text-warning" },
};

/** "23 h left", counted down to the hour; the last hour reads "less than 1 h left". */
function hoursLeft(reviewEnds: Date, now: number): string | null {
  const ms = +reviewEnds - now;
  if (ms <= 0) return null;
  const h = Math.floor(ms / 3_600_000);
  return h < 1 ? "less than 1 h left" : `${h} h left`;
}

function labelFor(status: Order["status"], reviewEnds: Date | null | undefined, refund: bigint | null | undefined, now: number): string {
  const base = LOOK[status].label;
  if (status === "in_review" && reviewEnds) {
    const left = hoursLeft(reviewEnds, now);
    return left ? `${base}, ${left}` : base;
  }
  if (status === "rejected" && refund != null) return `${base}, ${formatFusd(refund)} refunded`;
  return base;
}

export function OrderStatusBadge({
  status,
  reviewEnds,
  refund,
  now,
}: {
  status: Order["status"];
  /** The end of the review of a v2 delivery; adds the time left to "In review". */
  reviewEnds?: Date | null;
  /** What a rejection returned; adds the amount to "Rejected". */
  refund?: bigint | null;
  /** The current time; read from a ticking clock when absent. */
  now?: number;
}) {
  const clock = useNow();
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-1.5 text-[13px] leading-none font-medium",
        LOOK[status].className,
      )}
    >
      {labelFor(status, reviewEnds, refund, now ?? clock)}
    </span>
  );
}
