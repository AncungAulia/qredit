"use client";

import { useEffect, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { CircleAlert, LoaderCircle } from "lucide-react";
import { fieldErrorClass } from "@/components/shared/formStyles";
import { Notice } from "@/components/shared/Notice";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { useWallet } from "@/modules/wallet/WalletProvider";
import { BackupPhrase } from "@/modules/wallet/components/BackupPhrase";
import { PasswordField } from "@/modules/wallet/components/PasswordField";
import { StorageUnavailable } from "@/modules/wallet/keystore";
import { Cancelled } from "@/modules/wallet/session";
import { createWalletSchema, type CreateWalletValues } from "@/modules/wallet/schemas/walletForms.schema";

const CREATE_FAILED = "The test wallet could not be created. Please try again.";

/** A new throwaway wallet: the phrase is shown once, then the password encrypts it in this browser. */
export function CreateWalletForm({ onCreated }: { onCreated: () => void }) {
  // Made in the browser once the key code has loaded; the dialog only mounts this form after a click.
  const [phrase, setPhrase] = useState<string | null>(null);
  useEffect(() => {
    let current = true;
    void import("@qorechain/sdk").then(({ generateMnemonic }) => {
      if (current) setPhrase(generateMnemonic(256));
    });
    return () => {
      current = false;
    };
  }, []);
  const create = useWallet((s) => s.create);
  const [failure, setFailure] = useState<string | null>(null);
  const {
    register,
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<CreateWalletValues>({
    resolver: zodResolver(createWalletSchema),
    mode: "onTouched",
    defaultValues: { saved: false, password: "", confirm: "" },
  });

  const submit = handleSubmit(async ({ password }) => {
    if (!phrase) return;
    setFailure(null);
    try {
      await create(phrase, password);
      onCreated();
    } catch (e) {
      if (e instanceof Cancelled) return;
      setFailure(e instanceof StorageUnavailable ? e.message : CREATE_FAILED);
    }
  });

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-5">
      <Notice tone="warning" title="Write down your recovery phrase">
        It is shown only once. Anyone who has it can use this test wallet. It is a throwaway testnet wallet, so never
        keep real funds in it.
      </Notice>
      {phrase ? <BackupPhrase phrase={phrase} /> : <Skeleton className="h-[132px] w-full" aria-busy="true" />}
      <Field data-invalid={errors.saved ? true : undefined}>
        <div className="flex items-center gap-3">
          <Controller
            control={control}
            name="saved"
            render={({ field }) => (
              <Checkbox
                id="saved"
                checked={field.value}
                onCheckedChange={(checked) => field.onChange(checked)}
                onBlur={field.onBlur}
                name={field.name}
                aria-invalid={errors.saved ? true : undefined}
                aria-describedby={errors.saved ? "saved-error" : undefined}
                className="size-5 rounded-[6px] border-border-strong bg-surface dark:bg-surface pointer-coarse:size-6"
              />
            )}
          />
          <FieldLabel htmlFor="saved" className="text-sm font-normal text-text-primary">
            I saved the recovery phrase
          </FieldLabel>
        </div>
        {errors.saved && (
          <FieldError id="saved-error" className={fieldErrorClass}>
            <CircleAlert className="mt-px size-3.5 shrink-0" aria-hidden />
            {errors.saved.message}
          </FieldError>
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
      <PasswordField
        id="confirm"
        label="Repeat the password"
        autoComplete="new-password"
        error={errors.confirm?.message}
        {...register("confirm")}
      />
      {failure && <Notice tone="danger">{failure}</Notice>}
      <Button type="submit" size="lg" className="h-11" disabled={isSubmitting || !phrase}>
        {isSubmitting ? (
          <>
            <LoaderCircle className="animate-spin motion-reduce:animate-none" aria-hidden />
            Encrypting
          </>
        ) : (
          "Create test wallet"
        )}
      </Button>
    </form>
  );
}
