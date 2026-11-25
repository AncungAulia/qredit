"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Controller, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { CircleAlert, CircleCheck, Lock, Undo2, Wallet } from "lucide-react";
import { toast } from "sonner";
import { ChainActionStatus, useChainAction } from "@/components/shared/ChainAction";
import { BusinessMark } from "@/components/shared/BusinessMark";
import { controlClass, fieldErrorClass, fieldHelpClass } from "@/components/shared/formStyles";
import { InlineWordmark } from "@/components/shared/InlineWordmark";
import { Notice } from "@/components/shared/Notice";
import { TxLink } from "@/components/shared/TxLink";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { formatDuration, formatFusd } from "@/lib/format";
import type { Business } from "@/lib/schemas";
import { cn, focusRing } from "@/lib/utils";
import { useVaultQuery } from "@/modules/market";
import type { PlaceOrderProgress } from "@/modules/orders/api/orders.api";
import { useOrderActions, useQuotesQuery } from "@/modules/orders/api/useOrders";
import { OrderProgress } from "@/modules/orders/components/OrderProgress";
import { inputRuleFor, orderFormSchema, orderInput, type OrderValues } from "@/modules/orders/schemas/order.schema";
import { NeedsWallet } from "@/modules/wallet/components/NeedsWallet";
import { RequireReadyWallet } from "@/modules/wallet/components/RequireReadyWallet";
import { testWalletOf } from "@/modules/wallet/signer";
import { useWallet } from "@/modules/wallet/WalletProvider";

type Running = Exclude<PlaceOrderProgress, "placed">;
type Placed = { orderId: string; buyTx: string };

// A business sells only once its loan is funded (the same states the business page offers a purchase for).
const SELLING = ["Active", "Trapped", "Repaid"];

const ORDER_NEXT_STEP = { text: "Check your inbox before ordering again.", label: "Open the inbox", href: "/inbox" };

const Line = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="flex items-center justify-between gap-4 py-1.5 text-sm">
    <span className="text-text-secondary">{label}</span>
    <span className="text-right font-medium text-text-primary tabular-nums">{children}</span>
  </div>
);

const RetryButton = ({ onClick }: { onClick: () => void }) => (
  <Button type="button" variant="outline" size="sm" className="mt-2 block" onClick={onClick}>
    Try again
  </Button>
);

const FlowStep = ({ icon: Icon, children }: { icon: typeof Lock; children: React.ReactNode }) => (
  <li className="flex items-start gap-2.5 text-[13px] leading-normal text-text-secondary">
    <Icon className="mt-px size-4 shrink-0 text-text-tertiary" aria-hidden />
    <span>{children}</span>
  </li>
);

