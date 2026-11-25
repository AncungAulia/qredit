"use client";

import { Monitor, Moon, Sun, type LucideIcon } from "lucide-react";
import { useTheme } from "next-themes";
import { cn, focusRing } from "@/lib/utils";

const OPTIONS: { value: "light" | "dark" | "system"; label: string; Icon: LucideIcon }[] = [
  { value: "light", label: "Light", Icon: Sun },
  { value: "dark", label: "Dark", Icon: Moon },
  { value: "system", label: "System", Icon: Monitor },
];

/** Light, Dark or System (design ThemeSwitch). The chosen one sits on a raised surface. */
export function ThemeSwitch({ className }: { className?: string }) {
  const { theme = "system", setTheme } = useTheme();
  return (
    <div
      role="radiogroup"
      aria-label="Appearance"
      className={cn("inline-flex gap-0.5 rounded-full bg-surface-muted p-[3px]", className)}
    >
      {OPTIONS.map(({ value, label, Icon }) => {
        const selected = theme === value;
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={label}
            onClick={() => setTheme(value)}
            className={cn(
              "grid size-8 place-items-center rounded-full transition-colors duration-150 pointer-coarse:size-11",
              focusRing,
              selected ? "bg-surface text-text-primary" : "text-text-tertiary hover:text-text-primary",
            )}
          >
            <Icon className="size-[15px]" aria-hidden />
          </button>
        );
      })}
    </div>
  );
}
