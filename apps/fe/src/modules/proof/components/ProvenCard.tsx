"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import type { Business } from "@/lib/schemas";
import { cn, focusRing } from "@/lib/utils";
import { useProofQuery } from "@/modules/proof/api/useProofQuery";
import { applicableCount, CHECK_IDS, CHECK_TITLES, provenCount, resultsOf } from "@/modules/proof/checks";
import { STATUS_LOOK } from "@/modules/proof/components/CheckStatus";

/** "N of 6 proven" with the six checks in short form, on the Business page. Every status comes from the chain, never from copy. */
export function ProvenCard({ business }: { business: Business }) {
  const results = resultsOf(useProofQuery(business));
  return (
    <div className="flex flex-col gap-4 rounded-3xl bg-surface p-6">
      {results ? (
        <div className="flex animate-in flex-col gap-4 duration-200 fade-in">
          <p className="text-[28px] leading-none font-medium tracking-[-0.8px] text-text-primary tabular-nums">
            {provenCount(results)} of {applicableCount(results)} proven
          </p>
          <ul className="flex flex-col gap-3">
            {results.map((r) => {
              const { label, icon: Icon, badge } = STATUS_LOOK[r.status];
              return (
                <li key={r.id} className="flex items-start gap-3">
                  <span
                    className={cn(
                      "mt-0.5 grid size-6 shrink-0 place-items-center rounded-full transition-colors duration-200",
                      badge,
                    )}
                  >
                    <Icon className="size-3.5" aria-hidden />
                  </span>
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="text-sm text-text-primary">{CHECK_TITLES[r.id]}</span>
                    <span className="text-[13px] text-text-secondary">{label}</span>
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      ) : (
        <div role="status" aria-busy="true" className="flex flex-col gap-3">
          <span className="sr-only">Loading</span>
          <Skeleton className="h-7 w-40 rounded-lg" />
          {CHECK_IDS.map((id) => (
            <Skeleton key={id} className="h-10 w-full rounded-xl" />
          ))}
        </div>
      )}
      <Link
        href="/proof"
        className={cn(
          "inline-flex w-fit items-center gap-1.5 rounded-md text-sm font-medium text-text-primary hover:underline pointer-coarse:min-h-11",
          focusRing,
        )}
      >
        See every check
        <ArrowRight className="size-4" aria-hidden />
      </Link>
    </div>
  );
}
