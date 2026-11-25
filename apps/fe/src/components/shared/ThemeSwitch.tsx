"use client";

import { Monitor, Moon, Sun, type LucideIcon } from "lucide-react";
import { useTheme } from "next-themes";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { focusRing } from "@/lib/utils";
import { cn } from "@/lib/utils";

const OPTIONS: { value: "light" | "dark" | "system"; label: string; Icon: LucideIcon }[] = [
  { value: "light", label: "Light", Icon: Sun },
  { value: "dark", label: "Dark", Icon: Moon },
  { value: "system", label: "System", Icon: Monitor },
];

/**
 * Light, Dark or System (design ThemeSwitch) as a shadcn single-choice toggle group: Tab enters it, the arrow keys
 * move between the options and Space or Enter chooses. The chosen one sits on a raised surface.
 */
export function ThemeSwitch({ className }: { className?: string }) {
  const { theme = "system", setTheme } = useTheme();
  return (
    <ToggleGroup
      aria-label="Appearance"
      spacing={0.5}
      value={[theme]}
      onValueChange={(next) => {
        // A single choice stays chosen: pressing the chosen option again does nothing.
        const value = next[0];
        if (value) setTheme(value);
      }}
      className={cn("rounded-full bg-surface-muted p-[3px]", className)}
    >
      {OPTIONS.map(({ value, label, Icon }) => (
        <ToggleGroupItem
          key={value}
          value={value}
          aria-label={label}
          className={cn(
            "size-8 min-w-0 rounded-full p-0 text-text-tertiary hover:bg-transparent hover:text-text-primary aria-pressed:bg-surface aria-pressed:text-text-primary pointer-coarse:size-11",
            focusRing,
          )}
        >
          <Icon className="size-[15px]" aria-hidden />
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
