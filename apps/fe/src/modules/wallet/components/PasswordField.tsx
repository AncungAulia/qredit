import type { ComponentProps } from "react";
import { FormField } from "@/components/shared/FormField";
import { Input } from "@/components/ui/input";

type Props = Omit<ComponentProps<typeof Input>, "id" | "type"> & {
  id: string;
  label: string;
  error?: string;
  help?: string;
  autoComplete: "new-password" | "current-password";
};

/** A password input with its label and the error under it. Pass the react-hook-form `register(...)` result as props. */
export function PasswordField({ id, label, error, help, autoComplete, ...input }: Props) {
  return (
    <FormField id={id} label={label} error={error} help={help}>
      <Input
        id={id}
        type="password"
        autoComplete={autoComplete}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : help ? `${id}-help` : undefined}
        {...input}
      />
    </FormField>
  );
}
