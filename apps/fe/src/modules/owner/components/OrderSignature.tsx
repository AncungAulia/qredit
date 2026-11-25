"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { LoaderCircle } from "lucide-react";
import { ChainAction } from "@/components/shared/ChainAction";
import { fieldErrorClass, fieldHelpClass } from "@/components/shared/formStyles";
import { Notice } from "@/components/shared/Notice";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import { formatDateTime } from "@/lib/format";
import type { Business } from "@/lib/schemas";
import { useOwnerActions } from "@/modules/owner/api/useOwner";
import { appliedTitle, orderSentence } from "@/modules/owner/lib/describe";
import type { SignVia } from "@/modules/owner/components/PolicyOrderForm";
import {
  isBareHex,
  orderInput,
  parseSignature,
  type PolicyOrder,
  type PolicyOrderValues,
} from "@/modules/owner/schemas/policyOrder.schema";
import { NeedsWallet } from "@/modules/wallet/components/NeedsWallet";
import { SetupGate, useWalletReadiness } from "@/modules/wallet/components/RequireReadyWallet";
import { TxReverted } from "@/modules/wallet/signer";

type Built = { order: PolicyOrder; text: string };

type Step =
  | { name: "building" }
  | { name: "buildFailed" }
  | { name: "signing"; built: Built }
  | { name: "signFailed"; built: Built }
  | { name: "paste"; built: Built; error?: string }
  | { name: "checking"; built: Built }
  | { name: "refused"; built: Built; reason: string; afterSend?: boolean }
  | { name: "ready"; built: Built; sig: Uint8Array };

export type AppliedOrder = { title: string; hash: string | null };

type Props = {
  business: Business;
  /** The bech32 address of the connected QoreX account, which QoreX signs for. */
  qorexAddress: string;
  values: PolicyOrderValues;
  via: SignVia;
  onCancel: () => void;
  onApplied: (applied: AppliedOrder) => void;
};

const Waiting = ({ children }: { children: string }) => (
  <div role="status" className="flex items-center gap-2 text-[15px] font-medium text-text-primary">
    <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" aria-hidden />
    {children}
  </div>
);

const TextToSign = ({ text }: { text: string }) => (
  <div className="flex flex-col gap-1.5">
    <p className="text-sm font-medium text-text-primary">Text to sign</p>
    <p className="rounded-lg bg-surface-muted p-3 font-mono text-[13px] leading-normal break-all text-text-secondary">{text}</p>
  </div>
);

const NEXT_STEP = {
  text: "Check the current rules before signing again.",
  label: "Open the owner console",
  href: "/owner",
};

/**
 * Carries one order from the form to its end: reads the nonce and the text from the vault, gets the post-quantum signature
 * (from QoreX or pasted), checks the order with the vault without sending anything, and only then offers to apply it.
 * A refusal of the check ends the attempt and nothing is sent.
 */
