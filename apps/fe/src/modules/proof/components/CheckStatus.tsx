import { CircleCheck, CircleHelp, CircleMinus, CircleX, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { CheckResult } from "@/modules/proof/checks";

type Status = CheckResult["status"];

export const STATUS_LOOK: Record<
  Status,
  { label: string; icon: LucideIcon; badge: string; wrap: string }
> = {
  proven: {
    label: "Proven",
    icon: CircleCheck,
    badge: "bg-success-soft text-success",
    wrap: "bg-accent-soft text-accent-strong",
  },
  failed: {
    label: "Failed",
    icon: CircleX,
    badge: "bg-danger-soft text-danger",
    wrap: "bg-danger-soft text-danger",
  },
  unknown: {
    label: "Not proven yet",
    icon: CircleHelp,
    badge: "bg-surface-muted text-text-secondary",
    wrap: "bg-surface-muted text-text-tertiary",
  },
  na: {
    label: "Not applicable",
    icon: CircleMinus,
    badge: "bg-surface-muted text-text-secondary",
    wrap: "bg-surface-muted text-text-tertiary",
  },
};

/** Status of one check in words and an icon, never colour alone. The colours crossfade when a check finishes. */
export function CheckStatus({ status, className }: { status: Status; className?: string }) {
  const { label, icon: Icon, badge } = STATUS_LOOK[status];
  return (
    <span
      className={cn(
        "inline-flex w-fit shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1.5 text-[13px] leading-none font-medium whitespace-nowrap transition-colors duration-200",
        badge,
        className,
      )}
    >
      <Icon className="size-3.5" aria-hidden />
      {label}
    </span>
  );
}
