import { Check, X, type LucideIcon } from "lucide-react";
import { EmptyState, ErrorState } from "@/components/shared/PageStates";
import { Skeleton } from "@/components/ui/skeleton";
import { formatFusd, formatRelative } from "@/lib/format";
import type { Decision } from "@/lib/schemas";
import { roleLabel } from "@/modules/business/lib/loanFacts";

// Row/Decision icons: success for what went through, danger for what did not.
const LOOK: Record<
  Decision["decision"],
  { label: string; icon: LucideIcon; wrap: string; ink: string }
> = {
  accepted: { label: "Accepted", icon: Check, wrap: "bg-success-soft", ink: "text-success" },
  delivered: { label: "Delivered", icon: Check, wrap: "bg-success-soft", ink: "text-success" },
  declined: { label: "Declined", icon: X, wrap: "bg-danger-soft", ink: "text-danger" },
  failed: { label: "Failed", icon: X, wrap: "bg-danger-soft", ink: "text-danger" },
};

function DecisionRow({ d }: { d: Decision }) {
  const { label, icon: Icon, wrap, ink } = LOOK[d.decision];
  return (
    <div className="flex items-start gap-4 py-3.5">
      <span className={`grid size-8 shrink-0 place-items-center rounded-full ${wrap}`}>
        <Icon className={`size-4 ${ink}`} aria-hidden />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="text-[15px] font-medium text-text-primary">
          {label}
          {d.orderId !== null && ` order ${d.orderId}`}
        </span>
        <span className="text-sm text-text-secondary first-letter:uppercase">{d.reason}</span>
        {d.suppliers.length > 0 && (
          <span className="text-sm text-text-secondary tabular-nums">
            Bought{" "}
            {d.suppliers.map((s) => `${roleLabel(s.role)} for ${formatFusd(s.amount)}`).join(", ")}.
          </span>
        )}
        {d.cost > 0n && (
          <span className="text-sm text-text-secondary tabular-nums">
            Cost {formatFusd(d.cost)}.
          </span>
        )}
      </div>
      <time
        dateTime={d.createdAt.toISOString()}
        className="shrink-0 text-[13px] text-text-tertiary"
      >
        {formatRelative(d.createdAt)}
      </time>
    </div>
  );
}

type Props = {
  decisions: Decision[] | undefined;
  isError: boolean;
  onRetry: () => void;
  /** The business is still raising, so the agent has not started to trade. */
  raising: boolean;
};

/** Every choice the agent made (Row/Decision in the design); on desktop the card fills the column. */
export function DecisionLog({ decisions, isError, onRetry, raising }: Props) {
  if (isError && !decisions) {
    return (
      <ErrorState
        layout="section"
        title="The decision log could not be loaded."
        onRetry={onRetry}
      />
    );
  }
  if (!decisions) {
    return (
      <div
        role="status"
        aria-busy="true"
        className="flex flex-1 flex-col gap-3 rounded-3xl bg-surface px-6 py-4"
      >
        <span className="sr-only">Loading</span>
        {Array.from({ length: 5 }, (_, i) => (
          <Skeleton key={i} className="h-7 w-full rounded-lg" />
        ))}
      </div>
    );
  }
  if (decisions.length === 0) {
    return (
      <EmptyState
        layout="section"
        art="waiting"
        title="No decisions yet"
        message={
          raising
            ? "The agent starts trading when the raise is complete."
            : "The agent has not made a decision yet."
        }
      />
    );
  }
  return (
    <div className="flex flex-1 animate-in flex-col gap-0.5 rounded-3xl bg-surface px-4 py-2 duration-200 fade-in md:px-6">
      {decisions.map((d) => (
        <DecisionRow key={d.id} d={d} />
      ))}
    </div>
  );
}
