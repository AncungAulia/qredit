import { formatFusd } from "@/lib/format";
import { cn } from "@/lib/utils";

type Size = "lg" | "md" | "sm";

// lg is the design size (56 / 28 / 16); md and sm are for denser places.
const SIZES: Record<Size, { whole: string; fraction: string; unit: string }> = {
  lg: {
    whole: "text-[56px] tracking-[-2px]",
    fraction: "text-[28px] tracking-[-1px]",
    unit: "text-base",
  },
  md: {
    whole: "text-[28px] tracking-[-1px]",
    fraction: "text-base tracking-[-0.5px]",
    unit: "text-sm",
  },
  sm: { whole: "text-xl tracking-[-0.5px]", fraction: "text-sm", unit: "text-[13px]" },
};

/** Big figure from the design: whole part large, cents smaller in tertiary, then the unit. */
export function Amount({
  units,
  unit = "fUSD",
  size = "lg",
  className,
}: {
  units: bigint | string;
  unit?: string;
  size?: Size;
  className?: string;
}) {
  const [whole, fraction] = formatFusd(units, { unit: false }).split(".");
  const s = SIZES[size];
  return (
    <span className={cn("inline-flex items-end gap-2 tabular-nums", className)}>
      <span className={cn("leading-none font-normal text-text-primary", s.whole)}>{whole}</span>
      {fraction !== undefined && (
        <span className={cn("leading-[1.3] text-text-tertiary", s.fraction)}>.{fraction}</span>
      )}
      {unit && <span className={cn("leading-loose text-text-secondary", s.unit)}>{unit}</span>}
    </span>
  );
}
