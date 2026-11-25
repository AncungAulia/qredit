"use client";

import { useCallback, useEffect, useMemo } from "react";
import Link from "next/link";
import { Controller, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { CircleAlert } from "lucide-react";
import { toast } from "sonner";
import { ChainActionStatus, useChainAction } from "@/components/shared/ChainAction";
import { fieldErrorClass, fieldHelpClass } from "@/components/shared/formStyles";
import { NumberInput } from "@/components/shared/NumberInput";
import { Notice } from "@/components/shared/Notice";
import { TxLink } from "@/components/shared/TxLink";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Skeleton } from "@/components/ui/skeleton";
import { formatBps, formatDate, formatFusd, fusdToInput } from "@/lib/format";
import type { Business } from "@/lib/schemas";
import { RAISE_FULL_SENTENCE } from "@/modules/lend/api/lend.api";
import { useFusdBalanceQuery, useLendActions } from "@/modules/lend/api/useLend";
import { amountUnits, lendSchema, type LendValues } from "@/modules/lend/schemas/lend.schema";
import type { VaultSnapshot } from "@/modules/market";

type Props = {
  business: Business;
  vault: VaultSnapshot;
  evm: `0x${string}`;
  onClose: () => void;
  /** Reports whether a transaction is in flight, so the dialog cannot be closed meanwhile. */
  onBusyChange: (busy: boolean) => void;
};

const Line = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="flex items-center justify-between gap-4 py-1.5 text-sm">
    <span className="text-text-secondary">{label}</span>
    <span className="text-right font-medium text-text-primary tabular-nums">{children}</span>
  </div>
);

/** The amount field, the summary and the confirm button of the Lend dialog. This dialog is the confirmation before fUSD moves. */
export function LendForm({ business, vault, evm, onClose, onBusyChange }: Props) {
  const balanceQuery = useFusdBalanceQuery(evm);
  const actions = useLendActions();
  const balance = balanceQuery.data ?? null;
  const room = vault.target - vault.raised;
  const schema = useMemo(() => lendSchema({ balance, room }), [balance, room]);
  const {
    control,
    handleSubmit,
    setValue,
    formState: { errors },
  } = useForm<LendValues>({ resolver: zodResolver(schema), mode: "onTouched", defaultValues: { amount: "" } });

  const amount = useWatch({ control, name: "amount" });
  const units = amountUnits(amount);
  const valid = balance !== null && schema.safeParse({ amount }).success && units !== null;

  const run = useCallback(
    async (control: { sent(): void }) => {
      const result = await actions.lend(business.vault, units as bigint, control.sent);
      return result.depositTx;
    },
    [actions, business.vault, units],
  );
  const action = useChainAction(run);
  const busy = action.phase === "wallet" || action.phase === "chain";
  useEffect(() => onBusyChange(busy), [busy, onBusyChange]);
  // When the form goes away nothing of it is in flight any more, so the dialog may be closed again.
  useEffect(() => () => onBusyChange(false), [onBusyChange]);

  const submit = handleSubmit(async () => {
    const result = await action.start();
    if (!result) return;
    toast.success(`Lent ${formatFusd(units as bigint)} to ${business.name}`, {
      description: result.hash ? <TxLink hash={result.hash} /> : undefined,
    });
    onClose();
  });

  const full = action.phase === "refused" && action.reason === RAISE_FULL_SENTENCE;
  const repaid = units !== null && vault.target > 0n ? (units * vault.totalOwed) / vault.target : null;
  const max = balance === null ? null : balance < room ? balance : room;
  const error = errors.amount?.message;
  const label = units !== null ? `Lend ${formatFusd(units)}` : "Lend";

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-5">
      <Field data-invalid={error ? true : undefined} className={busy ? "opacity-50" : undefined}>
        <FieldLabel htmlFor="lend-amount">Amount</FieldLabel>
        <Controller
          control={control}
          name="amount"
          render={({ field }) => (
            <NumberInput
              id="lend-amount"
              name={field.name}
              ref={field.ref}
              decimals={6}
              suffix="fUSD"
              autoFocus
              disabled={busy}
              value={field.value}
              aria-invalid={error ? true : undefined}
              aria-describedby="lend-amount-note"
              onBlur={field.onBlur}
              onValueChange={(raw) => {
                if (action.phase === "refused") action.reset();
                field.onChange(raw);
              }}
            />
          )}
        />
        {error ? (
          <FieldError id="lend-amount-note" className={fieldErrorClass}>
            <CircleAlert className="mt-px size-3.5 shrink-0" aria-hidden />
            {error}
          </FieldError>
        ) : (
          <FieldDescription id="lend-amount-note" className={fieldHelpClass}>
            {`Up to ${formatFusd(room)} remaining to raise`}
          </FieldDescription>
        )}
      </Field>

      <div className="flex items-center justify-between gap-3 text-sm text-text-secondary">
        {balanceQuery.isError ? (
          <>
            <span>Your balance could not be read.</span>
            <Button type="button" variant="outline" size="sm" onClick={() => void balanceQuery.refetch()}>
              Try again
            </Button>
          </>
        ) : balance === null ? (
          <Skeleton className="h-5 w-40" />
        ) : (
          <>
            <span className="tabular-nums">{`Your balance ${formatFusd(balance)}`}</span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy || !max}
              onClick={() => max && setValue("amount", fusdToInput(max), { shouldTouch: true, shouldValidate: true })}
              className="rounded-full"
            >
              Use maximum
            </Button>
          </>
        )}
      </div>

      <div className="flex flex-col rounded-lg bg-surface-muted px-4 py-2.5">
        <Line label="You lend">{units !== null ? formatFusd(units) : "—"}</Line>
        <Line label="You will be repaid">{repaid !== null ? formatFusd(repaid) : "—"}</Line>
        <Line label="Repaid from">{`${formatBps(vault.lenderBps)} of every sale, before the owner`}</Line>
        <Line label="Deadline">{formatDate(vault.raiseDeadline)}</Line>
        <Line label="Network fee">Paid in QOR by your wallet</Line>
        <p className="py-1.5 text-sm text-text-secondary">Your wallet may ask you to confirm two or three steps.</p>
      </div>

      <p className="text-[13px] leading-normal text-text-secondary">
        {`Your fUSD is locked until the loan is repaid. If the raise does not reach ${formatFusd(vault.target)} by ${formatDate(vault.raiseDeadline)}, you can take a full refund.`}
      </p>

      {action.phase === "refused" &&
        (full ? (
          <Notice tone="danger" title="The raise is already full">
            {RAISE_FULL_SENTENCE}
          </Notice>
        ) : (
          <ChainActionStatus phase="refused" reason={action.reason} hash={action.hash} />
        ))}

      {busy ? (
        <ChainActionStatus phase={action.phase as "wallet" | "chain"} pendingLabel={`Lending ${units !== null ? formatFusd(units) : ""}`.trim()} slow={action.slow} asButton />
      ) : (
        <div className="flex flex-col gap-2.5">
          {full ? (
            <Button size="lg" className="h-11 w-full" render={<Link href="/" />} nativeButton={false} role="link">
              Back to the market
            </Button>
          ) : (
            <Button type="submit" size="lg" className="h-11 w-full" disabled={!valid}>
              {action.phase === "refused" ? "Try again" : label}
            </Button>
          )}
          <Button type="button" variant="ghost" size="lg" className="h-11 w-full" onClick={onClose}>
            Cancel
          </Button>
        </div>
      )}
    </form>
  );
}
