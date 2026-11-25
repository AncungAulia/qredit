import { cn } from "@/lib/utils";

/** Loading placeholder: a soft band sweeps across it (shimmer), never a pulse. Reduced motion leaves it static. */
function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn(
        "animate-shimmer rounded-md bg-surface-muted bg-[linear-gradient(90deg,transparent,var(--surface-hover),transparent)] bg-[length:200%_100%]",
        className,
      )}
      {...props}
    />
  );
}

export { Skeleton };
