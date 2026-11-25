import type { Order } from "@/lib/schemas";
import { cn } from "@/lib/utils";

// Badge/Success (Delivered), Badge/Info (Pending), Badge/Danger (Declined) in the design.
const LOOK: Record<Order["status"], { label: string; className: string }> = {
  open: { label: "Pending", className: "bg-info-soft text-info" },
  claimed: { label: "In progress", className: "bg-info-soft text-info" },
  delivered: { label: "Delivered", className: "bg-success-soft text-success" },
  declined: { label: "Declined", className: "bg-danger-soft text-danger" },
  reclaimed: { label: "Reclaimed", className: "bg-warning-soft text-warning" },
};

export function OrderStatusBadge({ status }: { status: Order["status"] }) {
  const { label, className } = LOOK[status];
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-1.5 text-[13px] leading-none font-medium",
        className,
      )}
    >
      {label}
    </span>
  );
}
