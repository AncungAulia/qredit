import * as React from "react";
import { cn } from "@/lib/utils";

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "min-h-24 w-full resize-none rounded-md border border-border-strong bg-surface px-3.5 py-3 text-base text-text-primary transition-colors duration-150 outline-none placeholder:text-text-tertiary focus-visible:border-focus focus-visible:ring-1 focus-visible:ring-focus disabled:opacity-50 aria-invalid:border-danger aria-invalid:ring-danger",
        className,
      )}
      {...props}
    />
  );
}

export { Textarea };
