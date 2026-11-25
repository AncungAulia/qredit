"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV, isActive, isTopLevel } from "@/config/nav";
import { cn, focusRing } from "@/lib/utils";

/** Phone navigation: a floating glass pill above the home indicator, on top-level pages only. */
export function TabBar({ className, pathname: given }: { className?: string; pathname?: string }) {
  const detected = usePathname();
  const pathname = given ?? detected;
  if (!isTopLevel(pathname)) return null;
  return (
    <nav
      aria-label="Main"
      className={cn(
        "fixed inset-x-4 bottom-[max(1rem,env(safe-area-inset-bottom))] z-30 flex justify-between rounded-full border border-glass-edge bg-glass-strong p-1.5 shadow-[0_8px_24px_var(--shadow)] backdrop-blur-2xl",
        className,
      )}
    >
      {NAV.map(({ href, label, icon: Icon }) => {
        const active = isActive(href, pathname);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex min-h-11 flex-1 flex-col items-center gap-0.5 rounded-full py-1.5 text-xs font-medium transition-colors duration-150",
              focusRing,
              active ? "bg-primary text-on-primary" : "text-text-secondary",
            )}
          >
            <Icon className="h-6 w-7 px-1" aria-hidden />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
