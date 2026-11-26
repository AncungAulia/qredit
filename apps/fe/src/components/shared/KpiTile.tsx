import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

type Props = {
  label: string;
  /** Undefined while the figure loads: a skeleton the size of the figure shows instead. */
  value: string | undefined;
  unit?: string;
  variant?: "default" | "feature" | "soft";
  className?: string;
};

// KpiTile/Feature in the design: one sky photo in both themes, cropped high so the text sits on the blue,
// with a soft navy shade at the bottom left. White text with a faint shadow keeps it readable on any crop.
const FEATURE =
  "bg-[linear-gradient(200deg,transparent_35%,rgba(11,42,90,0.44)),url('/kpi/feature-sky.webp')] bg-cover bg-[position:center,center_10%] [text-shadow:0_1px_6px_rgba(11,42,90,0.45)]";
// KpiTile/Soft: shapes on the right of the surface colour, one image per theme.
const SOFT =
  "bg-[url('/kpi/soft-light.webp')] dark:bg-[url('/kpi/soft-dark.webp')] bg-cover bg-right";

export function KpiTile({ label, value, unit, variant = "default", className }: Props) {
  const feature = variant === "feature";
  return (
    <div
      className={cn(
        "relative flex flex-col gap-2.5 overflow-hidden rounded-3xl p-5",
        feature ? FEATURE : "bg-surface",
        variant === "soft" && SOFT,
        variant !== "default" && "min-h-[118px] justify-between",
        className,
      )}
    >
      <span className={cn("relative text-sm", feature ? "text-white/90" : "text-text-secondary")}>
        {label}
      </span>
      <span className="relative flex items-end gap-1.5 tabular-nums">
        {value === undefined ? (
          <span role="status" aria-busy="true" className="flex h-8 items-center">
            <span className="sr-only">Loading</span>
            <Skeleton className="h-8 w-24 rounded-lg" />
          </span>
        ) : (
          <span
            className={cn(
              "text-[32px] leading-none tracking-[-1px]",
              feature ? "text-white" : "text-text-primary",
            )}
          >
            {value}
          </span>
        )}
        {unit && (
          <span
            className={cn(
              "text-sm leading-normal",
              feature ? "text-white/90" : "text-text-tertiary",
            )}
          >
            {unit}
          </span>
        )}
      </span>
    </div>
  );
}
