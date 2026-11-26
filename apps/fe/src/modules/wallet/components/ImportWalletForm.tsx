"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { CircleAlert, LoaderCircle } from "lucide-react";
import { controlClass, fieldErrorClass, fieldHelpClass } from "@/components/shared/formStyles";
import { Notice } from "@/components/shared/Notice";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { useWallet } from "@/modules/wallet/WalletProvider";
import { PasswordField } from "@/modules/wallet/components/PasswordField";
import { StorageUnavailable } from "@/modules/wallet/keystore";
import { Cancelled } from "@/modules/wallet/session";
import {
  importWalletSchema,
  normalizePhrase,
  type ImportWalletValues,
} from "@/modules/wallet/schemas/walletForms.schema";

const IMPORT_FAILED = "The test wallet could not be imported. Please try again.";

/** Brings back a throwaway wallet from its recovery phrase and encrypts it in this browser. */
export function ImportWalletForm({ onImported }: { onImported: () => void }) {
  const create = useWallet((s) => s.create);
  const [failure, setFailure] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ImportWalletValues>({
    resolver: zodResolver(importWalletSchema),
    mode: "onTouched",
    defaultValues: { phrase: "", password: "" },
  });

  const submit = handleSubmit(async ({ phrase, password }) => {
    setFailure(null);
    try {
      await create(normalizePhrase(phrase), password);
      onImported();
    } catch (e) {
      if (e instanceof Cancelled) return;
      setFailure(e instanceof StorageUnavailable ? e.message : IMPORT_FAILED);
    }
  });

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-5">
      <Notice tone="info">Use a throwaway testnet phrase only. Never enter the phrase of a wallet that holds real funds.</Notice>
      <Field data-invalid={errors.phrase ? true : undefined}>
        <FieldLabel htmlFor="phrase">Recovery phrase</FieldLabel>
        <Textarea
          id="phrase"
          rows={3}
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          aria-invalid={errors.phrase ? true : undefined}
          aria-describedby={errors.phrase ? "phrase-error" : "phrase-help"}
          className={cn(controlClass, "h-auto min-h-24 resize-none py-3")}
          {...register("phrase")}
        />
        {errors.phrase ? (
          <FieldError id="phrase-error" className={fieldErrorClass}>
            <CircleAlert className="mt-px size-3.5 shrink-0" aria-hidden />
            {errors.phrase.message}
          </FieldError>
        ) : (
          <FieldDescription id="phrase-help" className={fieldHelpClass}>
            The 12 or 24 words, separated by spaces.
          </FieldDescription>
        )}
      </Field>
      <PasswordField
        id="password"
        label="Password"
        autoComplete="new-password"
        help="At least 8 characters. It protects the wallet in this browser and cannot be reset."
        error={errors.password?.message}
        {...register("password")}
      />
      {failure && <Notice tone="danger">{failure}</Notice>}
      <Button type="submit" size="lg" className="h-11" disabled={isSubmitting}>
        {isSubmitting ? (
          <>
            <LoaderCircle className="animate-spin motion-reduce:animate-none" aria-hidden />
            Encrypting
          </>
        ) : (
          "Import test wallet"
        )}
      </Button>
    </form>
  );
}
