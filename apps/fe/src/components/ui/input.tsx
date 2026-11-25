import * as React from "react";
import { Input as InputPrimitive } from "@base-ui/react/input";
import { cn } from "@/lib/utils";

/** Text field from the design (Input/*): 48 px, strong border, accent focus border, danger border when invalid. */
function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      className={cn(
        "h-12 w-full min-w-0 rounded-md border border-border-strong bg-surface px-3.5 text-base text-text-primary transition-colors duration-150 outline-none placeholder:text-text-tertiary focus-visible:border-focus focus-visible:ring-1 focus-visible:ring-focus disabled:opacity-50 aria-invalid:border-danger aria-invalid:ring-danger md:text-base",
        className,
      )}
      {...props}
    />
  );
}

export { Input };
