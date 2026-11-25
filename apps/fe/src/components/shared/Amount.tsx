import { formatFusd } from "@/lib/format";
import { cn } from "@/lib/utils";

/** Big figure from the design: whole part large, cents smaller in tertiary, then the unit. */
export function Amount({
  units,
  unit = "fUSD",
  className,
}: {
  units: bigint | string;
  unit?: string;
  className?: string;
}) {
  const [whole, fraction] = formatFusd(units, { unit: false }).split(".");
  return (
    <span className={cn("inline-flex items-end gap-2 tabular-nums", className)}>
      <span className="text-[56px] leading-none font-normal tracking-[-2px] text-text-primary">
        {whole}
      </span>
      {fraction !== undefined && (
        <span className="text-[28px] leading-[1.3] tracking-[-1px] text-text-tertiary">
          .{fraction}
        </span>
      )}
      {unit && <span className="text-base leading-loose text-text-secondary">{unit}</span>}
    </span>
  );
}
