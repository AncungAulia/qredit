"use client";

import { useState, type ComponentProps } from "react";
import { CircleAlert, Eye, EyeOff } from "lucide-react";
import { controlClass, fieldErrorClass, fieldHelpClass } from "@/components/shared/formStyles";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { cn, focusRing } from "@/lib/utils";

type Props = Omit<ComponentProps<typeof Input>, "id" | "type"> & {
  id: string;
  label: string;
  error?: string;
  help?: string;
  autoComplete: "new-password" | "current-password";
};

/** A password input with its label and the error under it. Pass the react-hook-form `register(...)` result as props. */
export function PasswordField({ id, label, error, help, autoComplete, className, ...input }: Props) {
  // Local state: each field toggles on its own, and it is hidden again whenever the form unmounts.
  const [shown, setShown] = useState(false);
  return (
    <Field data-invalid={error ? true : undefined}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <div className="relative">
        <Input
          id={id}
          type={shown ? "text" : "password"}
          autoComplete={autoComplete}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : help ? `${id}-help` : undefined}
          className={cn(controlClass, "pr-12 pointer-coarse:pr-14", className)}
          {...input}
        />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={shown ? "Hide password" : "Show password"}
          aria-pressed={shown}
          // Keep the caret in the field when the button is pressed with a pointer.
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => setShown((v) => !v)}
          className={cn("absolute top-1/2 right-1.5 -translate-y-1/2 text-text-tertiary pointer-coarse:size-11", focusRing)}
        >
          {shown ? <EyeOff aria-hidden /> : <Eye aria-hidden />}
        </Button>
      </div>
      {error ? (
        <FieldError id={`${id}-error`} className={fieldErrorClass}>
          <CircleAlert className="mt-px size-3.5 shrink-0" aria-hidden />
          {error}
        </FieldError>
      ) : (
        help && (
          <FieldDescription id={`${id}-help`} className={fieldHelpClass}>
            {help}
          </FieldDescription>
        )
      )}
    </Field>
  );
}
