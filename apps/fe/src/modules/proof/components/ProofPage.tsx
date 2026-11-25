"use client";

import { useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn, focusRing } from "@/lib/utils";
import { AttackList } from "@/modules/proof/components/AttackList";
import { ClaimList } from "@/modules/proof/components/ClaimList";

export type ProofTab = "claims" | "attacks";

const TAB_CLASS = cn(
  "h-auto flex-none rounded-full border-0 px-4 py-2 text-sm font-medium text-text-secondary transition-colors duration-[120ms] ease-[var(--ease-out)] pointer-coarse:min-h-11 hover:bg-surface-hover hover:text-text-secondary",
  "data-active:bg-primary data-active:text-on-primary data-active:shadow-none dark:data-active:border-0 dark:data-active:bg-primary dark:data-active:text-on-primary",
  focusRing,
);

/** The Proof page: live claims per business and the attacks that were tried. The tab lives in the address (?tab=). */
export function ProofPage({ tab }: { tab: ProofTab }) {
  const router = useRouter();
  const pathname = usePathname();
  const [active, setActive] = useState<ProofTab>(tab);

  const change = (next: ProofTab) => {
    setActive(next);
    router.replace(next === "claims" ? pathname : `${pathname}?tab=${next}`, { scroll: false });
  };

  return (
    <Tabs
      value={active}
      onValueChange={(v) => change(v as ProofTab)}
      className="flex-1 gap-6 md:gap-8"
    >
      <div className="flex flex-col gap-3.5 md:flex-row md:items-end md:justify-between md:gap-8">
        <div className="flex flex-1 flex-col gap-1.5">
          <h1 className="text-[28px] font-medium tracking-[-0.8px] text-text-primary md:text-[30px] md:tracking-[-1px] xl:text-[32px]">
            Proof
          </h1>
          <p className="text-sm leading-normal text-text-secondary md:text-[15px]">
            Every claim Qredit makes, with the contract read or transaction that shows it. Nothing
            here asks you to trust us.
          </p>
        </div>
        <TabsList
          aria-label="Proof sections"
          className="h-auto w-fit gap-1 rounded-full bg-surface-muted p-1"
        >
          <TabsTrigger value="claims" className={TAB_CLASS}>
            Claims
          </TabsTrigger>
          <TabsTrigger value="attacks" className={TAB_CLASS}>
            Attacks
          </TabsTrigger>
        </TabsList>
      </div>
      <TabsContent value="claims" className="flex flex-col">
        <ClaimList />
      </TabsContent>
      <TabsContent value="attacks" className="flex flex-col">
        <AttackList />
      </TabsContent>
    </Tabs>
  );
}
