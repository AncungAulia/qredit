"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { LoaderCircle } from "lucide-react";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { Notice } from "@/components/shared/Notice";
import { Button } from "@/components/ui/button";
import { useWallet } from "@/modules/wallet/WalletProvider";
import { PasswordField } from "@/modules/wallet/components/PasswordField";
import { WrongPassword } from "@/modules/wallet/keystore";
import { unlockSchema, type UnlockValues } from "@/modules/wallet/schemas/walletForms.schema";

const UNLOCK_FAILED = "The test wallet could not be unlocked. Please try again.";

/** Unlocks the saved throwaway wallet with its password. Forgetting it is confirmed first. */
export function UnlockForm({ onUnlocked, onForgotten }: { onUnlocked: () => void; onForgotten: () => void }) {
  const unlock = useWallet((s) => s.unlock);
  const forget = useWallet((s) => s.forget);
  const [failure, setFailure] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<UnlockValues>({
    resolver: zodResolver(unlockSchema),
    mode: "onTouched",
    defaultValues: { password: "" },
  });

  const submit = handleSubmit(async ({ password }) => {
    setFailure(null);
    try {
      await unlock(password);
      onUnlocked();
    } catch (e) {
      if (e instanceof WrongPassword) setError("password", { type: "server", message: e.message });
      else setFailure(UNLOCK_FAILED);
    }
  });

  return (
    <>
      <form onSubmit={submit} noValidate className="flex flex-col gap-5">
        <p className="text-sm text-text-secondary">
          This is your throwaway testnet wallet, saved in this browser. Enter its password to use it.
        </p>
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
              Unlocking
            </>
          ) : (
            "Unlock"
          )}
        </Button>
        <Button type="button" variant="ghost" size="lg" className="h-11 text-danger" onClick={() => setConfirming(true)}>
          Forget this wallet
        </Button>
      </form>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title="Forget this wallet?"
        body="The encrypted wallet is removed from this browser. Without its recovery phrase it cannot be restored, and any test funds in it are lost."
        confirmLabel="Forget wallet"
        destructive
        onConfirm={() => {
          forget();
          setConfirming(false);
          onForgotten();
        }}
      />
    </>
  );
}
