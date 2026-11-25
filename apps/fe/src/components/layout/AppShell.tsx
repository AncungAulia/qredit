import type { ReactNode } from "react";
import { MobileHeader } from "./MobileHeader";
import { TabBar } from "./TabBar";
import { TopBar } from "./TopBar";

/** Header, page area and tab bar. The page area is a flex column so page states can fill it. */
export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <TopBar className="hidden md:flex" />
      <MobileHeader className="flex md:hidden" />
      <main className="mx-auto flex w-full max-w-[1200px] flex-1 flex-col px-4 pt-4 pb-[120px] md:px-8 md:pt-8 md:pb-20 xl:px-0 xl:pb-24">
        {children}
      </main>
      <TabBar className="md:hidden" />
    </div>
  );
}
