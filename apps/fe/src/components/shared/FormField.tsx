import type { ReactNode } from "react";
import { CircleAlert } from "lucide-react";
import { Label } from "@/components/ui/label";

/** Label, control, then the error (icon and text, never colour alone) or the help text under the field. */
export function FormField({
  id,
  label,
  help,
  error,
  children,
}: {
  id: string;
  label: string;
  help?: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div data-field={id} className="flex flex-col gap-2">
      {label && <Label htmlFor={id}>{label}</Label>}
      {children}
      {error ? (
        <p id={`${id}-error`} className="flex items-start gap-1.5 text-[13px] text-danger">
          <CircleAlert className="mt-px size-3.5 shrink-0" aria-hidden />
          {error}
        </p>
      ) : (
        help && (
          <p id={`${id}-help`} className="text-[13px] text-text-tertiary">
            {help}
          </p>
        )
      )}
    </div>
  );
}
