"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV, isActive } from "@/config/nav";
import { cn, focusRing } from "@/lib/utils";
import { Logo } from "./Logo";
import { ProgressiveBlur } from "./ProgressiveBlur";
import { ThemeButton } from "./ThemeButton";

/** Top bar on tablet and desktop: logo left, page pills centre, theme right. Sticky. */
export function TopBar({ className, pathname: given }: { className?: string; pathname?: string }) {
  const detected = usePathname();
  const pathname = given ?? detected;
  return (
    <header
      className={cn("sticky top-0 z-30 h-[76px] items-center justify-between px-8", className)}
    >
      <ProgressiveBlur />
      <div className="flex xl:w-[280px]">
        <Logo />
      </div>
      <nav
        aria-label="Main"
        className="flex gap-1 rounded-full border border-glass-edge bg-glass-strong p-1"
      >
        {NAV.map(({ href, label }) => {
          const active = isActive(href, pathname);
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "rounded-full px-[18px] py-2.5 text-sm font-medium transition-colors duration-150 pointer-coarse:py-3",
                focusRing,
                active
                  ? "bg-primary text-on-primary"
                  : "bg-surface text-text-secondary hover:bg-surface-hover",
              )}
            >
              {label}
            </Link>
          );
        })}
      </nav>
      <div className="flex justify-end xl:w-[280px]">
        <ThemeButton />
      </div>
    </header>
  );
}
