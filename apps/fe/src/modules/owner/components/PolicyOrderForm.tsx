"use client";

import type { ReactNode } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  CircleAlert,
  KeyRound,
  Pause,
  Power,
  Play,
  TrendingDown,
  TrendingUp,
  UserMinus,
  UserPlus,
  type LucideIcon,
} from "lucide-react";
import { fieldErrorClass, fieldHelpClass, controlClass } from "@/components/shared/formStyles";
import { NumberInput } from "@/components/shared/NumberInput";
import { Notice } from "@/components/shared/Notice";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { formatFusd, parseFusd } from "@/lib/format";
import { cn, focusRing } from "@/lib/utils";
import type { Rules } from "@/modules/owner/api/owner.api";
import { LOCKED_SENTENCE, precheck } from "@/modules/owner/lib/precheck";
import {
  EXPIRY_MAX,
  EXPIRY_MIN,
  KIND_INFO,
  KIND_LIST,
  policyOrderSchema,
  supplierAddress,
  type PolicyKind,
  type PolicyOrderValues,
} from "@/modules/owner/schemas/policyOrder.schema";

export type SignVia = "qorex" | "paste";

const ICONS: Record<PolicyKind, LucideIcon> = {
  Pause,
  Unpause: Play,
  LowerDailyCap: TrendingDown,
  LowerSupplierCap: TrendingDown,
  RemoveSupplier: UserMinus,
  RaiseDailyCap: TrendingUp,
  RaiseSupplierCap: TrendingUp,
  AddSupplier: UserPlus,
  Close: Power,
  RotateAgent: KeyRound,
};

type Props = {
  rules: Rules | undefined;
  /** True while an order is being signed or applied: the choice cannot change meanwhile. */
  locked: boolean;
  onSubmit: (values: PolicyOrderValues, via: SignVia) => void;
  /** Replaces the signing buttons while an order is in flight. */
  flow?: ReactNode;
};

const DEFAULTS = { target: "", value: "", operator: "", expiryMinutes: "30" };