/** The request form and the order summary of one business: the buyer writes a request, it is sealed here, then paid. */
export function OrderForm({ business }: { business: Business }) {
  const session = useWallet((s) => s.session);
  const wallet = testWalletOf(session);
  const own = session.kind === "test" || session.kind === "qorex" ? session.address : null;
  const rule = inputRuleFor(business.slug);
  const [serviceId, setServiceId] = useState(business.services[0]?.id ?? 0);
  const quotes = useQuotesQuery(business);
  const quote = quotes[business.services.findIndex((s) => s.id === serviceId)];
  const vault = useVaultQuery(business.vault);
  const actions = useOrderActions();
  const [step, setStep] = useState<Running | null>(null);
  const [reached, setReached] = useState<Running[]>([]);
  // Set at once on the first press, so a second press can never start a second order.
  const sending = useRef(false);
  const [placed, setPlaced] = useState<Placed | null>(null);

  const schema = useMemo(() => orderFormSchema(business.slug), [business.slug]);
  const {
    control,
    handleSubmit,
    setValue,
    getFieldState,
    formState: { errors, isValid, touchedFields },
  } = useForm<OrderValues>({ resolver: zodResolver(schema), mode: "onTouched", defaultValues: { input: "" } });

  // The counterparty check starts with the buyer's own address; typing anything first is never overwritten.
  const prefilled = useRef(false);
  useEffect(() => {
    if (!rule.prefillOwn || !own || prefilled.current) return;
    prefilled.current = true;
    if (!getFieldState("input").isDirty) setValue("input", own, { shouldValidate: true });
  }, [rule.prefillOwn, own, getFieldState, setValue]);

  const value = useWatch({ control, name: "input" });
  const sellable = vault.data ? SELLING.includes(vault.data.state) : null;
  const price = quote?.data?.price ?? null;

  const run = useCallback(
    async (control: { sent(): void }) => {
      const result = await actions.place(business, serviceId, orderInput(business.slug, value), (p) => {
        if (p === "window") control.sent();
        if (p !== "placed") {
          setStep(p);
          setReached((r) => [...r, p]);
        }
      });
      setPlaced(result);
      return result.buyTx;
    },
    [actions, business, serviceId, value],
  );
  const action = useChainAction(run);
  const busy = action.phase === "wallet" || action.phase === "chain";

  const submit = handleSubmit(async () => {
    setStep("sealing");
    setReached(["sealing"]);
    const result = await action.start();
    setStep(null);
    if (!result) return;
    toast.success("Order placed", { description: result.hash ? <TxLink hash={result.hash} /> : undefined });
  });

  const error = errors.input?.message;
  const ttl = quote?.data ? formatDuration(quote.data.ttlSeconds) : null;
  const priceText = price !== null ? formatFusd(price) : null;
  const locked = busy || placed !== null || action.maySpend === true;
  const canBuy = isValid && price !== null && sellable === true && !locked;
  const InputControl = rule.kind === "one" ? Input : Textarea;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (sending.current) return;
        sending.current = true;
        void submit(e).finally(() => {
          sending.current = false;
        });
      }}
      noValidate className="grid gap-4 lg:grid-cols-[1fr_380px] lg:gap-6">
      <div className="flex flex-col gap-6 rounded-3xl bg-surface p-5 md:p-7">
        <div className="flex flex-col gap-2.5" role="radiogroup" aria-label="Service">
          <span className="text-sm font-medium text-text-primary">Service</span>
          {business.services.length === 0 ? (
            <p className="text-sm text-text-secondary">This business has not listed a service.</p>
          ) : (
            business.services.map((s, i) => {
              const selected = s.id === serviceId;
              const q = quotes[i];
              return (
                <button
                  key={s.id}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  disabled={locked}
                  onClick={() => setServiceId(s.id)}
                  className={cn(
                    "flex items-center gap-3.5 rounded-xl p-4 text-left pointer-coarse:min-h-11",
                    selected ? "bg-accent-soft" : "bg-surface-muted hover:bg-surface-muted/70",
                    focusRing,
                  )}
                >
                  <BusinessMark slug={business.slug} size={40} />
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="text-[15px] font-medium text-text-primary">{s.name}</span>
                    <span className="text-[13px] text-text-secondary">{business.tagline}</span>
                  </span>
                  <span className="shrink-0 text-[15px] font-medium text-text-primary tabular-nums">
                    {q?.data ? formatFusd(q.data.price) : q?.isError ? "Unavailable" : <Skeleton className="h-5 w-16" />}
                  </span>
                  {selected && <CircleCheck className="size-[18px] shrink-0 text-text-primary" aria-hidden />}
                </button>
              );
            })
          )}
        </div>

        <Field data-invalid={error ? true : undefined}>
          <FieldLabel htmlFor="order-input">{rule.label}</FieldLabel>
          <Controller
            control={control}
            name="input"
            render={({ field }) => (
              <InputControl
                id="order-input"
                name={field.name}
                ref={field.ref as never}
                value={field.value}
                disabled={locked}
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                placeholder={rule.placeholder}
                rows={rule.kind === "one" ? undefined : 4}
                aria-invalid={error ? true : undefined}
                aria-describedby="order-input-note"
                className={cn(controlClass, rule.kind === "one" ? "font-mono text-[15px]" : "h-auto min-h-28 resize-y py-3", rule.kind !== "text" && "font-mono")}
                onBlur={field.onBlur}
                onChange={(e) => {
                  if (action.phase === "refused") action.reset();
                  field.onChange(e.target.value);
                }}
              />
            )}
          />
          {error && touchedFields.input ? (
            <FieldError id="order-input-note" className={fieldErrorClass}>
              <CircleAlert className="mt-px size-3.5 shrink-0" aria-hidden />
              {error}
            </FieldError>
          ) : (
            <FieldDescription id="order-input-note" className={fieldHelpClass}>
              {rule.help}
            </FieldDescription>
          )}
        </Field>
      </div>

      <div className="flex flex-col gap-4 rounded-3xl bg-surface p-5 md:p-6">
        {placed ? (
          <div className="flex flex-col gap-4" role="status">
            <CircleCheck className="size-8 text-success" aria-hidden />
            <div className="flex flex-col gap-1.5">
              <h2 className="text-lg font-medium text-text-primary">Order placed</h2>
              <p className="text-sm leading-normal text-text-secondary">
                {`Your ${priceText ?? "payment"} is held in escrow. The report lands in your inbox when ${business.name} delivers it.`}
              </p>
            </div>
            <div className="flex flex-col gap-2.5">
              <Button size="lg" className="h-11 w-full" render={<Link href={`/inbox/${business.vault}/${placed.orderId}`} />} nativeButton={false} role="link">
                Open the report
              </Button>
              <Button variant="outline" size="lg" className="h-11 w-full" render={<Link href="/inbox" />} nativeButton={false} role="link">
                Go to the inbox
              </Button>
            </div>
            <div className="flex items-center gap-2 text-[13px] text-text-secondary">
              Payment <TxLink hash={placed.buyTx} />
            </div>
          </div>
        ) : (
          <>
            <h2 className="text-[17px] font-medium text-text-primary">Order summary</h2>
            <div className="flex flex-col">
              <Line label="Business">{business.name}</Line>
              <Line label="Price">{priceText ?? <Skeleton className="h-4 w-14" />}</Line>
              <Line label="Refund if not delivered">{ttl ? `after ${ttl}` : <Skeleton className="h-4 w-16" />}</Line>
              <Line label="Network fee">
                <span className="inline-flex items-center gap-1.5">Paid in QOR by your wallet</span>
              </Line>
            </div>
            <div className="flex flex-col gap-1 rounded-2xl bg-surface-muted p-4">
              <span className="text-[13px] text-text-secondary">You pay now</span>
              <span className="flex items-baseline gap-1.5 tabular-nums">
                <span className="text-[32px] leading-none font-medium tracking-[-1px] text-text-primary">
                  {price !== null ? formatFusd(price, { unit: false }) : "—"}
                </span>
                <span className="text-sm text-text-secondary">fUSD</span>
              </span>
            </div>
            <ul className="flex flex-col gap-2.5">
              <FlowStep icon={Lock}>Held in escrow now</FlowStep>
              <FlowStep icon={Wallet}>Released when the report is delivered</FlowStep>
              <FlowStep icon={Undo2}>{ttl ? `You can take a refund if it is not delivered within ${ttl}.` : "You can take a refund if it is not delivered in time."}</FlowStep>
            </ul>
            <p className="text-[13px] text-text-secondary">
              <InlineWordmark /> never sees your request: it is sealed in this browser.
            </p>

            {quote?.isError && (
              <Notice tone="danger" title="The price could not be read">
                The chain did not respond.
                <RetryButton onClick={() => void quote.refetch()} />
              </Notice>
            )}
            {vault.isError && !vault.data && (
              <Notice tone="danger" title="The state of this business could not be read">
                The chain did not respond.
                <RetryButton onClick={() => void vault.refetch()} />
              </Notice>
            )}
            {sellable === false && (
              <Notice tone="warning" title="This business is not selling yet">
                Orders open once its loan is funded.
              </Notice>
            )}

            {action.phase === "refused" && (
              <ChainActionStatus
                phase="refused"
                reason={action.reason}
                hash={action.hash}
                maySpend={action.maySpend}
                nextStep={ORDER_NEXT_STEP}
                refusedTitle="This order was not completed"
              />
            )}

            {!wallet ? (
              <NeedsWallet verb="buy a report" noun="Buying" />
            ) : (
              <RequireReadyWallet>
                {busy && step ? (
                  <OrderProgress step={step} reached={reached} slow={action.slow} />
                ) : (
                  action.maySpend ? null : (
                  <Button type="submit" size="lg" className="h-11 w-full" disabled={!canBuy}>
                    {action.phase === "refused" ? "Try again" : priceText ? `Seal and buy for ${priceText}` : "Seal and buy"}
                  </Button>
                  )
                )}
              </RequireReadyWallet>
            )}
          </>
        )}
      </div>
    </form>
  );
}
