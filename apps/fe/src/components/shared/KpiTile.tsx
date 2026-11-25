import Image from "next/image";
import { cn } from "@/lib/utils";

type Props = {
  label: string;
  value: string;
  unit?: string;
  variant?: "default" | "feature" | "soft";
  className?: string;
};

// SoftArt in the design: blurred diagonal bands, themed through wash and wash-soft.
const WAVES = [
  { top: -20, height: 60, tone: "bg-wash-soft" },
  { top: 60, height: 70, tone: "bg-wash" },
  { top: 150, height: 56, tone: "bg-wash-soft" },
  { top: 220, height: 72, tone: "bg-wash" },
];

function SoftArt() {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute -top-[70px] -left-[60px] h-[260px] w-[460px] overflow-hidden opacity-55"
    >
      {WAVES.map((w, i) => (
        <span
          key={i}
          className={cn(
            "absolute -left-20 w-[600px] -rotate-[18deg] rounded-[40px] blur-[34px]",
            w.tone,
          )}
          style={{ top: w.top, height: w.height }}
        />
      ))}
    </div>
  );
}

// The tile background is dark in light mode and light in dark mode, so the artwork switches with it.
function FeatureArt() {
  return (
    <>
      <div
        aria-hidden
        className="pointer-events-none absolute -top-[30px] left-[150px] h-[190px] w-[250px] dark:hidden"
      >
        <Image
          src="/art/kpi-feature-on-dark.png"
          alt=""
          width={500}
          height={380}
          loading="eager"
          className="size-full object-cover"
        />
      </div>
      <div
        aria-hidden
        className="pointer-events-none absolute -top-[30px] left-[150px] hidden h-[190px] w-[250px] dark:block"
      >
        <Image
          src="/art/kpi-feature-on-light.png"
          alt=""
          width={500}
          height={380}
          loading="eager"
          className="size-full object-cover"
        />
      </div>
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-linear-to-r from-feature-bg from-55% to-transparent"
      />
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
        <span
          className={cn(
            "text-[32px] leading-none tracking-[-1px]",
            feature ? "text-feature-figure" : "text-text-primary",
          )}
        >
          {value}
        </span>
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
