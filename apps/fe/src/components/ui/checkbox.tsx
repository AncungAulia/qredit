"use client";

import { Checkbox as CheckboxPrimitive } from "@base-ui/react/checkbox";
import { CheckIcon } from "lucide-react";
import { cn, focusRing } from "@/lib/utils";

function Checkbox({ className, ...props }: CheckboxPrimitive.Root.Props) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        "grid size-5 shrink-0 place-items-center rounded-[6px] border border-border-strong bg-surface transition-colors duration-150 outline-none data-checked:border-primary data-checked:bg-primary data-checked:text-on-primary aria-invalid:border-danger pointer-coarse:size-6",
        focusRing,
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator className="grid place-items-center">
        <CheckIcon className="size-3.5" aria-hidden />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}

export { Checkbox };
