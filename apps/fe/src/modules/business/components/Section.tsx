import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** A titled block of the page: title and one sentence above its content (SectionHead in the design). */
export function Section({
  id,
  title,
  description,
  className,
  children,
}: {
  id: string;
  title: string;
  description: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={id} className={cn("flex flex-col gap-3.5", className)}>
      <div className="flex flex-col gap-1">
        <h2 id={id} className="text-xl font-medium text-text-primary">
          {title}
        </h2>
        <p className="text-sm text-text-secondary">{description}</p>
      </div>
      {children}
    </section>
  );
}