/** The Owner form of the design: pick a change, fill the field it needs, then sign it with QoreX or paste a CLI signature. */
export function PolicyOrderForm({ rules, locked, onSubmit, flow }: Props) {
  const {
    control,
    handleSubmit,
    setValue,
    formState: { errors },
  } = useForm<PolicyOrderValues>({
    resolver: zodResolver(policyOrderSchema),
    mode: "onTouched",
    defaultValues: DEFAULTS,
  });
  const values = useWatch({ control });
  const kind = values.kind;
  const info = kind ? KIND_INFO[kind] : null;
  const units = parseFusd((values.value ?? "").replace(/\.$/, ""));
  const blocked = kind && rules ? precheck(kind, units, rules, { spender: supplierAddress(values.target ?? ""), operator: supplierAddress(values.operator ?? "") }) : null;
  const valid = policyOrderSchema.safeParse(values).success && blocked === null;
  const submit = (via: SignVia) => handleSubmit((v) => onSubmit(v, via))();

  const valueHelp =
    kind === "LowerDailyCap" && rules
      ? `Lower than the current ${formatFusd(rules.dailyCap)}. The vault refuses any other amount.`
      : kind === "RaiseDailyCap" && rules
        ? `Higher than the current ${formatFusd(rules.dailyCap)}.`
        : "Amounts are in fUSD.";

  return (
    <form noValidate onSubmit={(e) => e.preventDefault()} className="flex flex-col gap-6">
      <div role="radiogroup" aria-label="What to change" className="flex flex-col gap-2.5">
        {KIND_LIST.map((k) => {
          const Icon = ICONS[k];
          const selected = kind === k;
          return (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={locked}
              onClick={() => setValue("kind", k, { shouldValidate: true })}
              className={cn(
                "flex items-center gap-3.5 rounded-2xl bg-surface-muted p-3.5 text-left transition-colors duration-150 pointer-coarse:min-h-11",
                "disabled:opacity-60",
                selected && "ring-1 ring-focus",
                focusRing,
              )}
            >
              <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-surface">
                <Icon className={cn("size-[18px]", KIND_INFO[k].irreversible ? "text-danger" : "text-text-secondary")} aria-hidden />
              </span>
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className={cn("text-[15px] font-medium", KIND_INFO[k].irreversible ? "text-danger" : "text-text-primary")}>
                  {KIND_INFO[k].label}
                </span>
                <span className="text-[13px] leading-normal text-text-secondary">{KIND_INFO[k].description}</span>
              </span>
              <span
                aria-hidden
                className={cn(
                  "flex size-5 shrink-0 items-center justify-center rounded-full border",
                  selected ? "border-primary" : "border-border-strong",
                )}
              >
                {selected && <span className="size-2.5 rounded-full bg-primary" />}
              </span>
            </button>
          );
        })}
      </div>

      {blocked && (
        <Notice tone="warning" title={blocked === LOCKED_SENTENCE ? "Locked until the loan is repaid" : "This change would be refused"}>
          {blocked === LOCKED_SENTENCE ? "The vault refuses this change until then." : blocked}
        </Notice>
      )}

      {info?.irreversible && !blocked && (
        <Notice tone="danger" title="This cannot be undone">
          Closing ends the loan for good. The business stops selling, and the vault&apos;s cash, your unclaimed share and your bond go to lenders.
        </Notice>
      )}

      {info && (
        <div className="flex flex-col gap-5">
          {info.target && (
            <Field data-invalid={errors.target ? true : undefined}>
              <FieldLabel htmlFor="owner-target">{info.targetLabel ?? "Supplier address"}</FieldLabel>
              <Controller
                control={control}
                name="target"
                render={({ field }) => (
                  <Input
                    id="owner-target"
                    {...field}
                    disabled={locked}
                    placeholder="qor1… or 0x…"
                    autoComplete="off"
                    spellCheck={false}
                    aria-invalid={errors.target ? true : undefined}
                    className={cn(controlClass, "font-mono text-[15px]")}
                  />
                )}
              />
              {errors.target ? (
                <FieldError className={fieldErrorClass}>
                  <CircleAlert className="mt-px size-3.5 shrink-0" aria-hidden />
                  {errors.target.message}
                </FieldError>
              ) : (
                <FieldDescription className={fieldHelpClass}>
                  {info.operator
                    ? "The new spending key of the agent, starting with qor1 or 0x."
                    : "The address the agent pays, starting with qor1 or 0x."}
                </FieldDescription>
              )}
            </Field>
          )}
          {info.operator && (
            <Field data-invalid={errors.operator ? true : undefined}>
              <FieldLabel htmlFor="owner-operator">New operator key</FieldLabel>
              <Controller
                control={control}
                name="operator"
                render={({ field }) => (
                  <Input
                    id="owner-operator"
                    {...field}
                    disabled={locked}
                    placeholder="qor1… or 0x…"
                    autoComplete="off"
                    spellCheck={false}
                    aria-invalid={errors.operator ? true : undefined}
                    className={cn(controlClass, "font-mono text-[15px]")}
                  />
                )}
              />
              {errors.operator ? (
                <FieldError className={fieldErrorClass}>
                  <CircleAlert className="mt-px size-3.5 shrink-0" aria-hidden />
                  {errors.operator.message}
                </FieldError>
              ) : (
                <FieldDescription className={fieldHelpClass}>The new operator key of the agent, starting with qor1 or 0x.</FieldDescription>
              )}
            </Field>
          )}
          {info.value && (
            <Field data-invalid={errors.value ? true : undefined}>
              <FieldLabel htmlFor="owner-value">{info.valueLabel}</FieldLabel>
              <Controller
                control={control}
                name="value"
                render={({ field }) => (
                  <NumberInput
                    id="owner-value"
                    name={field.name}
                    ref={field.ref}
                    decimals={6}
                    suffix="fUSD"
                    disabled={locked}
                    value={field.value}
                    aria-invalid={errors.value ? true : undefined}
                    onBlur={field.onBlur}
                    onValueChange={field.onChange}
                  />
                )}
              />
              {errors.value ? (
                <FieldError className={fieldErrorClass}>
                  <CircleAlert className="mt-px size-3.5 shrink-0" aria-hidden />
                  {errors.value.message}
                </FieldError>
              ) : (
                <FieldDescription className={fieldHelpClass}>{valueHelp}</FieldDescription>
              )}
            </Field>
          )}
          <Field data-invalid={errors.expiryMinutes ? true : undefined}>
            <FieldLabel htmlFor="owner-expiry">Valid for</FieldLabel>
            <Controller
              control={control}
              name="expiryMinutes"
              render={({ field }) => (
                <NumberInput
                  id="owner-expiry"
                  name={field.name}
                  ref={field.ref}
                  suffix="minutes"
                  disabled={locked}
                  value={field.value}
                  aria-invalid={errors.expiryMinutes ? true : undefined}
                  onBlur={field.onBlur}
                  onValueChange={field.onChange}
                />
              )}
            />
            {errors.expiryMinutes ? (
              <FieldError className={fieldErrorClass}>
                <CircleAlert className="mt-px size-3.5 shrink-0" aria-hidden />
                {errors.expiryMinutes.message}
              </FieldError>
            ) : (
              <FieldDescription className={fieldHelpClass}>
                {`The vault refuses the signed order after this time. From ${EXPIRY_MIN} to ${EXPIRY_MAX.toLocaleString("en-US")} minutes.`}
              </FieldDescription>
            )}
          </Field>
        </div>
      )}

      {flow ?? (
        <div className="flex flex-col gap-2.5 md:flex-row">
          <Button type="button" size="lg" className="h-11 flex-1" disabled={!valid} onClick={() => void submit("qorex")}>
            Sign with QoreX
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="lg"
            className="h-11 flex-1"
            disabled={!valid}
            onClick={() => void submit("paste")}
          >
            Paste a CLI signature
          </Button>
        </div>
      )}
    </form>
  );
}
