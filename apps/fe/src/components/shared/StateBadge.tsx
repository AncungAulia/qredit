import { Circle, CircleCheck, Hourglass, TrendingUp, Undo2, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export type VaultStateName = "Raising" | "Active" | "Trapped" | "Repaid" | "Refunded";
const NAMES: VaultStateName[] = ["Raising", "Active", "Trapped", "Repaid", "Refunded"];
export const vaultStateName = (n: number): VaultStateName => NAMES[n] ?? "Raising";

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
