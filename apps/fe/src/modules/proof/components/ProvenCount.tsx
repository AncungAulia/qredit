import { ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { applicableCount, provenCount, type CheckResult } from "@/modules/proof/checks";

/** "N of M proven" (Badge/Proven in the design). The count is read from the results, never fixed in copy. */
export function ProvenCount({
  results,
  className,
}: {
  results: CheckResult[];
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full bg-accent-soft px-2.5 py-1.5 text-[13px] leading-none font-medium text-text-primary tabular-nums",
        className,
      )}
    >
      <ShieldCheck className="size-3.5 text-accent-strong" aria-hidden />
      {provenCount(results)} of {applicableCount(results)} proven
    </span>
  );
}
