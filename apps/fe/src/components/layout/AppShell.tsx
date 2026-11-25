"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { isTopLevel } from "@/config/nav";
import { cn } from "@/lib/utils";
import { MobileHeader } from "./MobileHeader";
import { TabBar } from "./TabBar";
import { TopBar } from "./TopBar";

/** Header, page area and tab bar. The page area is a flex column so page states can fill it. */
export function AppShell({ children }: { children: ReactNode }) {
  const tabBar = isTopLevel(usePathname());
  return (
    <div className="flex min-h-dvh flex-col">
      <TopBar className="hidden md:flex" />
      <MobileHeader className="flex md:hidden" />
      <main
        className={cn(
          "mx-auto flex w-full max-w-[1200px] flex-1 flex-col px-4 pt-4 md:px-8 md:pt-8 md:pb-20 xl:px-0 xl:pb-24",
          // Room for the floating tab bar, which shows on top-level pages only.
          tabBar ? "pb-[120px]" : "pb-8",
        )}
      >
        {children}
      </main>
      <TabBar className="md:hidden" />
    </div>
  );
}
