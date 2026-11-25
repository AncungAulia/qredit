"use client";

import { useSyncExternalStore } from "react";
import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { cn, focusRing } from "@/lib/utils";

const noopSubscribe = () => () => undefined;
const useMounted = () =>
  useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );

const size = "size-10 pointer-coarse:size-11";

/** Light shows a moon (switch to dark), dark shows a sun (switch to light). */
export function ThemeButton({ className }: { className?: string }) {
  const { resolvedTheme, setTheme } = useTheme();
  const mounted = useMounted();

  // The theme is unknown on the server; keep the space so nothing jumps.
  if (!mounted) return <span aria-hidden className={cn(size, className)} />;

  const dark = resolvedTheme === "dark";
  const Icon = dark ? Sun : Moon;
  return (
    <button
      type="button"
      onClick={() => setTheme(dark ? "light" : "dark")}
      aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
      className={cn(
        "grid shrink-0 place-items-center rounded-full border border-border bg-surface text-text-secondary transition-[transform,background-color] duration-[120ms] ease-[var(--ease-out)] hover:bg-surface-hover active:scale-[0.97]",
        focusRing,
        size,
        className,
      )}
    >
      <Icon className="size-[18px]" aria-hidden />
    </button>
  );
}
