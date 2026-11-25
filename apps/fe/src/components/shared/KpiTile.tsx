import Image from "next/image";
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

// SoftArt in the design: blurred diagonal bands, themed through wash and wash-soft.
// The bands are wider than the tile and offset from its edges, so they cross the whole tile at any width.
const WAVES = [
  { top: -90, height: 60, tone: "bg-wash-soft" },
  { top: -10, height: 70, tone: "bg-wash" },
  { top: 80, height: 56, tone: "bg-wash-soft" },
  { top: 150, height: 72, tone: "bg-wash" },
];

function SoftArt() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden opacity-55">
      {WAVES.map((w, i) => (
        <span
          key={i}
          className={cn(
            "absolute -left-[30%] w-[160%] min-w-[600px] -rotate-[18deg] rounded-[40px] blur-[34px]",
            w.tone,
          )}
          style={{ top: w.top, height: w.height }}
        />
      ))}
    </div>
  );
}

// The artwork hangs from the right edge and is as wide as 60% of the tile (at most 250 px), so it never ends
// inside a wide tile; its own left side fades into the tile background, so no edge shows at any width.
const ART_BOX = "pointer-events-none absolute -top-[30px] -right-5 h-[190px] w-[min(250px,60%)]";
const ART_FADE = "absolute inset-0 bg-linear-to-r from-feature-bg from-0% to-transparent to-70%";

// The tile background is dark in light mode and light in dark mode, so the artwork switches with it.
function FeatureArt() {
  return (
    <>
      <div
        aria-hidden
        className={cn(ART_BOX, "dark:hidden")}
      >
        <Image
          src="/art/kpi-feature-on-dark.png"
          alt=""
          width={500}
          height={380}
          loading="eager"
          className="size-full object-cover object-left"
        />
        <div className={ART_FADE} />
      </div>
      <div aria-hidden className={cn(ART_BOX, "hidden dark:block")}>
        <Image
          src="/art/kpi-feature-on-light.png"
          alt=""
          width={500}
          height={380}
          loading="eager"
          className="size-full object-cover object-left"
        />
        <div className={ART_FADE} />
      </div>
    </>
  );
}

export function KpiTile({ label, value, unit, variant = "default", className }: Props) {
  const feature = variant === "feature";
  return (
    <div
      className={cn(
        "relative flex flex-col gap-2.5 overflow-hidden rounded-3xl p-5",
        feature ? "bg-feature-bg" : "bg-surface",
        variant !== "default" && "min-h-[118px] justify-between",
        className,
      )}
    >
      {feature && <FeatureArt />}
      {variant === "soft" && <SoftArt />}
      <span
        className={cn("relative text-sm", feature ? "text-feature-label" : "text-text-secondary")}
      >
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
              feature ? "text-feature-figure" : "text-text-primary",
            )}
          >
            {value}
          </span>
        )}
        {unit && (
          <span
            className={cn(
              "text-sm leading-normal",
              feature ? "text-feature-unit" : "text-text-tertiary",
            )}
          >
            {unit}
          </span>
        )}
      </span>
    </div>
  );
}