export function OrderSignature({ business, qorexAddress, values, via, onCancel, onApplied }: Props) {
  const actions = useOwnerActions();
  const readiness = useWalletReadiness();
  const [step, setStep] = useState<Step>({ name: "building" });
  const [apply, setApply] = useState(false);
  const [pasted, setPasted] = useState("");
  const alive = useRef(true);
  const started = useRef(false);
  // The reason of a send the chain refused; it ends the attempt, because the same order cannot succeed again.
  const sendRefusal = useRef<string | null>(null);
  const vault = business.vault;

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const check = useCallback(
    async (built: Built, sig: Uint8Array) => {
      setStep({ name: "checking", built });
      const result = await actions.simulate(vault, built.order, sig);
      if (!alive.current) return;
      setStep(result.ok ? { name: "ready", built, sig } : { name: "refused", built, reason: result.reason });
    },
    [actions, vault],
  );

  const sign = useCallback(
    async (built: Built) => {
      setStep({ name: "signing", built });
      let sig: Uint8Array;
      try {
        sig = await actions.sign(qorexAddress, built.text);
      } catch {
        if (alive.current) setStep({ name: "signFailed", built });
        return;
      }
      if (alive.current) await check(built, sig);
    },
    [actions, qorexAddress, check],
  );

  const start = useCallback(async () => {
    setStep({ name: "building" });
    let built: Built;
    try {
      built = await actions.build(vault, orderInput(values));
    } catch {
      if (alive.current) setStep({ name: "buildFailed" });
      return;
    }
    if (!alive.current) return;
    if (via === "qorex") await sign(built);
    else setStep({ name: "paste", built });
  }, [actions, vault, values, via, sign]);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void start();
  }, [start]);

  const cancel = (
    <Button type="button" variant="ghost" size="lg" className="h-11 w-full" onClick={onCancel}>
      Cancel
    </Button>
  );

  if (step.name === "building") return <Waiting>Preparing the order</Waiting>;
  if (step.name === "checking") return <Waiting>Checking the order with the vault</Waiting>;

  if (step.name === "buildFailed") {
    return (
      <div className="flex flex-col gap-3">
        <Notice tone="danger" title="The order could not be prepared">
          The vault did not answer, so nothing was signed or sent. Please try again.
        </Notice>
        <Button type="button" size="lg" className="h-11 w-full" onClick={() => void start()}>
          Try again
        </Button>
        {cancel}
      </div>
    );
  }

  if (step.name === "signing") {
    return (
      <div className="flex flex-col gap-4">
        <Waiting>Sign in QoreX</Waiting>
        <TextToSign text={step.built.text} />
        {cancel}
      </div>
    );
  }

  if (step.name === "signFailed") {
    const { built } = step;
    return (
      <div className="flex flex-col gap-3">
        <Notice tone="danger" title="The order was not signed">
          QoreX did not return a post-quantum signature, so nothing was sent. Approve the request in QoreX and try again.
        </Notice>
        <Button type="button" size="lg" className="h-11 w-full" onClick={() => void sign(built)}>
          Try again
        </Button>
        {cancel}
      </div>
    );
  }

  if (step.name === "paste") {
    const { built } = step;
    return (
      <div className="flex flex-col gap-4">
        <TextToSign text={built.text} />
        <p className="text-[13px] leading-normal text-text-secondary">
          {`Sign this exact text with the owner command line tool. The order is valid until ${formatDateTime(Number(built.order.expiry) * 1000)}.`}
        </p>
        <Field data-invalid={step.error ? true : undefined}>
          <FieldLabel htmlFor="owner-signature">Signature</FieldLabel>
          <Textarea
            id="owner-signature"
            value={pasted}
            rows={3}
            spellCheck={false}
            autoComplete="off"
            aria-invalid={step.error ? true : undefined}
            className="font-mono text-[13px]"
            onChange={(e) => setPasted(e.target.value)}
          />
          {step.error ? (
            <FieldError className={fieldErrorClass}>{step.error}</FieldError>
          ) : (
            <FieldDescription className={fieldHelpClass}>Hex that starts with 0x, or base64.</FieldDescription>
          )}
        </Field>
        <Button
          type="button"
          size="lg"
          className="h-11 w-full"
          onClick={() => {
            const sig = parseSignature(pasted);
            if (!sig) {
              setStep({
                name: "paste",
                built,
                error: isBareHex(pasted)
                  ? "Add 0x before a hex signature."
                  : "This text could not be read as a signature. Paste it as hex or base64.",
              });
              return;
            }
            void check(built, sig);
          }}
        >
          Check signature
        </Button>
        {cancel}
      </div>
    );
  }

  if (step.name === "refused") {
    return (
      <div className="flex flex-col gap-3">
        <Notice tone="danger" title="The vault refused this order">
          {step.afterSend ? `${step.reason} The rules did not change.` : `${step.reason} Nothing was sent, and the rules did not change.`}
        </Notice>
        <Button type="button" size="lg" className="h-11 w-full" onClick={onCancel}>
          Back to the form
        </Button>
      </div>
    );
  }

  const { built, sig } = step;
  const canSend = readiness.state === "ready";
  return (
    <div className="flex flex-col gap-4">
      <Notice tone="success" title="The vault accepts this order">
        {`${orderSentence(built.order)}. The signature is valid and the rules allow it. Applying it sends one transaction from a test wallet.`}
      </Notice>
      {readiness.state === "none" && <NeedsWallet verb="apply this order" noun="Applying" />}
      {readiness.state === "setup" && <SetupGate />}
      {readiness.state === "error" && (
        <Notice tone="warning">
          The status of your wallet could not be read, so applying is paused.{" "}
          <button type="button" className="font-medium underline" onClick={readiness.refetch}>
            Try again
          </button>
        </Notice>
      )}
      {readiness.state === "loading" && <Waiting>Reading your wallet</Waiting>}
      {canSend && (
        <Button type="button" size="lg" className="h-11 w-full" onClick={() => setApply(true)}>
          Apply order
        </Button>
      )}
      {cancel}
      <ChainAction
        open={apply}
        retryable={false}
        onOpenChange={(open) => {
          setApply(open);
          if (!open && sendRefusal.current !== null) {
            const reason = sendRefusal.current;
            sendRefusal.current = null;
            setStep({ name: "refused", built, reason, afterSend: true });
          }
        }}
        title="Apply this policy order"
        body="The vault checks your signature and then changes its rules. This sends one transaction from your test wallet, and the network fee is paid in QOR by that wallet."
        confirmLabel="Apply order"
        pendingLabel="Applying the order"
        successTitle={appliedTitle(built.order)}
        nextStep={NEXT_STEP}
        summary={<p className="rounded-lg bg-surface-muted p-3 text-sm text-text-primary">{orderSentence(built.order)}</p>}
        run={async () => {
          sendRefusal.current = null;
          try {
            return await actions.apply(vault, built.order, sig);
          } catch (e) {
            if (e instanceof TxReverted) sendRefusal.current = e.reason;
            throw e;
          }
        }}
        onDone={(hash) => onApplied({ title: appliedTitle(built.order), hash })}
      />
    </div>
  );
}
