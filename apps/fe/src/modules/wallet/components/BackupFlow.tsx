"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { LoaderCircle } from "lucide-react";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { Notice } from "@/components/shared/Notice";
import { ResponsiveDialog } from "@/components/shared/ResponsiveDialog";
import { Button } from "@/components/ui/button";
import { useWallet } from "@/modules/wallet/WalletProvider";
import { BackupPhrase } from "@/modules/wallet/components/BackupPhrase";
import { PasswordField } from "@/modules/wallet/components/PasswordField";
import { WrongPassword } from "@/modules/wallet/keystore";
import { revealSchema, type UnlockValues } from "@/modules/wallet/schemas/walletForms.schema";

function PasswordStep({ onRevealed }: { onRevealed: (phrase: string) => void }) {
  const reveal = useWallet((s) => s.reveal);
  const [failure, setFailure] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<UnlockValues>({ resolver: zodResolver(revealSchema), mode: "onTouched", defaultValues: { password: "" } });

  const submit = handleSubmit(async ({ password }) => {
    setFailure(null);
    try {
      onRevealed(await reveal(password));
    } catch (e) {
      if (e instanceof WrongPassword) setError("password", { type: "server", message: e.message });
      else setFailure("The recovery phrase could not be shown. Please try again.");
    }
  });

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-5">
      <PasswordField
        id="password"
        label="Password"
        autoComplete="current-password"
        error={errors.password?.message}
        {...register("password")}
      />
      {failure && <Notice tone="danger">{failure}</Notice>}
      <Button type="submit" size="lg" className="h-11" disabled={isSubmitting}>
        {isSubmitting ? (
          <>
            <LoaderCircle className="animate-spin motion-reduce:animate-none" aria-hidden />
            Decrypting
          </>
        ) : (
          "Show recovery phrase"
        )}
      </Button>
    </form>
  );
}

type Stage = "confirm" | "password" | "phrase";

/** Back up the phrase of the test wallet: a confirmation, the password again, then the phrase itself. */
export function BackupFlow({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [stage, setStage] = useState<Stage>("confirm");
  const [phrase, setPhrase] = useState<string | null>(null);
  const [wasOpen, setWasOpen] = useState(open);

  // Each opening starts at the confirmation, and the phrase never outlives the dialog.
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setStage("confirm");
      setPhrase(null);
    }
  }
  const close = () => {
    setPhrase(null);
    onClose();
  };

  return (
    <>
      <ConfirmDialog
        open={open && stage === "confirm"}
        onOpenChange={(next) => !next && close()}
        title="Show your recovery phrase?"
        body="Anyone who sees it can use this test wallet. Make sure nobody is looking at your screen."
        confirmLabel="Continue"
        onConfirm={() => setStage("password")}
      />
      <ResponsiveDialog
        open={open && stage !== "confirm"}
        onOpenChange={(next) => !next && close()}
        title={stage === "phrase" ? "Your recovery phrase" : "Enter your password"}
        description={
          stage === "phrase"
            ? "A throwaway testnet wallet. Write the phrase down and keep it private."
            : "Your password is needed to decrypt the phrase."
        }
      >
        {stage === "password" && (
          <PasswordStep
            onRevealed={(value) => {
              setPhrase(value);
              setStage("phrase");
            }}
          />
        )}
        {stage === "phrase" && phrase && (
          <>
            <BackupPhrase phrase={phrase} />
            <Button size="lg" className="h-11" onClick={close}>
              Done
            </Button>
          </>
        )}
      </ResponsiveDialog>
    </>
  );
}
