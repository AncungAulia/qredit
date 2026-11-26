import { Archive, Circle, CircleCheck, Hourglass, OctagonX, TrendingUp, Undo2, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { VaultStateName } from "@/lib/vaultState";

// Badge/Neutral (Raising, Repaying), Badge/Warning (Trapped), Badge/Success (Repaid) in the design.
const LOOK: Record<VaultStateName, { label: string; icon: LucideIcon; className: string }> = {
  Raising: { label: "Raising", icon: Circle, className: "bg-surface-muted text-text-secondary" },
  Active: {
    label: "Repaying",
    icon: TrendingUp,
    className: "bg-surface-muted text-text-secondary",
  },
  Trapped: { label: "Trapped", icon: Hourglass, className: "bg-warning-soft text-warning" },
  Repaid: { label: "Repaid", icon: CircleCheck, className: "bg-success-soft text-success" },
  Refunded: { label: "Refunded", icon: Undo2, className: "bg-surface-muted text-text-secondary" },
  Defaulted: { label: "Defaulted", icon: OctagonX, className: "bg-danger-soft text-danger" },
  Closed: { label: "Closed", icon: Archive, className: "bg-surface-muted text-text-secondary" },
};

export function StateBadge({ state, className }: { state: VaultStateName; className?: string }) {
  const { label, icon: Icon, className: look } = LOOK[state];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-[13px] leading-none font-medium transition-colors duration-200",
        look,
        className,
      )}
    >
      <Icon className="size-3.5" aria-hidden />
      {label}
    </span>
  );
}
