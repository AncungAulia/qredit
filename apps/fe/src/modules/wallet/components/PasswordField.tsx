import type { ComponentProps } from "react";
import { CircleAlert } from "lucide-react";
import { controlClass, fieldErrorClass, fieldHelpClass } from "@/components/shared/formStyles";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type Props = Omit<ComponentProps<typeof Input>, "id" | "type"> & {
  id: string;
  label: string;
  error?: string;
  help?: string;
  autoComplete: "new-password" | "current-password";
};

/** A password input with its label and the error under it. Pass the react-hook-form `register(...)` result as props. */
export function PasswordField({ id, label, error, help, autoComplete, className, ...input }: Props) {
  return (
    <Field data-invalid={error ? true : undefined}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input
        id={id}
        type="password"
        autoComplete={autoComplete}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : help ? `${id}-help` : undefined}
        className={cn(controlClass, className)}
        {...input}
      />
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
