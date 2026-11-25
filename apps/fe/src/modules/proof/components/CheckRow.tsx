import { ShieldCheck, ShieldQuestion, ShieldX, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { CHECK_TITLES, type CheckResult } from "@/modules/proof/checks";
import { CheckStatus, STATUS_LOOK } from "@/modules/proof/components/CheckStatus";

const ICON: Record<CheckResult["status"], LucideIcon> = {
  proven: ShieldCheck,
  failed: ShieldX,
  unknown: ShieldQuestion,
  na: ShieldQuestion,
};

/** Row/Proof in the design: one claim, what the chain showed, and its status. */
export function CheckRow({ result }: { result: CheckResult }) {
  const Icon = ICON[result.status];
  return (
    <li className="flex flex-col gap-2.5 py-3.5 md:flex-row md:items-center md:gap-4">
      <div className="flex min-w-0 flex-1 items-start gap-4">
        <span
          className={cn(
            "grid size-8 shrink-0 place-items-center rounded-full transition-colors duration-200",
            STATUS_LOOK[result.status].wrap,
          )}
        >
          <Icon className="size-4" aria-hidden />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-[15px] leading-snug font-medium text-text-primary">
            {CHECK_TITLES[result.id]}
          </span>
          <span className="text-[13px] text-text-secondary">{result.detail}</span>
        </div>
      </div>
      <CheckStatus status={result.status} className="ml-12 md:ml-0" />
    </li>
  );
}
