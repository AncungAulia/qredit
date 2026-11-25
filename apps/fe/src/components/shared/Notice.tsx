import type { ReactNode } from "react";
import { CircleCheck, Info, OctagonX, TriangleAlert, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

type Tone = "info" | "warning" | "danger" | "success";

// Notice/Info, Notice/Warning and Notice/Danger from the design; success reuses the same anatomy.
const TONES: Record<Tone, { box: string; icon: string; Icon: LucideIcon }> = {
  info: { box: "bg-info-soft", icon: "text-info", Icon: Info },
  warning: { box: "bg-warning-soft", icon: "text-warning", Icon: TriangleAlert },
  danger: { box: "bg-danger-soft", icon: "text-danger", Icon: OctagonX },
  success: { box: "bg-success-soft", icon: "text-success", Icon: CircleCheck },
};

/** A message block with an icon, a title and a short text. Danger notices are announced as alerts. */
export function Notice({
  tone = "info",
  title,
  children,
  className,
}: {
  tone?: Tone;
  title?: string;
  children?: ReactNode;
  className?: string;
}) {
  const { box, icon, Icon } = TONES[tone];
  return (
    <div
      role={tone === "danger" ? "alert" : "status"}
      className={cn("flex w-full gap-3 rounded-lg p-4", box, className)}
    >
      <Icon className={cn("mt-px size-[18px] shrink-0", icon)} aria-hidden />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        {title && <p className="text-[15px] font-medium text-text-primary">{title}</p>}
        {children && <div className="text-sm leading-normal text-text-secondary">{children}</div>}
      </div>
    </div>
  );
}
